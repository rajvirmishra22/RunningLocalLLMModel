//! Embeddings engine — a separate llama.cpp context configured with
//! `embeddings = true` and mean pooling. Used by the local RAG pipeline
//! to convert chunks of attached documents (and questions at query time)
//! into dense vectors that can be cosine-compared.
//!
//! The model is a small sentence-embedding GGUF (BGE-small-en-v1.5, ~33 MB
//! at Q8_0). It's NOT bundled with the installer — we keep the installer
//! lean and fetch the file on first use via the existing downloader.

use anyhow::{anyhow, Context, Result};
use llama_cpp_2::{
    context::params::{LlamaContextParams, LlamaPoolingType},
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
};
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Arc;

use crate::inference::shared_backend;

/// File name we store the embeddings GGUF under, inside the app's embed dir.
pub const EMBED_FILE_NAME: &str = "bge-small-en-v1.5-q8_0.gguf";

/// Public download URL. CompendiumLabs republishes BGE in GGUF format with
/// a permissive license; their q8_0 weights are ~33 MB.
pub const EMBED_DOWNLOAD_URL: &str =
    "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf";

/// Embedding dimensionality of bge-small-en-v1.5.
pub const EMBED_DIM: usize = 384;

pub struct EmbedEngine {
    model: Arc<LlamaModel>,
    /// Max sequence length supported by the model (chunks longer than this
    /// in tokens get truncated; chunker tries to keep us well under).
    ctx_size: u32,
}

impl EmbedEngine {
    pub fn load(model_path: &Path) -> Result<Self> {
        let backend = shared_backend()?;

        let params = LlamaModelParams::default().with_n_gpu_layers(0);

        // Apply the same Windows extended-path workaround used in inference.rs.
        let cleaned_path: std::path::PathBuf = {
            let s = model_path.to_string_lossy();
            let trimmed = s
                .strip_prefix(r"\\?\UNC\")
                .map(|rest| format!(r"\\{}", rest))
                .or_else(|| s.strip_prefix(r"\\?\").map(|rest| rest.to_string()))
                .unwrap_or_else(|| s.to_string());
            std::path::PathBuf::from(trimmed)
        };

        if !cleaned_path.exists() {
            return Err(anyhow!(
                "embeddings model not found at {cleaned_path:?}; download it first via the RAG download flow",
            ));
        }

        let model = LlamaModel::load_from_file(&backend, &cleaned_path, &params)
            .with_context(|| format!("could not load embeddings GGUF at {cleaned_path:?}"))?;

        Ok(Self {
            model: Arc::new(model),
            // BGE-small was trained at 512 tokens; we round down to a safe
            // power-of-two context that comfortably holds one ~600-char chunk.
            ctx_size: 512,
        })
    }

    /// Embed a batch of texts. Returns one f32 vector of `EMBED_DIM` length
    /// per input, L2-normalized so cosine similarity is just a dot product.
    ///
    /// We create a fresh context per call and process one text at a time —
    /// this is simpler than juggling multi-sequence batches and the cost is
    /// dominated by tokenization + decode, not context creation.
    pub fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let backend = shared_backend()?;
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(self.ctx_size))
            .with_embeddings(true)
            .with_pooling_type(LlamaPoolingType::Mean);

        let mut out: Vec<Vec<f32>> = Vec::with_capacity(texts.len());

        for text in texts {
            let mut ctx = self
                .model
                .new_context(&backend, ctx_params.clone())
                .context("failed to create embeddings context")?;

            let mut tokens = self
                .model
                .str_to_token(text, AddBos::Always)
                .context("embeddings tokenisation failed")?;

            // Truncate to ctx_size — better than refusing the request.
            let max_tokens = self.ctx_size as usize;
            if tokens.len() > max_tokens {
                tokens.truncate(max_tokens);
            }

            if tokens.is_empty() {
                // Empty input — return a zero vector so the caller's indices
                // line up. Not ideal but better than failing the whole batch.
                out.push(vec![0.0f32; EMBED_DIM]);
                continue;
            }

            let mut batch = LlamaBatch::new(tokens.len(), 1);
            let last = (tokens.len() - 1) as i32;
            for (i, tok) in tokens.iter().enumerate() {
                // For embeddings with mean pooling, all positions need logits/embeds
                // enabled so the pooled output is computed across the sequence.
                batch
                    .add(*tok, i as i32, &[0], i as i32 == last)
                    .context("embeddings batch add failed")?;
            }

            ctx.decode(&mut batch)
                .context("embeddings decode failed")?;

            // With pooling enabled, the per-sequence pooled embedding is at
            // sequence id 0.
            let pooled = ctx
                .embeddings_seq_ith(0)
                .context("could not read pooled embeddings")?;

            // L2-normalize so cosine == dot product. Some models already
            // output normalized vectors; doing it again is cheap and safe.
            let mut v: Vec<f32> = pooled.to_vec();
            let mut norm = 0.0f32;
            for x in &v {
                norm += x * x;
            }
            norm = norm.sqrt();
            if norm > 0.0 {
                for x in v.iter_mut() {
                    *x /= norm;
                }
            }
            out.push(v);
        }

        Ok(out)
    }
}

unsafe impl Send for EmbedEngine {}
unsafe impl Sync for EmbedEngine {}
