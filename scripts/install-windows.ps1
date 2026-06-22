Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PyProject = Join-Path $Root "pyproject.toml"
$Venv = Join-Path $Root ".venv-gui"
$Python = Join-Path $Venv "Scripts\python.exe"

function Read-RequiredPython {
    $content = Get-Content -Raw -LiteralPath $PyProject
    if ($content -match 'requires-python\s*=\s*"([^"]+)"') {
        return $Matches[1]
    }
    return ">=3.12"
}

function Find-PythonLauncher {
    $required = Read-RequiredPython
    Write-Host "Python requirement from pyproject.toml: $required"
    $candidates = @("3.14", "3.13", "3.12")
    foreach ($version in $candidates) {
        & py "-$version" --version *> $null
        if ($LASTEXITCODE -eq 0) {
            return @("py", "-$version")
        }
    }
    & python --version *> $null
    if ($LASTEXITCODE -eq 0) {
        return @("python")
    }
    throw "Python was not found. Install Python 3.12 or newer and rerun this script."
}

Set-Location -LiteralPath $Root
$launcher = Find-PythonLauncher
$launcherExe = $launcher[0]
$launcherArgs = @($launcher | Select-Object -Skip 1)

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "Creating virtual environment: $Venv"
    & $launcherExe @launcherArgs -m venv $Venv
}

Write-Host "Installing project dependencies into local virtual environment ..."
& $Python -m pip install --upgrade pip
& $Python -m pip install -e ".[gui,dev]"

Write-Host "Checking pywebview/WebView import ..."
& $Python -c "import webview; print('pywebview import OK')"

$pm3Path = Read-Host "Optional: enter local PM3/ProxSpace client directory, or press Enter to skip"
if ($pm3Path.Trim()) {
    $resolved = Resolve-Path -LiteralPath $pm3Path -ErrorAction Stop
    $code = @"
import sys
from pathlib import Path
sys.path.insert(0, str(Path(r"$Root") / "src"))
from pm3_workflow_gui.profiles.settings import update_settings
update_settings({"last_known_pm3_path": r"$($resolved.Path)"})
print("Saved PM3 path locally.")
"@
    & $Python -c $code
}

Write-Host "Installation complete. This script did not flash firmware and did not require administrator rights."
Write-Host "Start the app with: .\scripts\run.ps1"
