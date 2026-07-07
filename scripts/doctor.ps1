Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$PyProject = Join-Path $Root "pyproject.toml"
$Python = Join-Path $Root ".venv-gui\Scripts\python.exe"

function Write-Check($Name, $Ok, $Detail = "") {
    $status = if ($Ok) { "OK" } else { "FAIL" }
    if ($Detail) {
        Write-Host "$Name`: $status - $Detail"
    } else {
        Write-Host "$Name`: $status"
    }
}

function Read-RequiredPython {
    $content = Get-Content -Raw -LiteralPath $PyProject
    if ($content -match 'requires-python\s*=\s*"([^"]+)"') {
        return $Matches[1]
    }
    return ">=3.12"
}

function Find-PythonLauncher {
    $required = Read-RequiredPython
    $candidates = @("3.14", "3.13", "3.12")
    foreach ($version in $candidates) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            & py "-$version" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" *> $null
        } else {
            $global:LASTEXITCODE = 1
        }
        if ($LASTEXITCODE -eq 0) {
            return "py -$version ($required required)"
        }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        & python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" *> $null
    } else {
        $global:LASTEXITCODE = 1
    }
    if ($LASTEXITCODE -eq 0) {
        return "python ($required required)"
    }
    return $null
}

Set-Location -LiteralPath $Root

$launcher = Find-PythonLauncher
if ($launcher) {
    Write-Check "Python" $true $launcher
} else {
    Write-Check "Python" $false "Python 3.12 or newer was not found"
}

Write-Check "Virtual environment" (Test-Path -LiteralPath $Python) $Python
if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "Run .\Install-RFID-GUI.bat to create the local GUI environment."
    exit 1
}

& $Python -c "import pm3_workflow_gui, webview" *> $null
Write-Check "Dependencies" ($LASTEXITCODE -eq 0) "pm3_workflow_gui, webview"
if ($LASTEXITCODE -ne 0) {
    exit 1
}

& $Python -m pm3_workflow_gui.services.pm3_doctor
exit $LASTEXITCODE
