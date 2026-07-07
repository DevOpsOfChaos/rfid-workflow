from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_windows_installer_bootstraps_missing_python() -> None:
    script = (ROOT / "scripts" / "install-windows.ps1").read_text(encoding="utf-8")

    assert "Install-PythonRuntime" in script
    assert "winget install --id Python.Python.3.12" in script
    assert "Invoke-WebRequest -UseBasicParsing -Uri $url" in script
    assert 'Start-Process "https://www.python.org/downloads/windows/"' not in script


def test_doctor_checks_python_locations_used_by_installer() -> None:
    script = (ROOT / "scripts" / "doctor.ps1").read_text(encoding="utf-8")

    assert "Get-Command python3" in script
    assert "Python$version\\python.exe" in script
