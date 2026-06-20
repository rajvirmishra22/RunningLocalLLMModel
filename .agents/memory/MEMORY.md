# Memory Index

- [Shared web/desktop Tauri imports](web-desktop-shared-tauri-imports.md) — dynamic `@tauri-apps/api/core` import in a shared (non-overlay) file 500s the web Vite build; fix with a web-only alias→stub.
- [Canvas LMS proxy hardening](canvas-proxy-hardening.md) — server routes that fetch a client-supplied URL must require https + block internal/private hosts (SSRF + token-in-clear).
