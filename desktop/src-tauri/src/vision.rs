//! Local multimodal (vision) inference.
//!
//! Why a separate binary instead of FFI:
//!
//! We use llama.cpp through `llama-cpp-2` everywhere else (text gen,
//! embeddings). For multimodal models we'd need the `llava`/`mtmd` C++
//! helpers — image preprocessing, CLIP feature extraction, joint
//! token+embedding decoding. As of `llama-cpp-2` 0.1.x, those helpers are
//! NOT exposed through the Rust bindings; the only stable, supported way
//! to drive an mmproj model end-to-end without writing several hundred
//! lines of `unsafe extern "C"` glue is to shell out to llama.cpp's own
//! `llama-mtmd-cli` binary.
//!
//! Why we don't use Tauri's `externalBin` sidecar mechanism:
//!
//! `externalBin` is strict — if the binary isn't present for the current
//! target triple at build time, `cargo tauri build` hard-fails. That makes
//! the entire installer impossible to build unless every contributor has
//! manually grabbed the right llama.cpp release for their OS. Vision is
//! optional for most users, so instead we look the binary up at runtime in
//! `<app_local_data>/bin/`. The app ships without it; the first time a
//! user picks a vision model, the UI surfaces a clear "install vision
//! support" prompt that wires up the in-app downloader (`install_mtmd_cli`).
//!
//! The contract here is intentionally small:
//!   * `chat_with_images(model_path, mmproj_path, prompt, image_paths,
//!     options)` spawns `llama-mtmd-cli`, streams every stdout chunk back
//!     to the renderer as `token` events (the same channel the text
//!     engine uses), and resolves with the full text on exit.
//!   * Cancellation kills the child process — `llama-mtmd-cli` doesn't
//!     have a graceful "stop generating" signal.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Options the frontend hands us per request. Mirrors `GenerateOpts` from
/// `inference.rs` but limited to flags `llama-mtmd-cli` actually accepts.
#[derive(Debug, Clone, Deserialize)]
pub struct VisionOpts {
    #[serde(rename = "maxTokens")]
    pub max_tokens: usize,
    pub temperature: f32,
    #[serde(rename = "topP")]
    pub top_p: f32,
}

// ---------------------------------------------------------------------------
// On-disk layout
//
// <app_local_data>/
//   mmproj/<model-id>.mmproj.gguf   ← companion image projectors
//   bin/llama-mtmd-cli[.exe]        ← the multimodal CLI itself
//
// Both live under app_local_data (not Resource) because they're optional,
// per-machine, and installed on demand after the app is already running.
// ---------------------------------------------------------------------------

pub fn mmproj_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("mmproj");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create mmproj dir at {dir:?}"))?;
    Ok(dir)
}

pub fn bin_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("bin");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create bin dir at {dir:?}"))?;
    Ok(dir)
}

/// Full path to where we expect the `llama-mtmd-cli` executable to live.
/// `.exe` on Windows, bare name elsewhere.
pub fn mtmd_cli_path(app: &AppHandle) -> Result<PathBuf> {
    let name = if cfg!(target_os = "windows") {
        "llama-mtmd-cli.exe"
    } else {
        "llama-mtmd-cli"
    };
    Ok(bin_dir(app)?.join(name))
}

pub fn is_mtmd_cli_installed(app: &AppHandle) -> bool {
    mtmd_cli_path(app).map(|p| p.is_file()).unwrap_or(false)
}

