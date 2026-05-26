//! Persistent on-disk RAG store. One JSON file per document under
//! `<app_local_data>/rag/<docId>.json`, plus a small `index.json` for fast
//! listing without parsing every chunk file.
//!
//! Storage shape was chosen for robustness over throughput — for typical
//! usage (dozens of attached PDFs / notes, each with <200 chunks) JSON is
//! plenty fast and survives crashes / partial writes far more gracefully
//! than a sqlite database compiled from a new dep.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedDoc {
    #[serde(rename = "docId")]
    pub doc_id: String,
    pub name: String,
    #[serde(rename = "chunkCount")]
    pub chunk_count: usize,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "pageCount", default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredChunk {
    pub text: String,
    /// f32 embedding, already L2-normalized.
    pub embedding: Vec<f32>,
}

#[derive(Serialize, Deserialize)]
pub struct StoredDoc {
    #[serde(rename = "docId")]
    pub doc_id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "pageCount", default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
    pub chunks: Vec<StoredChunk>,
}

#[derive(Serialize, Clone)]
pub struct RetrievedChunk {
    #[serde(rename = "docId")]
    pub doc_id: String,
    #[serde(rename = "docName")]
    pub doc_name: String,
    pub text: String,
    pub score: f32,
    #[serde(rename = "chunkIndex")]
    pub chunk_index: usize,
}

/// Sanitize a docId so it's safe to use as a filename.
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

pub fn rag_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("rag");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create rag dir at {dir:?}"))?;
    Ok(dir)
}

pub fn embed_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .context("could not resolve app local data dir")?;
    let dir = base.join("embed");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create embed dir at {dir:?}"))?;
    Ok(dir)
}

pub fn doc_path(app: &AppHandle, doc_id: &str) -> Result<PathBuf> {
    Ok(rag_dir(app)?.join(format!("{}.json", sanitize(doc_id))))
}

fn index_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(rag_dir(app)?.join("index.json"))
}

fn load_index(app: &AppHandle) -> HashMap<String, IndexedDoc> {
    let path = match index_path(app) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_index(app: &AppHandle, index: &HashMap<String, IndexedDoc>) -> Result<()> {
    let path = index_path(app)?;
    let json = serde_json::to_string_pretty(index)?;
    std::fs::write(&path, json)
        .with_context(|| format!("failed to write rag index at {path:?}"))?;
    Ok(())
}

fn gen_doc_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("doc_{nanos:x}")
}

pub fn add_document(
    app: &AppHandle,
    name: String,
    chunks: Vec<String>,
    embeddings: Vec<Vec<f32>>,
    page_count: Option<u32>,
) -> Result<IndexedDoc> {
    if chunks.len() != embeddings.len() {
        return Err(anyhow!(
            "chunks ({}) and embeddings ({}) length mismatch",
            chunks.len(),
            embeddings.len()
        ));
    }
    let doc_id = gen_doc_id();
    let created_at = chrono_like_now();

    let stored = StoredDoc {
        doc_id: doc_id.clone(),
        name: name.clone(),
        created_at: created_at.clone(),
        page_count,
        chunks: chunks
            .into_iter()
            .zip(embeddings.into_iter())
            .map(|(text, embedding)| StoredChunk { text, embedding })
            .collect(),
    };

    let path = doc_path(app, &doc_id)?;
    let json = serde_json::to_string(&stored)?;
    std::fs::write(&path, json)
        .with_context(|| format!("failed to write rag doc at {path:?}"))?;

    let meta = IndexedDoc {
        doc_id: doc_id.clone(),
        name,
        chunk_count: stored.chunks.len(),
        created_at,
        page_count,
    };

    let mut index = load_index(app);
    index.insert(doc_id.clone(), meta.clone());
    save_index(app, &index)?;

    Ok(meta)
}

pub fn list_documents(app: &AppHandle) -> Result<Vec<IndexedDoc>> {
    let mut docs: Vec<IndexedDoc> = load_index(app).into_values().collect();
    docs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(docs)
}

pub fn delete_document(app: &AppHandle, doc_id: &str) -> Result<()> {
    let path = doc_path(app, doc_id)?;
    if path.is_file() {
        std::fs::remove_file(&path).ok();
    }
    let mut index = load_index(app);
    index.remove(doc_id);
    save_index(app, &index)?;
    Ok(())
}

pub fn retrieve(
    app: &AppHandle,
    doc_ids: &[String],
    query: &[f32],
    k: usize,
) -> Result<Vec<RetrievedChunk>> {
    let mut scored: Vec<RetrievedChunk> = Vec::new();
    for doc_id in doc_ids {
        let path = match doc_path(app, doc_id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let doc: StoredDoc = match serde_json::from_str(&raw) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for (i, ch) in doc.chunks.iter().enumerate() {
            let score = cosine(query, &ch.embedding);
            scored.push(RetrievedChunk {
                doc_id: doc.doc_id.clone(),
                doc_name: doc.name.clone(),
                text: ch.text.clone(),
                score,
                chunk_index: i,
            });
        }
    }
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    Ok(scored)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    let mut dot = 0.0f32;
    for i in 0..len {
        dot += a[i] * b[i];
    }
    dot
}

/// Tiny RFC3339-ish "now" so we don't pull in chrono for one field.
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Just store a unix-second string; the frontend formats it. Keeps this
    // dep-free and timezone-agnostic.
    format!("{secs}")
}
