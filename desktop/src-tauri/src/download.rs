//! In-app GGUF downloader. Streams a remote file (typically a Hugging Face
//! `resolve/main/...gguf` URL) to disk under the app's local-data dir,
//! emitting progress events the frontend can show, and supporting cancel.

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;

/// Tracks in-flight downloads so we can cancel them.
#[derive(Default)]
pub struct DownloadRegistry {
    inner: parking_lot::Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadRegistry {
    pub fn register(&self, model_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.inner.lock().insert(model_id.to_string(), flag.clone());
        flag
    }

    pub fn cancel(&self, model_id: &str) {
        if let Some(flag) = self.inner.lock().get(model_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn remove(&self, model_id: &str) {
        self.inner.lock().remove(model_id);
    }
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    #[serde(rename = "modelId")]
    pub model_id: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct DownloadedModel {
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub path: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

/// Sanitize a model id into a safe filename. We control the ids in the catalog
/// so this is mostly defensive — strip path separators and weird chars.
fn sanitize_id(model_id: &str) -> String {
    model_id
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// Resolve `<app_local_data>/models/`, creating it if missing.
pub fn models_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("models");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create models dir at {dir:?}"))?;
    Ok(dir)
}

/// Final on-disk path for a downloaded model.
pub fn model_path(app: &AppHandle, model_id: &str) -> Result<PathBuf> {
    Ok(models_dir(app)?.join(format!("{}.gguf", sanitize_id(model_id))))
}

/// True if the model's GGUF is already fully on disk.
pub fn is_downloaded(app: &AppHandle, model_id: &str) -> bool {
    model_path(app, model_id)
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// List every fully-downloaded model in the models dir.
pub fn list_downloaded(app: &AppHandle) -> Result<Vec<DownloadedModel>> {
    let dir = models_dir(app)?;
    let mut out = Vec::new();
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("gguf") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(DownloadedModel {
            model_id: stem,
            path: path.to_string_lossy().into_owned(),
            size_bytes: size,
        });
    }
    Ok(out)
}

/// Delete a downloaded model. No-op if it isn't there.
pub fn delete(app: &AppHandle, model_id: &str) -> Result<()> {
    let path = model_path(app, model_id)?;
    if path.is_file() {
        std::fs::remove_file(&path)
            .with_context(|| format!("failed to delete {path:?}"))?;
    }
    Ok(())
}

/// Stream `url` to `<models_dir>/<id>.gguf.partial`, renaming to `.gguf` on
/// success. Emits a `download-progress` event after each chunk (throttled).
/// If `cancel` flips to true, the partial file is cleaned up and we return an
/// error.
pub async fn download(
    app: AppHandle,
    model_id: String,
    url: String,
    cancel: Arc<AtomicBool>,
) -> Result<PathBuf> {
    let final_path = model_path(&app, &model_id)?;
    if final_path.is_file() {
        return Ok(final_path);
    }
    let partial_path = final_path.with_extension("gguf.partial");

    // Remove any stale partial from a previous failed run.
    let _ = tokio_fs::remove_file(&partial_path).await;

    let client = reqwest::Client::builder()
        .user_agent("LocalModelStudio/0.1")
        // GGUFs can be 5+ GB; HF CDN can be slow to first byte.
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
            "download for {model_id} failed: HTTP {}",
            resp.status()
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio_fs::File::create(&partial_path)
        .await
        .with_context(|| format!("failed to create {partial_path:?}"))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    // Emit at most ~10x/sec so we don't drown the IPC channel.
    let emit_interval = Duration::from_millis(100);

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio_fs::remove_file(&partial_path).await;
            return Err(anyhow!("download cancelled"));
        }

        let bytes = chunk.context("download stream error")?;
        file.write_all(&bytes)
            .await
            .with_context(|| format!("failed to write to {partial_path:?}"))?;
        downloaded += bytes.len() as u64;

        if last_emit.elapsed() >= emit_interval {
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
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

    // Final progress tick at 100% so the UI snaps to "done".
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            model_id: model_id.clone(),
            downloaded_bytes: downloaded,
            total_bytes: if total > 0 { total } else { downloaded },
        },
    );

    tokio_fs::rename(&partial_path, &final_path)
        .await
        .with_context(|| {
            format!("failed to rename {partial_path:?} -> {final_path:?}")
        })?;

    Ok(final_path)
}
