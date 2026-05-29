# LocalModel Studio

A self-contained AI chat app that runs open-source language models entirely on the user's hardware. Ships two ways:

1. **Desktop `.exe`** — native Windows build via Tauri + `llama.cpp`. Ships with a small starter model bundled inside the installer; works immediately after install, no extra downloads.
2. **In-browser** — same UI running on WebGPU via WebLLM, served at `/app/` as a "try in browser" fallback.

## Artifacts in this project

- `artifacts/landing/` — marketing & download site, served at `/`. Dual CTA: "Download for Windows" (placeholder URL until the `.exe` is published) + "Try in browser" (→ `/app/`).
- `artifacts/localmodel-studio/` — in-browser chat app served at `/app/`. WebGPU + WebLLM.
- `artifacts/api-server/` — scaffold; not used.
- `artifacts/mockup-sandbox/` — canvas/mockup sandbox; not used in production.
- `desktop/` — **not** a Replit artifact and **not** part of the pnpm workspace. The full source for the Tauri + llama.cpp native build, including the React UI, Rust backend, bundler config, and model-fetch scripts. Built externally (Windows machine or GitHub Actions) to produce a real signed `.exe`. See `desktop/README.md`.

## Run & Operate

- `pnpm --filter @workspace/landing run dev` — marketing site
- `pnpm --filter @workspace/localmodel-studio run dev` — in-browser chat app
- `pnpm run typecheck` — full typecheck across all workspace packages (excludes `desktop/`)
- Desktop build (run on a Windows machine, not in Replit):
  - `cd desktop && npm install && bash scripts/fetch-model.sh && npm run tauri build`

## Where the desktop installer URL gets wired in

After you build the `.exe` (locally or via GitHub Actions) and host it somewhere, paste its public URL into:

```ts
// artifacts/landing/src/components/landing/InstallCTA.tsx
const WINDOWS_INSTALLER_URL = "https://...your-cdn-or-release.../localmodel-studio.exe";
```

Until that's set, the landing page shows "WINDOWS .EXE — COMING SOON" as a disabled button. The "Try in browser" CTA always works.

## Stack

- **Workspace (Replit-hosted)**: pnpm workspaces, Node.js 24, TypeScript 5.9, React + Vite + Tailwind CSS v4 + shadcn/ui + framer-motion + wouter.
- **In-browser inference** (`artifacts/localmodel-studio`): `@mlc-ai/web-llm` on WebGPU. Cached to IndexedDB after first download.
- **Desktop inference** (`desktop/`): Tauri 2 + `llama-cpp-2` (Rust bindings around native llama.cpp). Bundled starter model (`Llama-3.2-1B-Instruct-Q4_K_M.gguf`, ~770 MB) included in the installer via Tauri's `bundle.resources`. Prompt template in `desktop/src-tauri/src/inference.rs` uses Llama 3 header tokens (`<|start_header_id|>...`); stops on `<|eot_id|>` / `<|end_of_text|>`.
  - **GPU acceleration is a build-time choice.** The default Cargo build is CPU-only (`[features] default = []`), so 7B+ models decode at only a few tok/s even though the code requests `n_gpu_layers = 999`. Build with `--features vulkan` (portable across NVIDIA/AMD/Intel) or `cuda`/`metal` for 5-20x faster inference — see `desktop/README.md`. The engine sets `n_threads` to the full logical core count automatically.
  - **Adaptive context window** in `inference.rs`: 16K for ≤3B models, 8K for 7-8B, 4K for 13B+, scaled by the GGUF file size. This bounds KV-cache RAM so large models don't exhaust memory and crash the app. The KV cache is allocated per-generation and freed afterwards; idle memory is dominated by the resident model weights (reclaim via Settings → Unload). Over-long prompts/attachments return a clean error rather than force-quitting.
- **Storage** (web app): localStorage for conversations/profiles; IndexedDB for model weights.

## Where things live (in-browser app)

- `artifacts/localmodel-studio/src/pages/` — Dashboard, Chat, Models, Settings
- `artifacts/localmodel-studio/src/services/` — webllmService, storageService, systemInfo
- `artifacts/localmodel-studio/src/components/` — shared UI components
- `artifacts/localmodel-studio/src/index.css` — theme / CSS variables

## Where things live (desktop)

