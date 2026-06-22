from pathlib import Path

from pm3_workflow_gui.services.live_pm3_readonly import LiveCommandResult, LivePm3ReadonlyService
from pm3_workflow_gui.services.pm3_doctor import build_pm3_doctor_report


def _client_dir(tmp_path: Path) -> Path:
    client = tmp_path / "client"
    client.mkdir()
    (client / "proxmark3.exe").write_text("", encoding="utf-8")
    return client


def test_doctor_reports_pm3_not_installed(tmp_path):
    service = LivePm3ReadonlyService(client_dir=tmp_path / "missing", runner=lambda args, timeout: LiveCommandResult("", 1, "", ""))

    report = build_pm3_doctor_report(service=service)

    assert report.client_available is False
    assert report.device_found is False
    assert report.command_check_passed is False


def test_doctor_reports_client_present_but_no_device(tmp_path):
    client = _client_dir(tmp_path)

    def runner(args, timeout):
        return LiveCommandResult(" ".join(args), 1, "", "No port found")

    report = build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    assert report.client_available is True
    assert report.device_found is False
    assert report.detected_port is None
    assert report.command_check_passed is False


def test_doctor_reports_detected_port_and_successful_command(tmp_path):
    client = _client_dir(tmp_path)
    hw_version = (
        "[+] Using UART port COM16\n"
        " [ Proxmark3 ]\n"
        " [ Client ]\n"
        "  Iceman/master/v4.21611-321-gc7b95a94e-suspect\n"
        " [ Model ]\n"
        "  Firmware.................. PM3 GENERIC\n"
        " [ ARM ]\n"
        "  Bootrom.... Iceman/master/v4.21611-321-gc7b95a94e-suspect\n"
        "  OS......... Iceman/master/v4.21611-321-gc7b95a94e-suspect\n"
    )

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c hw version"):
            return LiveCommandResult(text, 0, hw_version, "")
        return LiveCommandResult(text, 1, "", "unexpected")

    report = build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    assert report.device_found is True
    assert report.detected_port == "COM16"
    assert report.command_check_passed is True
    assert report.client_version.startswith("Iceman/master/v4.21611")
    assert report.target == "PM3 GENERIC"
    assert report.compatibility_state == "verified"


def test_doctor_reports_detected_device_but_command_failure(tmp_path):
    client = _client_dir(tmp_path)

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        local_path = "D:" + r"\Repos\ExampleProject\secret.log"
        return LiveCommandResult(text, 1, "", f"failed at {local_path}")

    report = build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    assert report.device_found is True
    assert report.command_check_passed is False
    assert report.command_check_reason == "failed at <local-path>"


def test_doctor_reports_version_recognized_but_untested(tmp_path):
    client = _client_dir(tmp_path)
    hw_version = " [ Client ]\n  Iceman/master/v4.10000\n [ Model ]\n  Firmware.................. PM3 GENERIC\n"

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        return LiveCommandResult(text, 0, hw_version, "")

    report = build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    assert report.command_check_passed is True
    assert report.compatibility_state == "recognized_untested"


def test_doctor_reports_client_firmware_mismatch(tmp_path):
    client = _client_dir(tmp_path)
    hw_version = (
        " [ Client ]\n"
        "  Iceman/master/v4.21611-321-gc7b95a94e\n"
        " [ Model ]\n"
        "  Firmware.................. PM3 GENERIC\n"
        " [ ARM ]\n"
        "  OS......... firmware does not match client\n"
    )

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        return LiveCommandResult(text, 0, hw_version, "")

    report = build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    assert report.command_check_passed is True
    assert report.compatibility_state == "client_firmware_mismatch"


def test_doctor_path_uses_no_write_or_flash_commands(tmp_path):
    client = _client_dir(tmp_path)
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        return LiveCommandResult(text, 0, " [ Client ]\n  test\n [ Model ]\n  Firmware.................. PM3 GENERIC\n", "")

    build_pm3_doctor_report(service=LivePm3ReadonlyService(client_dir=client, runner=runner))

    combined = " ".join(calls).lower()
    assert "wrbl" not in combined
    assert "flash" not in combined
    assert "clone" not in combined
    assert any("--list" in call for call in calls)
    assert any("-c hw version" in call for call in calls)
