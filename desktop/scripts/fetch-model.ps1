# Downloads the bundled starter model into src-tauri\resources\model.gguf.
# Qwen 2.5 0.5B Instruct, Q4_K_M quantization, ~400 MB.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$ModelUrl = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
$Dest = "src-tauri\resources\model.gguf"

New-Item -ItemType Directory -Force -Path "src-tauri\resources" | Out-Null

if (Test-Path $Dest) {
    Write-Host "[fetch-model] $Dest already exists, skipping."
    exit 0
}

Write-Host "[fetch-model] downloading starter model (~400 MB)..."
$ProgressPreference = "Continue"
Invoke-WebRequest -Uri $ModelUrl -OutFile $Dest
Write-Host "[fetch-model] saved to $Dest"
