# LocalModel Studio

A local AI model desktop-style web app that lets users run open-source models privately on their own hardware via Ollama and llama.cpp. All data stays local — no cloud, no telemetry.

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
- Storage: localStorage (no database — all data is local to the user's browser)
- No backend API — connects directly to Ollama's HTTP API at localhost:11434

## Where things live

- `artifacts/localmodel-studio/src/` — all frontend source
- `artifacts/localmodel-studio/src/pages/` — Dashboard, Chat, Models, Settings
- `artifacts/localmodel-studio/src/services/` — ollamaService, storageService, systemInfo
- `artifacts/localmodel-studio/src/components/` — shared UI components
- `artifacts/localmodel-studio/src/index.css` — theme / CSS variables

## Architecture decisions

- **Frontend-only**: The app is a pure SPA. There is no Express backend. All persistence is via localStorage.
- **Local inference only**: Ollama API calls go to `localhost:11434` (configurable). Nothing is sent to the cloud.
- **Dark mode by default**: `dark` class added to `document.documentElement` on mount, persisted in localStorage.
- **Streaming via fetch**: Chat uses `fetch` with `stream: true` to Ollama's `/api/chat` endpoint, reading a `ReadableStream` for token-by-token output.
- **No codegen**: No OpenAPI spec or Orval hooks — not needed since there is no custom backend.

## Product

LocalModel Studio gives developers and AI enthusiasts a clean, private UI to:
- Run Ollama models locally via chat
- Manage model profiles (Ollama names and GGUF paths)
- Monitor Ollama/llama.cpp runtime status
- View system info and hardware recommendations
- Store all conversations locally in the browser

## User preferences

- UI should be modern and user friendly, but simple and not too much going on

## Gotchas

- Ollama must be running locally (`ollama serve`) for any inference features to work
- CORS: Ollama must be configured to allow requests from the browser origin (set `OLLAMA_ORIGINS=*` env var)
- The app defaults to dark mode; light mode can be toggled from settings

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
