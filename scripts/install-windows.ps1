param(
    [switch]$CreateShortcut,
    [switch]$Dev,
    [string]$Pm3ClientDir
)

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

function Test-PythonLauncher([string]$Exe, [string[]]$Args) {
    if (-not (Get-Command $Exe -ErrorAction SilentlyContinue)) {
        return $false
    }
    & $Exe @Args -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" *> $null
    return $LASTEXITCODE -eq 0
}

function Find-PythonLauncher {
    $required = Read-RequiredPython
    Write-Host "Python requirement from pyproject.toml: $required"
    $candidates = @("3.14", "3.13", "3.12")
    foreach ($version in $candidates) {
        if (Test-PythonLauncher "py" @("-$version")) {
            return ,@("py", "-$version")
        }
    }
    if (Test-PythonLauncher "python" @()) {
        return ,@("python")
    }
    Start-Process "https://www.python.org/downloads/windows/"
    throw "Python 3.12 or newer was not found. Install Python from the opened page, enable 'Add python.exe to PATH', then rerun Install-RFID-GUI.bat."
}

function Save-Pm3ClientDir([string]$ClientDir) {
    $resolved = Resolve-Path -LiteralPath $ClientDir -ErrorAction Stop
    $env:RFID_GUI_ROOT = $Root
    $env:RFID_GUI_PM3_CLIENT_DIR = $resolved.Path
    try {
        & $Python -c "import os, sys; from pathlib import Path; sys.path.insert(0, str(Path(os.environ['RFID_GUI_ROOT']) / 'src')); from pm3_workflow_gui.profiles.settings import update_settings; update_settings({'last_known_pm3_path': os.environ['RFID_GUI_PM3_CLIENT_DIR']}); print('Saved PM3 path locally.')"
    } finally {
        Remove-Item Env:\RFID_GUI_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:\RFID_GUI_PM3_CLIENT_DIR -ErrorAction SilentlyContinue
    }
}

function New-DesktopShortcut {
    $target = Join-Path $Root "Start-RFID-GUI.bat"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "RFID GUI starten.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = "RFID Workflow GUI starten"
    $shortcut.Save()
    Write-Host "Desktop shortcut created: $shortcutPath"
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
if ($Dev) {
    & $Python -m pip install -e ".[gui,dev]"
} else {
    & $Python -m pip install -e ".[gui]"
}

Write-Host "Checking pywebview/WebView import ..."
& $Python -c "import webview; print('pywebview import OK')"

if (-not $Pm3ClientDir) {
    $defaultPm3ClientDir = "C:\Tools\proxmark3\client"
    if (Test-Path -LiteralPath $defaultPm3ClientDir) {
        $Pm3ClientDir = $defaultPm3ClientDir
    }
}
if ($Pm3ClientDir) {
    Save-Pm3ClientDir $Pm3ClientDir
} else {
    Write-Host "PM3 client path not configured. You can set it later in the app."
}

if ($CreateShortcut) {
    New-DesktopShortcut
}

Write-Host "Installation complete. This script did not flash firmware and did not require administrator rights."
Write-Host "Start the app with: .\Start-RFID-GUI.bat"
