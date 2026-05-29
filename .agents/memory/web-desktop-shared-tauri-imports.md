---
name: Shared web/desktop files must not hard-import Tauri
description: Why shared Settings.tsx broke the web build, and the alias-stub pattern that fixes runtime-gated desktop-only imports.
---

# Tauri imports in source shared between the web and desktop builds

LocalModel Studio mirrors `artifacts/localmodel-studio/src/` into `desktop/src/`
(desktop is outside the pnpm workspace). Only three files are desktop overlays:
`services/webllmService.ts`, `services/rag/ragBackend.ts`, `pages/Models.tsx`.
**Every other file is shared verbatim**, including `pages/Settings.tsx`.

**Trap:** a shared file that does `await import("@tauri-apps/api/core")` — even
dynamically and even gated behind `isCustomCatalogSupported()`/`isDesktop` at
runtime — still crashes the **web** build. Vite's import-analysis resolves
dynamic-import specifiers at transform time; the web artifact has no
`@tauri-apps/api` dependency, so the whole `/app/` route 500s with
`[plugin:vite:import-analysis] Failed to resolve import "@tauri-apps/api/core"`.
The runtime gate does not help because the failure is at build/transform time.

**Fix (in place):** alias the bare specifier to a stub in the *web* Vite config
only:
- `artifacts/localmodel-studio/src/lib/tauri-core-stub.ts` exports an `invoke`
  that rejects loudly (never reached on web).
- web `vite.config.ts` `resolve.alias` maps `@tauri-apps/api/core` → that stub.
- desktop builds with its **own** Vite config and resolves the real package, so
  the alias is web-only and the desktop build is unaffected.

**Why:** keeps Tauri entirely out of the web bundle (consistent with the overlay
pattern) without a big refactor of the shared Settings page.

**How to apply:** if you add a new Tauri (`@tauri-apps/...`) import to any shared
(non-overlay) file, either move it into an overlay file or add a matching
web-side alias+stub. Always restart `artifacts/localmodel-studio` and load
`/app/` after such changes — a green typecheck does NOT catch this; only the
running web build does.
