//! Thin wrapper around llama-cpp-2 that exposes a streaming text-generation API.
//!
//! This module is intentionally compact — it owns the model + a single context,
//! and runs generation synchronously on a blocking thread. The Tauri layer
//! (main.rs) handles concurrency, cancellation flags, and token-event emission.

use anyhow::{anyhow, Context, Result};
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Arc, OnceLock};

/// `llama_backend_init` may only be called **once per process** — calling it
/// a second time returns `BackendAlreadyInitialized` and fails the load.
/// Cache the backend in a process-wide `OnceLock` so every `Engine::load`
/// (bundled model on startup, then any user-downloaded model) reuses the
/// same instance instead of re-initializing.
static BACKEND: OnceLock<Arc<LlamaBackend>> = OnceLock::new();

fn shared_backend() -> Result<Arc<LlamaBackend>> {
    if let Some(b) = BACKEND.get() {
        return Ok(b.clone());
    }
    let b = Arc::new(LlamaBackend::init().context("failed to init llama backend")?);
    // Race: another thread may have set it first; that's fine, use whichever won.
    let _ = BACKEND.set(b.clone());
    Ok(BACKEND.get().cloned().unwrap_or(b))
}

pub struct Engine {
    backend: Arc<LlamaBackend>,
    model: Arc<LlamaModel>,
    ctx_size: u32,
}

pub struct GenerateOpts {
    pub max_tokens: usize,
    pub temperature: f32,
    pub top_p: f32,
    /// Decoded-piece stop markers. We break out of the generation loop as soon
    /// as the model emits any of these (e.g. `<|eot_id|>` for Llama 3,
    /// `<|im_end|>` for Qwen / ChatML, `<|end|>` for Phi 3.5).
    pub stop_strings: Vec<String>,
}

