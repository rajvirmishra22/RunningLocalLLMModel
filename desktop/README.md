# LocalModel Studio — Desktop (Tauri + llama.cpp)

A native desktop build of LocalModel Studio. Same product, different engine:

- **Inference**: native `llama.cpp` via the `llama-cpp-2` Rust bindings — uses your full CPU/GPU directly, no browser sandbox.
- **Shell**: [Tauri 2](https://v2.tauri.app/) — produces a small (~5–15 MB) installer wrapping a React UI.
- **Model**: one small starter model (`Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`, ~400 MB) is bundled inside the installer so the app works immediately after install — no extra downloads, no Ollama, no servers.
- **Total installer size**: ~440 MB on Windows.

This folder is **outside** the pnpm workspace on purpose — it has its own npm-managed `package.json` and a Rust toolchain. Replit does not build the `.exe`; you do, on a Windows machine or in GitHub Actions.

---

## One-time setup (on the build machine)

You need:

1. **Node.js 20+** and **npm**
2. **Rust** (`rustup` → stable toolchain, includes `cargo`)
3. **Tauri prerequisites** — follow https://v2.tauri.app/start/prerequisites/ for your OS.
4. On Windows specifically:
   - Microsoft C++ Build Tools (MSVC) with the "Desktop development with C++" workload
   - WebView2 runtime (preinstalled on Windows 11)

## Build the `.exe`

```bash
cd desktop

# 1. Install JS deps
npm install

# 2. (First build only) Generate the full Windows icon set from the bundled PNG.
#    This produces icon.ico + all required sizes under src-tauri/icons/.
npx @tauri-apps/cli icon src-tauri/icons/icon.png

# 3. Download the bundled starter model (~400 MB, one time)
bash scripts/fetch-model.sh        # macOS/Linux
# OR
pwsh scripts/fetch-model.ps1       # Windows PowerShell

# 4. Build the production installer
npm run tauri build
```

The signed installer lands at:

```
desktop/src-tauri/target/release/bundle/msi/LocalModel Studio_<version>_x64_en-US.msi
desktop/src-tauri/target/release/bundle/nsis/LocalModel Studio_<version>_x64-setup.exe
```

Upload the `.exe` (or `.msi`) somewhere and paste its URL into `WINDOWS_INSTALLER_URL` in `artifacts/landing/src/components/landing/InstallCTA.tsx`.

## Dev loop

```bash
npm run tauri dev
```

This launches the React UI inside a native window with hot-reload. Inference still runs against the local llama.cpp binding — make sure `src-tauri/resources/model.gguf` exists (run `fetch-model.sh` first).

## Where things live

- `src/` — React UI (chat window, model picker, settings). Intentionally minimal — the heavy logic lives in Rust.
- `src/api.ts` — Typed wrappers around Tauri `invoke` commands.
- `src-tauri/src/main.rs` — Tauri entry point, command registration.
- `src-tauri/src/inference.rs` — llama.cpp wrapper: load model, run prompt, stream tokens to the frontend.
- `src-tauri/tauri.conf.json` — bundler config (icons, identifiers, installer settings, bundled resources).
- `src-tauri/Cargo.toml` — Rust deps (`tauri`, `llama-cpp-2`, `tokio`).
- `src-tauri/resources/model.gguf` — the bundled starter model (not committed; fetched by the script above).
- `scripts/fetch-model.{sh,ps1}` — downloads the starter GGUF from Hugging Face.

## Optional: GitHub Actions CI

A minimal workflow that produces a signed Windows build on every tag:

```yaml
name: Build Windows
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - run: cd desktop && npm install
      - run: cd desktop && pwsh scripts/fetch-model.ps1
      - run: cd desktop && npm run tauri build
      - uses: softprops/action-gh-release@v2
        with:
          files: desktop/src-tauri/target/release/bundle/nsis/*.exe
```

Drop this in `.github/workflows/build-windows.yml`. Push a tag like `v0.1.0` and the release `.exe` shows up under GitHub Releases — paste its URL into `InstallCTA.tsx` and you're done.

## Notes / gotchas

- The first `cargo build` is slow (10–20 min) because it compiles llama.cpp from source via the `llama-cpp-2` bindings. Subsequent builds are incremental.
- The bundled model is intentionally tiny (Qwen 2.5 0.5B Q4) so the installer stays under ~500 MB. Larger models (Llama 3.2 3B, Phi 3.5, Mistral 7B) can be downloaded from inside the app post-install if you wire up a model manager — left as a future addition.
- The desktop build does NOT use WebGPU — it uses native CPU/GPU through llama.cpp's backends. WebGPU is only used by the in-browser version at `/app/`.
