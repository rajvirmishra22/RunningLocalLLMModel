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
    model::{params::LlamaModelParams, AddBos, LlamaModel, Special},
    token::data_array::LlamaTokenDataArray,
};
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Arc;

pub struct Engine {
    backend: Arc<LlamaBackend>,
    model: Arc<LlamaModel>,
    ctx_size: u32,
}

pub struct GenerateOpts {
    pub max_tokens: usize,
    pub temperature: f32,
    pub top_p: f32,
}

impl Engine {
    pub fn load(model_path: &Path) -> Result<Self> {
        let backend = LlamaBackend::init().context("failed to init llama backend")?;
        let mut params = LlamaModelParams::default();
        // Offload as many layers as possible to GPU when built with cuda/vulkan features.
        // On CPU-only builds this is a no-op.
        params = params.with_n_gpu_layers(999);

        let model = LlamaModel::load_from_file(&backend, model_path, &params)
            .with_context(|| format!("could not load GGUF model at {model_path:?}"))?;

        Ok(Self {
            backend: Arc::new(backend),
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

        // The frontend formats the full multi-turn conversation using Llama 3's
        // chat template, so we tokenize verbatim. `AddBos::Always` prepends
        // <|begin_of_text|> automatically — the frontend MUST NOT include it.
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
        let last_idx = (tokens.len() - 1) as i32;
        for (i, tok) in tokens.iter().enumerate() {
            batch
                .add(*tok, i as i32, &[0], i as i32 == last_idx)
                .context("batch add failed")?;
        }

        ctx.decode(&mut batch).context("initial decode failed")?;

        let mut n_cur = batch.n_tokens();
        let mut output = String::new();
        let mut produced: usize = 0;

        while produced < opts.max_tokens {
            if cancelled() {
                break;
            }

            // Sample next token. llama-cpp-2 0.1.54 exposes per-position
            // candidates via `candidates_ith(i)` — we want the logits for the
            // last token we just decoded (index = n_tokens - 1).
            let last_idx = batch.n_tokens() - 1;
            let candidates = ctx.candidates_ith(last_idx);
            let mut arr = LlamaTokenDataArray::from_iter(candidates, false);

            // In 0.1.54 the filters take `Option<&mut LlamaContext>` (the
            // context is used for grammar-aware sampling, which we don't use),
            // while the final `sample_token` takes a bare `&mut LlamaContext`.
            if opts.top_p > 0.0 && opts.top_p < 1.0 {
                arr.sample_top_p(Some(&mut ctx), opts.top_p, 1);
            }
            if opts.temperature > 0.0 {
                arr.sample_temp(Some(&mut ctx), opts.temperature);
            }
            let next = arr.sample_token(&mut ctx);

            // Stop on EOS.
            if next == self.model.token_eos() {
                break;
            }

            let piece = self
                .model
                .token_to_str(next, Special::Tokenize)
                .unwrap_or_default();
            // Llama 3 marks end-of-turn with <|eot_id|>, which is distinct from
            // the model's primary EOS and isn't always returned by `token_eos()`.
            // Stop cleanly when we see any of Llama 3's end-of-turn markers.
            if piece == "<|eot_id|>" || piece == "<|end_of_text|>" {
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