fn sanitize_id(model_id: &str) -> String {
    model_id
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

pub fn mmproj_path(app: &AppHandle, model_id: &str) -> Result<PathBuf> {
    Ok(mmproj_dir(app)?.join(format!("{}.mmproj.gguf", sanitize_id(model_id))))
}

pub fn is_mmproj_downloaded(app: &AppHandle, model_id: &str) -> bool {
    mmproj_path(app, model_id)
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// Streams `url` to `<mmproj_dir>/<id>.mmproj.gguf`. Emits
/// `mmproj-download-progress` so the UI can show a separate bar from the
/// chat-model download (they often happen back-to-back).
pub async fn download_mmproj(
    app: AppHandle,
    model_id: String,
    url: String,
    cancel: Arc<AtomicBool>,
) -> Result<PathBuf> {
    use futures_util::StreamExt;
    use serde::Serialize;
    use std::time::{Duration, Instant};
    use tokio::io::AsyncWriteExt;

    let final_path = mmproj_path(&app, &model_id)?;
    if final_path.is_file() {
        return Ok(final_path);
    }
    let partial = final_path.with_extension("gguf.partial");
    let _ = tokio::fs::remove_file(&partial).await;

    let client = reqwest::Client::builder()
        .user_agent("LocalModelStudio/0.1")
        .connect_timeout(Duration::from_secs(30))
        .build()
        .context("failed to build http client")?;

    let resp = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("HTTP request to {url} failed"))?;
    if !resp.status().is_success() {
        return Err(anyhow!(
            "mmproj download for {model_id} failed: HTTP {}",
            resp.status()
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&partial)
        .await
        .with_context(|| format!("failed to create {partial:?}"))?;

    #[derive(Serialize, Clone)]
    struct Prog {
        #[serde(rename = "modelId")]
        model_id: String,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
    }

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let emit_interval = Duration::from_millis(100);

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(anyhow!("mmproj download cancelled"));
        }
        let bytes = chunk.context("mmproj download stream error")?;
        file.write_all(&bytes)
            .await
            .with_context(|| format!("failed to write to {partial:?}"))?;
        downloaded += bytes.len() as u64;
        if last_emit.elapsed() >= emit_interval {
            let _ = app.emit(
                "mmproj-download-progress",
                Prog {
                    model_id: model_id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                },
            );
            last_emit = Instant::now();
        }
    }
    file.flush().await.ok();
    drop(file);

    let _ = app.emit(
        "mmproj-download-progress",
        Prog {
            model_id: model_id.clone(),
            downloaded_bytes: downloaded,
            total_bytes: if total > 0 { total } else { downloaded },
        },
    );

    tokio::fs::rename(&partial, &final_path)
        .await
        .with_context(|| format!("failed to rename {partial:?} -> {final_path:?}"))?;
    Ok(final_path)
}

/// Install the `llama-mtmd-cli` binary into `<app_local_data>/bin/` by
/// copying it from a user-chosen local path. We deliberately don't auto-
/// download from the internet because the llama.cpp release ships multiple
/// platform-specific binaries with co-located DLL dependencies, and the
/// safest cross-platform contract is: "you grab the right archive, point
/// us at the extracted `llama-mtmd-cli` (or `.exe`), we put it in place".
/// On Windows we also copy any `.dll` files sitting next to it (ggml.dll,
/// llama.dll, etc.) so the binary actually runs.
pub fn install_mtmd_cli_from(app: &AppHandle, source: &Path) -> Result<PathBuf> {
    if !source.is_file() {
        return Err(anyhow!(
            "source binary not found at {source:?} — point us at the extracted llama-mtmd-cli"
        ));
    }
    let dest = mtmd_cli_path(app)?;
    std::fs::copy(source, &dest)
        .with_context(|| format!("failed to copy {source:?} -> {dest:?}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).ok();
    }

    // On Windows the CLI links against ggml.dll / llama.dll / etc. The
    // llama.cpp prebuilt ships them in the same folder. Copy any DLL
    // sitting alongside the source so the binary is actually loadable.
    if cfg!(target_os = "windows") {
        if let Some(src_dir) = source.parent() {
            let bin = bin_dir(app)?;
            if let Ok(entries) = std::fs::read_dir(src_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let is_dll = p
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("dll"))
                        .unwrap_or(false);
                    if is_dll {
                        if let Some(name) = p.file_name() {
                            let _ = std::fs::copy(&p, bin.join(name));
                        }
                    }
                }
            }
        }
    }

    Ok(dest)
}

/// Remove an installed `llama-mtmd-cli` (and any co-installed DLLs).
pub fn uninstall_mtmd_cli(app: &AppHandle) -> Result<()> {
    let bin = bin_dir(app)?;
    if let Ok(entries) = std::fs::read_dir(&bin) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Tracks the currently-running mtmd child so `cancel_vision_chat` can
/// kill it. Only one vision generation runs at a time — the chat UI gates
/// new sends on `isGenerating`, so reusing a single slot is safe.
#[derive(Default)]
pub struct VisionRuntime {
    child: Mutex<Option<Child>>,
}

impl VisionRuntime {
    pub async fn cancel(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.start_kill();
        }
    }
}

