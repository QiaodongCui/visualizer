# Builds dist\ModelViewer\ModelViewer.exe. Run install.ps1 afterwards to install it.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) {
    python -m venv .venv
    .venv\Scripts\python -m pip install pywebview pyinstaller pillow
}
.venv\Scripts\pyinstaller --noconfirm --clean --windowed --name ModelViewer --icon icon.ico --add-data "web;web" model_viewer.py
