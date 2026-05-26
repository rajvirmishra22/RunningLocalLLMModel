// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod download;
mod embeddings;
mod inference;
mod rag_store;

use download::{DownloadRegistry, DownloadedModel};
use embeddings::EmbedEngine;
use inference::Engine;
use parking_lot::Mutex;
use rag_store::{IndexedDoc, RetrievedChunk};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    loaded_model_id: Mutex<Option<String>>,
    cancel: Arc<AtomicBool>,
    downloads: DownloadRegistry,
    /// Embeddings engine, loaded lazily on first RAG use.
    embed_engine: Mutex<Option<Arc<EmbedEngine>>>,
    /// True while the embeddings model is being downloaded so we can refuse
    /// concurrent download requests.
    embed_downloading: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    name: String,
    path: String,
    loaded: bool,
}

/// Internal helper: load a GGUF from a path and stash it in app state.
async fn load_engine_at(
    state: &State<'_, AppState>,
    model_id: &str,
    model_path: PathBuf,
) -> Result<ModelInfo, String> {
    if !model_path.exists() {
        return Err(format!("model file not found at {model_path:?}"));
    }

    // If the same model is already loaded, return the cached info.
    {
        let cur_id = state.loaded_model_id.lock().clone();
        let cur_engine = state.engine.lock().clone();
        if cur_engine.is_some() && cur_id.as_deref() == Some(model_id) {
            return Ok(ModelInfo {
                name: model_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("model.gguf")
                    .to_string(),
                path: model_path.to_string_lossy().into_owned(),
                loaded: true,
            });
        }
    }

    let mp = model_path.clone();
    let engine = tokio::task::spawn_blocking(move || Engine::load(&mp))
        .await
        .map_err(|e| format!("model load task panicked: {e}"))?
        .map_err(|e| format!("model load failed: {e:#}"))?;

    let name = model_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model.gguf")
        .to_string();
    let path_str = model_path.to_string_lossy().into_owned();

    *state.engine.lock() = Some(Arc::new(engine));
    *state.loaded_model_id.lock() = Some(model_id.to_string());

    Ok(ModelInfo { name, path: path_str, loaded: true })
}

/// Load the GGUF that's bundled with the installer.
#[tauri::command]
async fn init_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ModelInfo, String> {
    let model_path = app
        .path()
        .resolve("model.gguf", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("could not resolve bundled model path: {e}"))?;
    load_engine_at(&state, "bundled", model_path).await
}

/// Load a model that the user previously downloaded via `download_model`.
#[tauri::command]
async fn init_downloaded_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<ModelInfo, String> {
    let path = download::model_path(&app, &model_id)
        .map_err(|e| format!("could not resolve model path: {e:#}"))?;
    load_engine_at(&state, &model_id, path).await
}

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    prompt: String,
    max_tokens: usize,
    temperature: f32,
    top_p: f32,
    stop_strings: Vec<String>,
) -> Result<String, String> {
    let engine = {
        let guard = state.engine.lock();
        guard.clone().ok_or_else(|| "model not initialised".to_string())?
    };
    let cancel = state.cancel.clone();
    cancel.store(false, Ordering::SeqCst);

    let app_for_emit = app.clone();
    let emit = move |tok: &str| {
        let _ = app_for_emit.emit_to("main", "token", tok.to_string());
    };

    let cancel_for_check = cancel.clone();
    let result = tokio::task::spawn_blocking(move || {
        engine.generate(
            &prompt,
            inference::GenerateOpts {
                max_tokens,
                temperature,
                top_p,
                stop_strings,
            },
            emit,
            move || cancel_for_check.load(Ordering::SeqCst),
        )
    })
    .await
    .map_err(|e| format!("inference task panicked: {e}"))?;

    result.map_err(|e| format!("inference failed: {e:#}"))
}

#[tauri::command]
fn cancel_chat(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
    url: String,
) -> Result<String, String> {
    let cancel = state.downloads.register(&model_id);
    let result = download::download(app.clone(), model_id.clone(), url, cancel).await;
    state.downloads.remove(&model_id);
    match result {
        Ok(path) => Ok(path.to_string_lossy().into_owned()),
        Err(e) => Err(format!("download failed: {e:#}")),
    }
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>, model_id: String) {
    state.downloads.cancel(&model_id);
}

#[tauri::command]
fn list_downloaded_models(app: tauri::AppHandle) -> Result<Vec<DownloadedModel>, String> {
    download::list_downloaded(&app).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn delete_downloaded_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    // If we're about to delete the currently loaded model, drop the engine
    // first so the file isn't locked on Windows.
    {
        let cur = state.loaded_model_id.lock().clone();
        if cur.as_deref() == Some(model_id.as_str()) {
            *state.engine.lock() = None;
            *state.loaded_model_id.lock() = None;
        }
    }
    download::delete(&app, &model_id).map_err(|e| format!("{e:#}"))
}

// ---------------------------------------------------------------------------
// RAG / embeddings commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct EmbedStatus {
    downloaded: bool,
    loaded: bool,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
}

fn embed_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = rag_store::embed_dir(app).map_err(|e| format!("{e:#}"))?;
    Ok(dir.join(embeddings::EMBED_FILE_NAME))
}

