#!/usr/bin/env bash
# Downloads the bundled starter model into src-tauri/resources/model.gguf.
# Llama 3.2 1B Instruct, Q4_K_M quantization, ~770 MB.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p src-tauri/resources

MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
DEST="src-tauri/resources/model.gguf"

if [ -f "$DEST" ]; then
  echo "[fetch-model] $DEST already exists, skipping."
  exit 0
fi

echo "[fetch-model] downloading starter model (Llama 3.2 1B Instruct Q4_K_M, ~770 MB)..."
if command -v curl >/dev/null 2>&1; then
  curl -L --fail --progress-bar -o "$DEST" "$MODEL_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$DEST" "$MODEL_URL"
else
  echo "ERROR: need curl or wget on PATH" >&2
  exit 1
fi

echo "[fetch-model] saved to $DEST"
