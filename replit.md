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
- **Storage** (web app): localStorage for conversations/profiles; IndexedDB for model weights.

## Where things live (in-browser app)

- `artifacts/localmodel-studio/src/pages/` — Dashboard, Chat, Models, Settings
- `artifacts/localmodel-studio/src/services/` — webllmService, storageService, systemInfo
- `artifacts/localmodel-studio/src/components/` — shared UI components
- `artifacts/localmodel-studio/src/index.css` — theme / CSS variables

## Where things live (desktop)

- `desktop/src/` — React UI (chat window, status bar, composer). Talks to the Rust side via Tauri `invoke`.
- `desktop/src/api.ts` — Typed wrappers over Tauri commands (`init_model`, `chat`, `cancel_chat`) and the `token` stream event.
- `desktop/src-tauri/src/main.rs` — Tauri entry point + command handlers (init/chat/cancel).
- `desktop/src-tauri/src/inference.rs` — llama.cpp wrapper: model load, ChatML prompt formatting, streaming generation with cancellation.
- `desktop/src-tauri/tauri.conf.json` — bundler config, including `bundle.resources` that ships `model.gguf` with the installer.
- `desktop/scripts/fetch-model.{sh,ps1}` — downloads the starter GGUF before building.

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