#[tauri::command]
fn embed_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<EmbedStatus, String> {
    let path = embed_model_path(&app)?;
    let (downloaded, size_bytes) = match std::fs::metadata(&path) {
        Ok(m) => (true, m.len()),
        Err(_) => (false, 0),
    };
    let loaded = state.embed_engine.lock().is_some();
    Ok(EmbedStatus { downloaded, loaded, size_bytes })
}

/// Download the embeddings GGUF into `<app_local_data>/embed/`. Streams
/// progress events on `embed-download-progress`. Idempotent — bails fast
/// if the file is already present.
#[tauri::command]
async fn download_embed_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = embed_model_path(&app)?;
    if path.is_file() {
        return Ok(path.to_string_lossy().into_owned());
    }

    // Refuse re-entrant downloads — the embed model is a single global
    // resource, unlike the chat-model catalog which is per-id.
    if state
        .embed_downloading
        .swap(true, Ordering::SeqCst)
    {
        return Err("an embeddings model download is already in progress".to_string());
    }

    let partial = path.with_extension("gguf.partial");
    let _ = tokio::fs::remove_file(&partial).await;

    let client = reqwest::Client::builder()
        .user_agent("LocalModelStudio/0.1")
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client setup failed: {e}"))?;

    let result: Result<(), String> = async {
        let resp = client
            .get(embeddings::EMBED_DOWNLOAD_URL)
            .send()
            .await
            .map_err(|e| format!("embed download request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("embed download failed: HTTP {}", resp.status()));
        }
        let total = resp.content_length().unwrap_or(0);
        let mut file = tokio::fs::File::create(&partial)
            .await
            .map_err(|e| format!("could not create {partial:?}: {e}"))?;

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        let emit_interval = Duration::from_millis(100);

        #[derive(Serialize, Clone)]
        struct Prog {
            #[serde(rename = "downloadedBytes")]
            downloaded_bytes: u64,
            #[serde(rename = "totalBytes")]
            total_bytes: u64,
        }

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("download stream error: {e}"))?;
            file.write_all(&bytes)
                .await
                .map_err(|e| format!("write failed: {e}"))?;
            downloaded += bytes.len() as u64;

            if last_emit.elapsed() >= emit_interval {
                let _ = app.emit(
                    "embed-download-progress",
                    Prog {
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await.ok();
        drop(file);

        let _ = app.emit(
            "embed-download-progress",
            Prog {
                downloaded_bytes: downloaded,
                total_bytes: if total > 0 { total } else { downloaded },
            },
        );

        tokio::fs::rename(&partial, &path)
            .await
            .map_err(|e| format!("rename failed: {e}"))?;
        Ok(())
    }
    .await;

    state.embed_downloading.store(false, Ordering::SeqCst);
    match result {
        Ok(()) => Ok(path.to_string_lossy().into_owned()),
        Err(e) => {
            let _ = tokio::fs::remove_file(&partial).await;
            Err(e)
        }
    }
}

#[tauri::command]
async fn init_embed_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.embed_engine.lock().is_some() {
        return Ok(());
    }
    let path = embed_model_path(&app)?;
    if !path.is_file() {
        return Err("embeddings model not downloaded yet".to_string());
    }
    let engine = tokio::task::spawn_blocking(move || EmbedEngine::load(&path))
        .await
        .map_err(|e| format!("embed load task panicked: {e}"))?
        .map_err(|e| format!("embed model load failed: {e:#}"))?;
    *state.embed_engine.lock() = Some(Arc::new(engine));
    Ok(())
}

#[tauri::command]
async fn embed_texts(
    state: State<'_, AppState>,
    texts: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    let engine = {
        let guard = state.embed_engine.lock();
        guard
            .clone()
            .ok_or_else(|| "embeddings model not loaded".to_string())?
    };
    let result = tokio::task::spawn_blocking(move || engine.embed_batch(&texts))
        .await
        .map_err(|e| format!("embed task panicked: {e}"))?;
    result.map_err(|e| format!("embedding failed: {e:#}"))
}

#[tauri::command]
fn rag_add_document(
    app: tauri::AppHandle,
    name: String,
    chunks: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    page_count: Option<u32>,
) -> Result<IndexedDoc, String> {
    rag_store::add_document(&app, name, chunks, embeddings, page_count)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn rag_list_documents(app: tauri::AppHandle) -> Result<Vec<IndexedDoc>, String> {
    rag_store::list_documents(&app).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn rag_delete_document(app: tauri::AppHandle, doc_id: String) -> Result<(), String> {
    rag_store::delete_document(&app, &doc_id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn rag_retrieve(
    app: tauri::AppHandle,
    doc_ids: Vec<String>,
    query_embedding: Vec<f32>,
    k: usize,
) -> Result<Vec<RetrievedChunk>, String> {
    rag_store::retrieve(&app, &doc_ids, &query_embedding, k.max(1).min(50))
        .map_err(|e| format!("{e:#}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            init_model,
            init_downloaded_model,
            chat,
            cancel_chat,
            download_model,
            cancel_download,
            list_downloaded_models,
            delete_downloaded_model,
            embed_status,
            download_embed_model,
            init_embed_model,
            embed_texts,
            rag_add_document,
            rag_list_documents,
            rag_delete_document,
            rag_retrieve,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