- `desktop/src/` — **the same React UI as the in-browser app**. The full `artifacts/localmodel-studio/src/` tree is mirrored here (pages, components, hooks, lib, services, index.css). Only one file is intentionally divergent.
- `desktop/src/services/webllmService.ts` — Tauri-backed drop-in replacement that exposes the **same interface** as the web's `webllmService` (`WEBLLM_MODELS`, `checkWebGPU`, `loadModel`, `streamChat`, `unload`, `getLoadedModelId`). Internally it calls Tauri `invoke("chat" / "init_model" / "cancel_chat")` and listens to the `token` event. Multi-turn conversation history is formatted client-side with Llama 3 header tokens, then sent as one raw prompt to Rust.
- `desktop/src/services/rag/ragBackend.ts` — Tauri-backed drop-in for the RAG embeddings/store backend. Same shape as the web version (`@xenova/transformers` + in-memory map); this one invokes `embed_status`, `download_embed_model`, `init_embed_model`, `embed_texts`, `rag_add_document`, `rag_list_documents`, `rag_delete_document`, `rag_retrieve` and listens to `embed-download-progress`. Persists across reloads.
- `desktop/src-tauri/src/main.rs` — Tauri entry point + command handlers (`init_model`, `chat`, `cancel_chat`).
- `desktop/src-tauri/src/inference.rs` — llama.cpp wrapper. Tokenizes the prompt verbatim (no template wrapping — the frontend does that) and streams generation, stopping on `<|eot_id|>` / `<|end_of_text|>`. Also exposes a `pub shared_backend()` so `embeddings.rs` reuses the same process-wide `llama_backend_init`.
- `desktop/src-tauri/src/embeddings.rs` — second llama.cpp engine, configured with `with_embeddings(true) + with_pooling_type(Mean)`, loaded lazily from `<app_local_data>/embed/bge-small-en-v1.5-q8_0.gguf` (~33 MB Q8). L2-normalises every output so cosine = dot product. Used by the RAG pipeline.
- `desktop/src-tauri/src/rag_store.rs` — JSON-on-disk RAG store. One `<docId>.json` per document plus a small `index.json`, all under `<app_local_data>/rag/`. No new compile-time deps (no rusqlite); robust to partial writes; ample for typical "dozens of docs, ~200 chunks each" usage.
- `desktop/src-tauri/tauri.conf.json` — bundler config, including `bundle.resources` that ships `model.gguf` with the installer.
- `desktop/scripts/fetch-model.{sh,ps1}` — downloads the starter GGUF before building.

### Updating the desktop UI

