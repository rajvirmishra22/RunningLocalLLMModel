// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod inference;

use inference::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    name: String,
    path: String,
    loaded: bool,
}

#[tauri::command]
async fn init_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ModelInfo, String> {
    // Resolve the bundled model path. Tauri copies resources/model.gguf into the
    // app's resource directory at install time — see tauri.conf.json -> bundle.resources.
    let model_path = app
        .path()
        .resolve("model.gguf", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("could not resolve bundled model path: {e}"))?;

    if !model_path.exists() {
        return Err(format!(
            "Bundled model not found at {model_path:?}. \
             Did you run scripts/fetch-model.sh before building?"
        ));
    }

    // Loading the model is heavy — push to a blocking pool.
    let mp = model_path.clone();
    let engine = tokio::task::spawn_blocking(move || Engine::load(&mp))
        .await
        .map_err(|e| format!("model load task panicked: {e}"))?
        .map_err(|e| format!("model load failed: {e}"))?;

    let name = model_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model.gguf")
        .to_string();
    let path_str = model_path.to_string_lossy().into_owned();

    *state.engine.lock() = Some(Arc::new(engine));

    Ok(ModelInfo { name, path: path_str, loaded: true })
}

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    prompt: String,
    max_tokens: usize,
    temperature: f32,
    top_p: f32,
) -> Result<String, String> {
    // Clone owned handles out of state so the spawn_blocking closure is 'static.
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
            },
            emit,
            move || cancel_for_check.load(Ordering::SeqCst),
        )
    })
    .await
    .map_err(|e| format!("inference task panicked: {e}"))?;

    result.map_err(|e| format!("inference failed: {e}"))
}

#[tauri::command]
fn cancel_chat(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![init_model, chat, cancel_chat])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
