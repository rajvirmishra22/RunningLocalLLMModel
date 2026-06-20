---
name: llama-cpp-2 / llama-cpp-sys-2 must be version-locked together
description: Why the desktop Tauri build breaks on Windows/CI unless both llama-cpp crates are pinned to the identical exact version
---

In `desktop/src-tauri/Cargo.toml`, pin BOTH `llama-cpp-2` and `llama-cpp-sys-2`
to the **same** exact version (`=0.1.146` for both).

**Why:** `llama-cpp-2 0.1.146` declares its sys dependency as `^0.1.146`, which
lets Cargo greedily resolve the newest in-range `llama-cpp-sys-2` (0.1.147,
0.1.150, …). Newer sys releases regenerate/rename FFI symbols (e.g. the wrapper
calls `llama_memory_breakdown_print` / `llama_params_fit` but newer sys exposes
`llama_rs_*`-prefixed names), so compilation fails with ~21
`error[E0425]: cannot find function ... in crate llama_cpp_sys_2` errors and
`could not compile llama-cpp-2`. The wrapper and sys crates are released as a
matched pair from utilityai/llama-cpp-rs; only the identical version is ABI/symbol
compatible.

**How to apply:** when bumping `llama-cpp-2`, bump `llama-cpp-sys-2` to the exact
same version in lockstep. This repo commits no `Cargo.lock` for the desktop crate
(the `.exe` is built on Windows/CI, not in Replit), so the exact `=` pins in
Cargo.toml are the ONLY thing preventing version drift. Don't rely on a lockfile.
This surfaces only in the native Rust compile (Windows GitHub Actions "Build Tauri
installer" step), never in the Replit workspace typecheck.
