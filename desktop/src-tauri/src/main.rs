// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod download;
mod inference;

use download::{DownloadRegistry, DownloadedModel};
use inference::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    loaded_model_id: Mutex<Option<String>>,
    cancel: Arc<AtomicBool>,
    downloads: DownloadRegistry,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
