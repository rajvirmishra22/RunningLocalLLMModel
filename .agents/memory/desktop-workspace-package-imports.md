---
name: Desktop can't resolve @workspace/* imports
description: How shared web/desktop pages that import generated @workspace packages stay buildable in the out-of-workspace desktop Tauri build
---

The desktop Tauri build lives OUTSIDE the pnpm workspace, so any `@workspace/*`
import in a shared page (mirrored verbatim from `artifacts/localmodel-studio/src`
into `desktop/src`) fails the desktop bundle with "Cannot find module
'@workspace/...'". This surfaces in CI (GitHub Actions `vite build`), not the
Replit workspace typecheck.

**Rule:** do NOT fork the shared page. Alias the `@workspace/*` specifier to a
desktop-local stub in BOTH `desktop/vite.config.ts` (resolve.alias) and
`desktop/tsconfig.json` (paths). Put the stub under `desktop/stubs/` (NOT
`desktop/src/`) so the web→desktop mirror `cp` never clobbers it — meaning it is
NOT one of the save/restore overlays.

**Why:** keeps the shared page identical across web/desktop (one source of truth)
while satisfying desktop's isolated toolchain. Same spirit as the @tauri-apps
alias→stub trick, inverted direction.

**How to apply:** when a shared page imports a new `@workspace/*` package, add a
matching alias + a stub in `desktop/stubs/` that re-declares the needed types and
implements the calls. Network-backed clients (e.g. the Canvas proxy) must target
`import.meta.env.VITE_API_BASE_URL` (the deployed api-server origin) because the
Tauri webview has no same-origin `/api`; fail loudly if it's unset at build time.
