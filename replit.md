# LocalModel Studio

A self-contained AI chat app that runs open-source language models entirely in the browser via WebGPU (WebLLM). No installs, no servers, no Ollama — just open the app and chat. All data stays local — no cloud, no telemetry.

## Run & Operate

- `pnpm --filter @workspace/localmodel-studio run dev` — run the frontend (workflow: web)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS
- Routing: wouter
- UI: shadcn/ui components
- Animations: framer-motion
- Inference: `@mlc-ai/web-llm` (in-browser WebGPU, fully offline after first model download)
- Storage: localStorage for conversations/profiles; browser cache (IndexedDB) for model weights
- No backend API, no external runtimes

## Where things live

- `artifacts/localmodel-studio/src/` — all frontend source
- `artifacts/localmodel-studio/src/pages/` — Dashboard, Chat, Models, Settings
- `artifacts/localmodel-studio/src/services/` — webllmService, storageService, systemInfo
- `artifacts/localmodel-studio/src/components/` — shared UI components
- `artifacts/localmodel-studio/src/index.css` — theme / CSS variables

## Architecture decisions

- **Frontend-only, self-contained**: Pure SPA. No backend, no external runtimes. Single packaged app.
- **In-browser inference**: All inference runs locally via WebLLM on WebGPU. The model file is fetched from a CDN the first time, then cached and runs fully offline.
- **Dark mode by default**: `dark` class added to `document.documentElement` on mount, persisted in localStorage.
- **Streaming via WebLLM**: Chat uses `engine.chat.completions.create({ stream: true })` and iterates an async stream for token-by-token output.
- **No codegen**: No OpenAPI spec or Orval hooks — not needed since there is no custom backend.

## Product

LocalModel Studio gives developers and AI enthusiasts a clean, private UI to:
- Chat with open-source LLMs running entirely in the browser
- Manage model profiles (sampling params, context length)
- See system info, WebGPU status, and model recommendations
- Store all conversations locally — nothing leaves the device

## User preferences

- UI should be modern and user friendly, but simple and not too much going on
- No third-party tools or external installs — the app must be a single, self-contained package

## Gotchas

- WebGPU is required — Chrome 113+ or Edge 113+ on a device with a supported GPU
- First model load needs internet to download weights (~0.7–5 GB depending on model). After that the model runs fully offline.
- The app defaults to dark mode; light mode can be toggled from settings

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
