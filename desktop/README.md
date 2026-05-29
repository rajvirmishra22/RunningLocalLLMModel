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
#    CPU-only (works everywhere, but slow for 7B+ models — a few tok/s):
npm run tauri build

#    GPU-accelerated (STRONGLY recommended — 5-20x faster decoding):
#    Vulkan works across NVIDIA / AMD / Intel GPUs.
npm run tauri build -- --features vulkan
#    NVIDIA-only alternative (needs the CUDA toolkit on the build machine):
#    npm run tauri build -- --features cuda
#    macOS:
#    npm run tauri build -- --features metal
```

The installer no longer needs any extra binaries at build time — `cargo tauri build` works against a clean checkout. Local vision support is installed by the end-user from inside the app (see below).

### Why decoding is slow — build with a GPU backend

By default the crate compiles llama.cpp **CPU-only** (`[features] default = []`). On a CPU, a 7B–8B model decodes at only a few tokens/second no matter how many cores you have — it is memory-bandwidth bound. The code already requests `n_gpu_layers = 999`, but that is a no-op unless the binary was compiled with a GPU backend.

To get full-speed inference (often 30-100+ tok/s on a discrete GPU), build with `--features vulkan` (portable) or `--features cuda` (NVIDIA). The build machine needs the matching SDK:

- **Vulkan**: install the [Vulkan SDK](https://vulkan.lunarg.com/) (`VULKAN_SDK` on PATH). Runtime needs only the GPU driver's Vulkan loader, present on any machine with up-to-date GPU drivers.
- **CUDA**: install the NVIDIA CUDA Toolkit. The resulting `.exe` only runs fast on NVIDIA GPUs.

For a CI workflow, add the Vulkan SDK install step before `npm run tauri build -- --features vulkan`.

### Local vision helper (`llama-mtmd-cli`) — installed post-install, not bundled

Vision-capable catalog entries (Moondream 2, LLaVA 1.6, MiniCPM-V 2.6, Qwen2-VL, Gemma 3 4B, Llama 3.2 Vision, etc.) need llama.cpp's `llama-mtmd-cli` to run. The `llama-cpp-2` crate doesn't expose llava/mtmd bindings, and the upstream CLI plus its co-located DLLs would add tens of MB across multiple platforms to a bundle that already weighs ~440 MB for the starter model.

We previously shipped it as a Tauri `externalBin` sidecar, which hard-failed the build whenever the binary wasn't pre-placed in `src-tauri/binaries/<target>/`. That was a footgun for every contributor and every CI run. The current design:

- The installer ships with **no** vision binary.
- The app exposes **Settings → Local Vision Helper**. The user grabs the prebuilt llama.cpp release for their OS from <https://github.com/ggml-org/llama.cpp/releases>, extracts it, pastes the path to `llama-mtmd-cli[.exe]`, and clicks **Install**.
- The Rust side (`install_mtmd_cli`) copies the binary — and, on Windows, any sibling `.dll` files like `ggml.dll`/`llama.dll` — into `<app_local_data>/bin/`. It's runnable from there for all subsequent vision chats.
- Cloud vision models (OpenAI `gpt-4o`, Anthropic `claude-3.5-sonnet`, etc.) do **not** need the helper — only local mmproj-based models do.

Until the helper is installed, any attempt to chat against a `vision: true` local model fails with a friendly "Open Settings → Local Vision and install the llama-mtmd-cli helper" error. Vision model downloads still pull a companion `mmproj` GGUF; that one is auto-downloaded the first time you chat (no manual step). Both live under `<app_local_data>/models/` and `<app_local_data>/mmproj/`.

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
      # GPU acceleration: install the Vulkan SDK so the build can compile the
      # Vulkan backend. Without this the .exe is CPU-only and slow on 7B+ models.
      - uses: humbletim/install-vulkan-sdk@v1.2
        with: { version: latest, cache: true }
      - run: cd desktop && npm install
      - run: cd desktop && pwsh scripts/fetch-model.ps1
      - run: cd desktop && npm run tauri build -- --features vulkan
      - uses: softprops/action-gh-release@v2
        with:
          files: desktop/src-tauri/target/release/bundle/nsis/*.exe
```

Drop this in `.github/workflows/build-windows.yml`. Push a tag like `v0.1.0` and the release `.exe` shows up under GitHub Releases — paste its URL into `InstallCTA.tsx` and you're done.

## Notes / gotchas

- The first `cargo build` is slow (10–20 min) because it compiles llama.cpp from source via the `llama-cpp-2` bindings. Subsequent builds are incremental.
- The bundled model is intentionally tiny (Qwen 2.5 0.5B Q4) so the installer stays under ~500 MB. Larger models (Llama 3.2 3B, Phi 3.5, Mistral 7B) can be downloaded from inside the app post-install if you wire up a model manager — left as a future addition.
- The desktop build does NOT use WebGPU — it uses native CPU/GPU through llama.cpp's backends. WebGPU is only used by the in-browser version at `/app/`.
- **Decoding speed**: a CPU-only build runs 7B+ models at only a few tok/s. Build with `--features vulkan` (or `cuda`/`metal`) for 5-20x faster inference. See "Why decoding is slow" above. The engine also sets `n_threads` to the full logical core count automatically.
- **Idle memory**: once a model is loaded its weights stay resident in RAM (that's the bulk of the footprint — e.g. ~4-5 GB for an 8B Q4 model, ~2 GB for a 3B). This is inherent to local inference. To reclaim it, use **Settings → Unload model**, or pick a smaller / more-quantised model. The KV cache (context) is allocated only during generation and freed afterwards.
- **Context window is adaptive** (`inference.rs`): the window shrinks as the model grows (16K for ≤3B, 8K for 7-8B, 4K for 13B+) so big models don't exhaust RAM and crash the app. Over-long prompts/attachments return a clean error instead of force-quitting.
