Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$RunScript = Join-Path $Root "scripts\run.ps1"

if (-not (Test-Path -LiteralPath $RunScript)) {
    throw "Starter script not found: $RunScript"
}

& $RunScript
