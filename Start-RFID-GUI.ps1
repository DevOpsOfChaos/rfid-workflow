Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$RunScript = Join-Path $Root "scripts\run.ps1"
$Python = Join-Path $Root ".venv-gui\Scripts\python.exe"
$Installer = Join-Path $Root "scripts\install-windows.ps1"

if (-not (Test-Path -LiteralPath $RunScript)) {
    throw "Starter script not found: $RunScript"
}

if (-not (Test-Path -LiteralPath $Python)) {
    if (-not (Test-Path -LiteralPath $Installer)) {
        throw "Local GUI environment is missing and installer script was not found: $Installer"
    }
    Write-Host "First start: installing local GUI environment ..."
    & $Installer -CreateShortcut
}

& $RunScript
