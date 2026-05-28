//! Local multimodal (vision) inference.
//!
//! Why a sidecar instead of FFI:
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
//! That binary is shipped alongside the prebuilt `llama-cli` in every
//! llama.cpp release (Windows, macOS, Linux). We bundle it as a Tauri
//! sidecar — copied into `src-tauri/binaries/llama-mtmd-cli-<target>`
//! before `tauri build`, and resolved at runtime through Tauri's shell
//! plugin so the user never sees an extra install step. See
//! `desktop/README.md` for the build-side wiring.
//!
//! The contract here is intentionally small:
//!   * `chat_with_images(model_path, mmproj_path, prompt, image_paths,
//!     options)` spawns the sidecar, streams every stdout chunk back to
//!     the renderer as `token` events (the same channel the text engine
//!     uses), and resolves with the full text when the process exits.
//!   * Cancellation kills the child process — llama-mtmd-cli doesn't
//!     have a graceful "stop generating" signal, so SIGKILL/TerminateProc
//!     it is.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
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

/// Resolve `<app_local_data>/mmproj/`, creating it if missing. Kept in its
/// own subdir (vs. living under `models/`) so the existing
/// `list_downloaded_models()` flow doesn't accidentally surface mmproj files
/// as standalone chat models.
pub fn mmproj_dir(app: &AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("mmproj");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create mmproj dir at {dir:?}"))?;
    Ok(dir)
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

/// On-disk path for a model's companion mmproj GGUF.
pub fn mmproj_path(app: &AppHandle, model_id: &str) -> Result<PathBuf> {
    Ok(mmproj_dir(app)?.join(format!("{}.mmproj.gguf", sanitize_id(model_id))))
}

/// Whether a model's mmproj is fully on disk.
pub fn is_mmproj_downloaded(app: &AppHandle, model_id: &str) -> bool {
    mmproj_path(app, model_id)
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// Streams `url` to `<mmproj_dir>/<id>.mmproj.gguf`. Same shape as
/// `download::download` but writes into the mmproj subdir and emits its own
/// event channel so the UI can tell mmproj progress apart from the chat
/// model's progress (they often download back-to-back).
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

/// Tracks the currently-running sidecar child so `cancel_vision_chat` can
/// kill it. Only one vision generation runs at a time — the chat UI gates
/// new sends on `isGenerating`, so reusing a single slot is safe.
#[derive(Default)]
pub struct VisionRuntime {
    child: Mutex<Option<CommandChild>>,
}

impl VisionRuntime {
    pub async fn cancel(&self) {
        if let Some(child) = self.child.lock().await.take() {
            let _ = child.kill();
        }
    }
}

/// Write a base64-encoded image to a temp file and return its path. We
/// hand temp-file paths (not raw bytes) to `llama-mtmd-cli` because that's
/// the only image input shape it accepts on the CLI.
fn write_image_to_tmp(tmpdir: &Path, idx: usize, data_url: &str) -> Result<PathBuf> {
    // Accept either a full `data:image/...;base64,XXX` URL or raw base64.
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
    // `--log-disable` keeps llama.cpp's chatty stderr out of our stdout
    // stream so we don't accidentally surface init noise as tokens.
    let mut args: Vec<String> = vec![
        "-m".into(),
        model_path.to_string_lossy().into_owned(),
        "--mmproj".into(),
        mmproj_path.to_string_lossy().into_owned(),
        "-p".into(),
        prompt,
        "--temp".into(),
        format!("{}", opts.temperature),
        "--top-p".into(),
        format!("{}", opts.top_p),
        "-n".into(),
        format!("{}", opts.max_tokens),
        "--log-disable".into(),
    ];
    for img in &image_paths {
        args.push("--image".into());
        args.push(img.to_string_lossy().into_owned());
    }

    let shell = app.shell();
    let cmd = shell
        .sidecar("llama-mtmd-cli")
        .map_err(|e| anyhow!("could not resolve llama-mtmd-cli sidecar: {e}"))?
        .args(args)
        .stderr(Stdio::null());

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| anyhow!("failed to spawn llama-mtmd-cli: {e}"))?;

    // Stash the child so cancel_vision_chat can kill it.
    {
        let mut slot = runtime.child.lock().await;
        if let Some(prev) = slot.take() {
            // Defensive — shouldn't happen given the UI's isGenerating gate.
            let _ = prev.kill();
        }
        *slot = Some(child);
    }

    let mut full = String::new();
    let mut exit_err: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let s = String::from_utf8_lossy(&line).to_string();
                if !s.is_empty() {
                    let _ = app.emit_to("main", "token", s.clone());
                    full.push_str(&s);
                }
            }
            CommandEvent::Stderr(_) => {
                // Intentionally swallowed — see --log-disable above. Stderr
                // would otherwise leak llama.cpp init messages.
            }
            CommandEvent::Error(e) => {
                exit_err = Some(e);
                break;
            }
            CommandEvent::Terminated(payload) => {
                if let Some(code) = payload.code {
                    if code != 0 {
                        exit_err = Some(format!(
                            "llama-mtmd-cli exited with code {code}"
                        ));
                    }
                }
                break;
            }
            _ => {}
        }
    }

    // Clear the runtime slot so future runs aren't blocked on a dead child.
    *runtime.child.lock().await = None;

    drop(tmp);

    if let Some(e) = exit_err {
        return Err(anyhow!(e));
    }
    Ok(full)
}
