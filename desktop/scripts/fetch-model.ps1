# Downloads the bundled starter model into src-tauri\resources\model.gguf.
# Llama 3.2 1B Instruct, Q4_K_M quantization, ~770 MB.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$ModelUrl = "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
$Dest = "src-tauri\resources\model.gguf"

New-Item -ItemType Directory -Force -Path "src-tauri\resources" | Out-Null

if (Test-Path $Dest) {
    Write-Host "[fetch-model] $Dest already exists, skipping."
    exit 0
}

Write-Host "[fetch-model] downloading starter model (Llama 3.2 1B Instruct Q4_K_M, ~770 MB)..."
$ProgressPreference = "Continue"
Invoke-WebRequest -Uri $ModelUrl -OutFile $Dest
Write-Host "[fetch-model] saved to $Dest"
