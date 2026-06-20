# Memory Index

- [Shared web/desktop Tauri imports](web-desktop-shared-tauri-imports.md) — dynamic `@tauri-apps/api/core` import in a shared (non-overlay) file 500s the web Vite build; fix with a web-only alias→stub.
- [Desktop can't resolve @workspace/* imports](desktop-workspace-package-imports.md) — shared pages importing `@workspace/*` break the desktop bundle; alias to a `desktop/stubs/` stub in vite + tsconfig.
- [llama-cpp version pinning](llama-cpp-version-pinning.md) — pin `llama-cpp-2` AND `llama-cpp-sys-2` to the same exact version in Cargo.toml; `^` on the sys dep drifts and breaks the Windows Rust build (no Cargo.lock committed).
- [Canvas LMS proxy hardening](canvas-proxy-hardening.md) — server routes that fetch a client-supplied URL must require https + block internal/private hosts (SSRF + token-in-clear).
- [StudyCore supersedes standalone KB](studycore-vs-rag-attachments.md) — no /knowledge-base route, JSON (not SQLite) RAG store by design; don't "fix" against the old RAG-attachments spec.
