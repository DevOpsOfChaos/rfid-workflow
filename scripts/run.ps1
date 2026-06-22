Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv-gui\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Local GUI environment is missing. Run .\scripts\install-windows.ps1 first."
}

Set-Location -LiteralPath $Root
& $Python -m pm3_workflow_gui.web_desktop.app