impl Engine {
    pub fn load(model_path: &Path) -> Result<Self> {
        let backend = shared_backend()?;
        let mut params = LlamaModelParams::default();
        // Offload as many layers as possible to GPU when built with cuda/vulkan/metal features.
        // On CPU-only builds this is a no-op.
        params = params.with_n_gpu_layers(999);

        // On Windows, Tauri's path resolver returns extended-length paths
        // prefixed with `\\?\`. llama.cpp opens files via C `fopen()`, which
        // doesn't accept that prefix on every Windows build. Strip it so we
        // hand llama.cpp a plain `C:\...` path.
        let cleaned_path: std::path::PathBuf = {
            let s = model_path.to_string_lossy();
            let trimmed = s
                .strip_prefix(r"\\?\UNC\")
                .map(|rest| format!(r"\\{}", rest))
                .or_else(|| s.strip_prefix(r"\\?\").map(|rest| rest.to_string()))
                .unwrap_or_else(|| s.to_string());
            std::path::PathBuf::from(trimmed)
        };

        // Diagnostic: read the GGUF magic bytes + file size before loading.
        // llama.cpp logs the real failure reason to stderr inside the C lib,
        // which a windowed app discards. Without these breadcrumbs, every
        // load failure surfaces as the unhelpful "null result from llama_cpp".
        let diag = {
            let size = std::fs::metadata(&cleaned_path)
                .map(|m| m.len())
                .unwrap_or(0);
            let mut magic = [0u8; 8];
            let read_ok = {
                use std::io::Read;
                std::fs::File::open(&cleaned_path)
                    .and_then(|mut f| f.read_exact(&mut magic))
                    .is_ok()
            };
            let magic_str = if read_ok {
                let ascii: String = magic
                    .iter()
                    .map(|b| {
                        if b.is_ascii_graphic() {
                            *b as char
                        } else {
                            '.'
                        }
                    })
                    .collect();
                format!(
                    "{ascii:?} (hex {:02x} {:02x} {:02x} {:02x})",
                    magic[0], magic[1], magic[2], magic[3]
                )
            } else {
                "<could not read first 8 bytes>".to_string()
            };
            format!(
                "size={} bytes ({:.1} MB), magic={}",
                size,
                size as f64 / (1024.0 * 1024.0),
                magic_str
            )
        };

        let model = LlamaModel::load_from_file(&backend, &cleaned_path, &params)
            .with_context(|| format!("could not load GGUF at {cleaned_path:?}; {diag}"))?;

        Ok(Self {
            backend,
            model: Arc::new(model),
            ctx_size: 4096,
        })
    }

    /// Run a single prompt and stream tokens via `on_token`. Returns the full
    /// decoded string. `cancelled` is polled between tokens — if it returns
    /// true, generation stops cleanly and the partial output is returned.
    pub fn generate(
        &self,
        prompt: &str,
        opts: GenerateOpts,
        mut on_token: impl FnMut(&str),
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<String> {
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(self.ctx_size));

        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .context("failed to create llama context")?;

        // The frontend formats the full multi-turn conversation using each
        // model family's chat template, so we tokenize verbatim. `AddBos::Always`
        // prepends the model's BOS token automatically — the frontend MUST NOT
        // include it.
        let tokens = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .context("tokenisation failed")?;

        if tokens.len() as u32 >= self.ctx_size {
            return Err(anyhow!(
                "prompt is longer than the model's context window ({} >= {})",
                tokens.len(),
                self.ctx_size
            ));
        }

        let mut batch = LlamaBatch::new(self.ctx_size as usize, 1);
        let last_prompt_idx = (tokens.len() - 1) as i32;
        for (i, tok) in tokens.iter().enumerate() {
            batch
                .add(*tok, i as i32, &[0], i as i32 == last_prompt_idx)
                .context("batch add failed")?;
        }

        ctx.decode(&mut batch).context("initial decode failed")?;

        // Build the sampler chain once. llama-cpp-2 0.1.146 replaced the
        // direct sample_top_p/sample_temp/sample_token methods on
        // LlamaTokenDataArray with this composable chain API. A chain must
        // end with one of greedy / dist / mirostat — we use dist(0) for
        // randomized sampling and greedy() when temperature is 0.
        let mut sampler = if opts.temperature <= 0.0 {
            LlamaSampler::chain_simple([LlamaSampler::greedy()])
        } else {
            let mut chain = Vec::new();
            if opts.top_p > 0.0 && opts.top_p < 1.0 {
                chain.push(LlamaSampler::top_p(opts.top_p, 1));
            }
            chain.push(LlamaSampler::temp(opts.temperature));
            chain.push(LlamaSampler::dist(0));
            LlamaSampler::chain_simple(chain)
        };

        let mut n_cur = batch.n_tokens();
        let mut output = String::new();
        let mut produced: usize = 0;
        let mut decoder = encoding_rs::UTF_8.new_decoder();

        while produced < opts.max_tokens {
            if cancelled() {
                break;
            }

            // Sample from the logits for the last decoded position.
            let last_idx = batch.n_tokens() - 1;
            let next = sampler.sample(&ctx, last_idx);
            sampler.accept(next);

            // Stop on EOS.
            if self.model.is_eog_token(next) {
                break;
            }

            // Decode the piece. `special = true` so end-of-turn markers like
            // <|eot_id|> / <|im_end|> / <|end|> decode to their printable form
            // and we can match them against stop_strings.
            let piece = self
                .model
                .token_to_piece(next, &mut decoder, true, None)
                .unwrap_or_default();
            if opts.stop_strings.iter().any(|s| s == &piece) {
                break;
            }
            output.push_str(&piece);
            on_token(&piece);

            // Feed the sampled token back in.
            batch.clear();
            batch
                .add(next, n_cur, &[0], true)
                .context("batch add (continuation) failed")?;
            ctx.decode(&mut batch).context("decode failed")?;
            n_cur += 1;
            produced += 1;
        }

        Ok(output)
    }
}

// llama-cpp-2's types are `!Send` in some configurations; the engine is held
// behind an `Arc<Mutex<...>>` in the Tauri state so this is fine in practice.
unsafe impl Send for Engine {}
unsafe impl Sync for Engine {}