Edit the web app (`artifacts/localmodel-studio/src/`) and re-copy into `desktop/src/`, **preserving the desktop-only overlay files**: `services/webllmService.ts`, `services/rag/ragBackend.ts`, and `pages/Models.tsx` (the desktop Models page has download / cancel / delete-weights UI for non-bundled GGUFs that doesn't exist in the web build). From the repo root:

```bash
# Save the Tauri overlays, sync, restore.
cp desktop/src/services/webllmService.ts /tmp/webllmService.desktop.ts
cp desktop/src/services/rag/ragBackend.ts /tmp/ragBackend.desktop.ts
cp desktop/src/pages/Models.tsx /tmp/Models.desktop.tsx
cp -r artifacts/localmodel-studio/src/. desktop/src/
cp /tmp/webllmService.desktop.ts desktop/src/services/webllmService.ts
cp /tmp/ragBackend.desktop.ts desktop/src/services/rag/ragBackend.ts
cp /tmp/Models.desktop.tsx desktop/src/pages/Models.tsx
```

This is by design — desktop is outside the pnpm workspace, so we can't import the web's source directly. Keeping them in sync via copy + two overlays is the simplest contract.

### What works in the desktop build (vs the web build)

- **Bundled Llama 3.2 1B Instruct**: works out of the box (native llama.cpp). The Models / Dashboard / Chat / Tuning / Settings pages all light up against it because the shim returns `checkWebGPU() === true` and reports the bundled model id as "loaded".
- **Cloud BYO API keys (OpenAI / Anthropic)**: works identically — `cloudProviders.ts` uses `fetch` to OpenAI/Anthropic, which works inside Tauri's webview. Vision-capable cloud models (e.g. `gpt-4o`, `claude-3.5-sonnet`) accept image attachments — `CloudMessage.content` is a parts array, and `cloudModelSupportsVision()` gates the in-chat image picker.
- **Image attachments in chat**: the Chat composer has an image-upload button that lights up whenever the selected model is vision-capable (cloud vision model, or a desktop GGUF flagged `vision: true`). `services/imageAttach.ts` pre-resizes to max 2048px and re-encodes as JPEG q0.85 before sending, so a 10 MB phone photo lands as a ~300 KB data URL. Sent images render as small chips above the input.
- **Local vision (desktop only)**: vision-flagged catalog entries (Llama 3.2 11B Vision, MiniCPM-V 2.6, Qwen2-VL 7B, LLaVA 1.6, Moondream 2, Gemma 3 4B) download TWO files — the LLM GGUF and a companion `mmproj` (CLIP-style image projector). At chat time, when the active model has `vision: true` and the message includes images, the desktop `webllmService.streamChat` routes to the `chat_with_images` Tauri command, which spawns `llama-mtmd-cli` with `--mmproj`, `-m`, and one `--image <tempfile>` per attachment via `tokio::process::Command`, streaming stdout back as `token` events. The helper binary is **not** bundled with the installer (and not declared via Tauri's `externalBin` — that hard-fails the build when the file is missing). Instead, the user installs it post-install from **Settings → Local Vision Helper**: they grab the prebuilt llama.cpp release for their OS, paste the path to `llama-mtmd-cli[.exe]`, and the `install_mtmd_cli` Tauri command copies it (plus any sibling `.dll`s on Windows) into `<app_local_data>/bin/`. FFI was rejected because `llama-cpp-2` doesn't expose llava/mtmd bindings and hand-rolling them is brittle across llama.cpp versions.
- **Local RAG over attachments**: works. Attaching a file larger than ~4000 chars in Chat triggers background indexing — chunking happens in JS, embeddings come from BGE-small (~33 MB GGUF, auto-downloaded on first use into `<app_local_data>/embed/`), and docs are persisted as JSON under `<app_local_data>/rag/`. At send time only the top-K most relevant chunks reach the chat model. **Display vs. model separation**: the chat bubble renders only what the user typed (`Message.content`) plus small file chips (`Message.attachments`); the augmented prompt — RAG excerpts + inlined file text — lives in `Message.modelContent` and is what's actually sent (`modelContent ?? content`). Users never see "[excerpt N, relevance X]" or extracted text in the bubble. The **Knowledge** tab in the sidebar lists every indexed doc and lets you delete them. On web the same flow runs via `@xenova/transformers` ONNX in-browser, but the index is in-memory and the Knowledge tab is hidden.
- **Other models in the catalog (Llama 3B/8B, Qwen, Phi, Mistral)**: downloadable in-app. The Models page Catalog section shows a Download button per entry; the Rust side streams the GGUF from Hugging Face into `<app_local_data>/models/<id>.gguf` with progress events, supports cancel, and `init_downloaded_model` loads it on first chat. Multiple models can coexist on disk.
- **Custom Hugging Face models**: the Models page has an "Add from Hugging Face" button (desktop only — gated on `isCustomCatalogSupported()`). The user pastes any public `.gguf` URL, the app HEAD-probes it via the Rust `probe_model_url` command to fetch the real Content-Length, suggests a name/family/RAM requirement, and (if confirmed) appends the model to a custom catalog persisted in localStorage under `lms.custom_models.v1`. The merged catalog (`getCatalog()` = built-ins + custom) is the source of truth for the catalog grid, the profile-edit dropdown, and `getModelById` inside `webllmService` — so a custom model behaves like a first-class entry everywhere (download/load/chat). Removing a custom entry also deletes the on-disk GGUF and any matching `ModelProfile`. Web build exports the same surface as no-op throwers so the shared Models.tsx compiles.

## Architecture decisions

- **Two engines, one product**: the desktop build uses native llama.cpp for full-speed inference using the user's full GPU/CPU; the in-browser build uses WebGPU + WebLLM as a friction-free fallback. Same UX, different runtime.
- **Bundled starter model**: installer size is dominated by the model (~400 MB out of ~440 MB). Bundling means the app works zero-config after install — no second download, no setup wizard.
- **Local-first, cloud-optional**: both builds run open-source models on the user's own hardware out of the box, with no backend, account, or telemetry. As of the BYO-API-key feature, users *can* paste their own OpenAI or Anthropic API key in Settings (web) or "Cloud Keys" (desktop) and route specific messages through those providers — strictly opt-in, per-message, with a clear "Sending to X" badge. The consumer ChatGPT Plus / Claude Pro subscriptions are not usable here; only developer API keys work. Keys live in localStorage.
- **Desktop project sits outside the pnpm workspace** so its npm + Rust toolchain doesn't conflict with workspace tooling, and Replit's typecheck/workflows ignore it.

## Product

LocalModel Studio is for developers and AI enthusiasts who want to run open-source LLMs without renting them. You can:
- Chat with open-source models entirely on your own machine (or in your own browser).
- Manage model profiles (sampling params, context length).
- See system info and model recommendations.
- Keep every conversation local — nothing leaves the device.

## User preferences

- UI should be modern and user friendly, but simple and not too much going on.
- No third-party tools or external installs — the desktop app must work immediately after install with no additional downloads.
- Keep the desktop installer small — bundle exactly one small starter model, not many.
- Landing page is dark, modern, scroll-driven, animated, with a top scroll-progress bar and non-templated features.

## Gotchas

- The in-browser build requires WebGPU (Chrome 113+ / Edge 113+ on a device with a supported GPU). First model load needs internet; after that the model runs offline.
- The desktop `.exe` is **not** built from inside Replit — Replit is Linux and can't produce a signed Windows installer. Use a Windows machine or GitHub Actions; see `desktop/README.md` for the workflow.
- The first `cargo tauri build` is slow (10–20 min) because `llama-cpp-2` compiles llama.cpp from source. Subsequent builds are incremental.
- The desktop build does NOT use WebGPU. It uses llama.cpp's CPU/CUDA/Vulkan backends directly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- See the `artifacts` skill for how artifact routing/paths work.
- See `desktop/README.md` for full build instructions for the native installer.
