Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Installer = Join-Path $Root "scripts\install-windows.ps1"

if (-not (Test-Path -LiteralPath $Installer)) {
    throw "Installer script not found: $Installer"
}

& $Installer -CreateShortcut

