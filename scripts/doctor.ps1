Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv-gui\Scripts\python.exe"

function Write-Check($Name, $Ok, $Detail = "") {
    $status = if ($Ok) { "OK" } else { "FAIL" }
    if ($Detail) {
        Write-Host "$Name`: $status - $Detail"
    } else {
        Write-Host "$Name`: $status"
    }
}

Set-Location -LiteralPath $Root

& py -3.12 --version *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Check "Python found" $true "py -3.12"
} else {
    & python --version *> $null
    Write-Check "Python found" ($LASTEXITCODE -eq 0)
}

Write-Check "Virtual environment ready" (Test-Path -LiteralPath $Python) $Python
if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "Run .\scripts\install-windows.ps1 to create the local GUI environment."
    exit 1
}

& $Python -c "import pm3_workflow_gui, webview" *> $null
Write-Check "Dependencies installed" ($LASTEXITCODE -eq 0)

$doctorCode = @"
from pm3_workflow_gui.profiles.settings import load_settings
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService

settings = load_settings()
print("PM3 client saved: " + (settings.last_known_pm3_path or "not configured"))
service = LivePm3ReadonlyService(client_dir=settings.last_known_pm3_path)
status = service.connection_status()
print("PM3 client found: " + ("yes" if service.proxmark_exe.exists() else "no"))
print("PM3 device detected: " + ("yes" if status.connected else "no"))
if not status.connected:
    print("Next step: connect Proxmark3 and verify the local PM3/ProxSpace setup.")
else:
    check = service.startup_check()
    print("Client / firmware status: " + (check.message or "checked"))
    print("Port: " + (check.port or "unknown"))
    print("Device: " + (check.target or "unknown"))
    print("Client: " + (check.client_version or "unknown"))
"@

& $Python -c $doctorCode
exit $LASTEXITCODE
