param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$DenylistPath,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv-gui\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Local GUI environment is missing. Run .\scripts\install-windows.ps1 first."
}

Set-Location -LiteralPath $Root
& $Python -m tools.public_export `
    --repo-root $Root `
    --output-path $OutputPath `
    --denylist-path $DenylistPath `
    --manifest-path $ManifestPath

exit $LASTEXITCODE