/// Write a base64-encoded image to a temp file and return its path. We
/// hand temp-file paths (not raw bytes) to `llama-mtmd-cli` because that's
/// the only image input shape it accepts on the CLI.
fn write_image_to_tmp(tmpdir: &Path, idx: usize, data_url: &str) -> Result<PathBuf> {
    let (mime, b64) = if let Some(rest) = data_url.strip_prefix("data:") {
        let comma = rest
            .find(',')
            .ok_or_else(|| anyhow!("malformed data url: missing comma"))?;
        let header = &rest[..comma];
        let body = &rest[comma + 1..];
        let mime = header
            .split(';')
            .next()
            .unwrap_or("image/png")
            .to_string();
        (mime, body.to_string())
    } else {
        ("image/png".to_string(), data_url.to_string())
    };

    let ext = match mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    };

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD
        .decode(b64.trim())
        .context("base64 decode failed for attached image")?;

    let path = tmpdir.join(format!("img-{idx}.{ext}"));
    std::fs::write(&path, &bytes).with_context(|| format!("write image to {path:?} failed"))?;
    Ok(path)
}

/// Spawn `llama-mtmd-cli` with the given model + mmproj + images, stream
/// every stdout chunk to the renderer as `token` events, and return the
/// full assembled text on exit.
pub async fn chat_with_images(
    app: AppHandle,
    runtime: Arc<VisionRuntime>,
    model_path: PathBuf,
    mmproj_path: PathBuf,
    prompt: String,
    image_data_urls: Vec<String>,
    opts: VisionOpts,
) -> Result<String> {
    if !model_path.is_file() {
        return Err(anyhow!("model file not found at {model_path:?}"));
    }
    if !mmproj_path.is_file() {
        return Err(anyhow!(
            "mmproj file not found at {mmproj_path:?} — download it first"
        ));
    }
    if image_data_urls.is_empty() {
        return Err(anyhow!("chat_with_images called with no images"));
    }
    let cli = mtmd_cli_path(&app)?;
    if !cli.is_file() {
        return Err(anyhow!(
            "Vision support isn't installed yet. Open Settings → Local Vision and install the llama-mtmd-cli helper, then try again."
        ));
    }

    // Decode every image to a per-request temp dir so they're cleaned up
    // together when the dir is dropped at the end of this function.
    let tmp = tempfile::Builder::new()
        .prefix("lms-vision-")
        .tempdir()
        .context("could not create temp dir for vision images")?;
    let mut image_paths: Vec<PathBuf> = Vec::with_capacity(image_data_urls.len());
    for (i, url) in image_data_urls.iter().enumerate() {
        image_paths.push(write_image_to_tmp(tmp.path(), i, url)?);
    }

    // Build the argv. `--image` may be repeated. `-p` is the prompt.
    // `--temp`, `--top-p`, `-n` match the text-gen knobs the UI exposes.
    // `--log-disable` keeps llama.cpp's chatty stderr out of stdout so we
    // don't surface init noise as tokens.
    let mut cmd = Command::new(&cli);
    cmd.arg("-m")
        .arg(&model_path)
        .arg("--mmproj")
        .arg(&mmproj_path)
        .arg("-p")
        .arg(&prompt)
        .arg("--temp")
        .arg(format!("{}", opts.temperature))
        .arg("--top-p")
        .arg(format!("{}", opts.top_p))
        .arg("-n")
        .arg(format!("{}", opts.max_tokens))
        .arg("--log-disable");
    for img in &image_paths {
        cmd.arg("--image").arg(img);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    // On Windows, hide the console window the child would otherwise pop up.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("failed to spawn llama-mtmd-cli at {cli:?}: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("llama-mtmd-cli stdout pipe unavailable"))?;

    // Stash the child so cancel_vision_chat can kill it.
    {
        let mut slot = runtime.child.lock().await;
        if let Some(mut prev) = slot.take() {
            let _ = prev.start_kill();
        }
        *slot = Some(child);
    }

    let mut full = String::new();
    let mut reader = BufReader::new(stdout);
    let mut buf = [0u8; 1024];
    use tokio::io::AsyncReadExt;
    loop {
        let n = reader
            .read(&mut buf)
            .await
            .context("read from llama-mtmd-cli stdout failed")?;
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
        if !chunk.is_empty() {
            let _ = app.emit_to("main", "token", chunk.clone());
            full.push_str(&chunk);
        }
    }

    // Reap the child (if not already reaped via cancel).
    let exit_err = {
        let mut slot = runtime.child.lock().await;
        if let Some(mut child) = slot.take() {
            match child.wait().await {
                Ok(status) if status.success() => None,
                Ok(status) => Some(format!("llama-mtmd-cli exited with {status}")),
                Err(e) => Some(format!("waiting on llama-mtmd-cli failed: {e}")),
            }
        } else {
            None
        }
    };

    drop(tmp);

    if let Some(e) = exit_err {
        return Err(anyhow!(e));
    }
    Ok(full)
}
