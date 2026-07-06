from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import sys

from pm3_workflow_gui.pm3.compatibility import classify_pm3_compatibility
from pm3_workflow_gui.pm3.parsers import parse_hw_version
from pm3_workflow_gui.profiles.settings import load_settings
from pm3_workflow_gui.services.discovery_facade import default_launch_config
from pm3_workflow_gui.services.live_pm3_readonly import (
    LivePm3ReadonlyService,
    _command_failure_reason as _live_command_failure_reason,
    _combined_output,
    _hw_version_is_meaningful,
)


@dataclass(frozen=True)
class Pm3DoctorReport:
    configured_pm3_path: str
    client_available: bool
    device_found: bool
    detected_port: str | None
    command_check_passed: bool
    command_check_reason: str | None
    client_version: str | None
    target: str | None
    compatibility_state: str

    def lines(self) -> list[str]:
        return [
            f"Configured PM3 path: {self.configured_pm3_path}",
            f"PM3 client availability: {_state(self.client_available)}",
            f"PM3 device discovery: {_state(self.device_found)}",
            f"Detected port: {self.detected_port or 'not detected'}",
            f"PM3 command execution: {'passed' if self.command_check_passed else 'failed' if self.device_found else 'skipped'}",
            f"Client version: {self.client_version or 'unknown'}",
            f"Firmware / device target where available: {self.target or 'unknown'}",
            f"Compatibility state: {self.compatibility_state}",
            *([f"Reason: {self.command_check_reason}"] if self.command_check_reason else []),
        ]


def build_pm3_doctor_report(client_dir: str | Path | None = None, service: LivePm3ReadonlyService | None = None) -> Pm3DoctorReport:
    configured = Path(client_dir) if client_dir else _configured_client_dir()
    live_service = service or LivePm3ReadonlyService(client_dir=configured)
    configured_display = str(live_service.client_dir)
    client_available = live_service.proxmark_exe.exists()
    if not client_available:
        return Pm3DoctorReport(
            configured_display,
            False,
            False,
            None,
            False,
            "proxmark3.exe was not found in the configured PM3 client directory",
            None,
            None,
            "unknown",
        )

    status = live_service.connection_status()
    if not status.connected:
        return Pm3DoctorReport(
            configured_display,
            True,
            False,
            None,
            False,
            _sanitize_reason(status.last_error or "No Proxmark3 port found"),
            None,
            None,
            "unknown",
        )

    port = status.ports[0]
    hw_version = live_service.run_safe_command("hw version", port=port)
    output = _combined_output(hw_version)
    if hw_version.timed_out or not _hw_version_is_meaningful(output):
        return Pm3DoctorReport(
            configured_display,
            True,
            True,
            port,
            False,
            _sanitize_reason(_live_command_failure_reason(hw_version)),
            None,
            None,
            "unknown",
        )

    parsed = parse_hw_version(output)
    compatibility = classify_pm3_compatibility(parsed, output, parsed.firmware)
    return Pm3DoctorReport(
        configured_display,
        True,
        True,
        port,
        True,
        None,
        parsed.client_version,
        parsed.firmware or "PM3 Generic",
        compatibility.status,
    )


def main() -> int:
    report = build_pm3_doctor_report()
    for line in report.lines():
        print(line)
    return 0 if report.command_check_passed else 1


def _configured_client_dir() -> Path:
    settings = load_settings()
    if settings.last_known_pm3_path:
        return Path(settings.last_known_pm3_path)
    return default_launch_config().client_dir


def _sanitize_reason(value: str | None) -> str:
    if not value:
        return "unknown"
    sanitized = re.sub(r"(?i)\b[A-Z]:\\[^\s]+", "<local-path>", value)
    sanitized = re.sub(r"(?i)/(?:Users|home)/[^\s]+", "<local-path>", sanitized)
    return sanitized.strip()


def _state(value: bool) -> str:
    return "ok" if value else "failed"


if __name__ == "__main__":
    raise SystemExit(main())
