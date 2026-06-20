from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Callable

from pm3_workflow_gui.services.capture import (
    CapturedCommandOutput,
    CaptureResult,
    _missing_fields,
    classify_pm3_command_context,
    normalize_pm3_command,
)
from pm3_workflow_gui.services.discovery_facade import DiscoveryTextInputs, default_launch_config


SAFE_LIVE_COMMANDS = ("hw version", "hw tune", "hf search", "lf search")
DEVICE_NOT_FOUND_ERROR = "No Proxmark3 port found"
DEVICE_RECONNECT_MESSAGE = "USB reconnect required. Reconnect the Proxmark and restart the session."


@dataclass(frozen=True)
class LiveCommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


@dataclass(frozen=True)
class Pm3ConnectionStatus:
    connected: bool
    ports: tuple[str, ...] = ()
    last_error: str | None = None
    stdout: str = ""
    stderr: str = ""


Runner = Callable[[list[str], int], LiveCommandResult]


class LivePm3ReadonlyService:
    """Read-only live PM3 transport using the local pm3 wrapper auto-port logic."""

    def __init__(
        self,
        client_dir: str | Path | None = None,
        runner: Runner | None = None,
        timeout_seconds: int = 45,
        probe_timeout_seconds: int = 6,
    ) -> None:
        config = default_launch_config()
        self.client_dir = Path(client_dir) if client_dir else config.client_dir
        self.runner = runner or self._run_subprocess
        self.timeout_seconds = timeout_seconds
        self.probe_timeout_seconds = probe_timeout_seconds

    def connection_status(self) -> Pm3ConnectionStatus:
        result = self.runner(self._pm3_args("--list"), self.probe_timeout_seconds)
        ports = tuple(_parse_pm3_list_ports(result.stdout))
        if ports:
            return Pm3ConnectionStatus(True, ports, stdout=result.stdout, stderr=result.stderr)
        error = "timeout while waiting for Proxmark3 port list" if result.timed_out else _first_error(result) or DEVICE_NOT_FOUND_ERROR
        return Pm3ConnectionStatus(False, (), error, result.stdout, result.stderr)

    def capture(self) -> CaptureResult:
        status = self.connection_status()
        if not status.connected:
            return _device_lost_capture(status)

        results = [self.run_safe_command(command) for command in SAFE_LIVE_COMMANDS]
        command_outputs = _command_outputs(results)
        inputs = DiscoveryTextInputs(
            startup_banner=_startup_banner_from_results(results),
            hw_version=command_outputs.get("hw version", (None,))[-1].output if command_outputs.get("hw version") else None,
            hw_tune=command_outputs.get("hw tune", (None,))[-1].output if command_outputs.get("hw tune") else None,
            hf_search=command_outputs.get("hf search", (None,))[-1].output if command_outputs.get("hf search") else None,
            lf_search=command_outputs.get("lf search", (None,))[-1].output if command_outputs.get("lf search") else None,
            session_errors=tuple(_result_errors(results)),
            failed_commands=tuple(_failed_commands(results)),
        )
        return CaptureResult(
            source="live-pm3:auto-port",
            inputs=inputs,
            command_outputs=command_outputs,
            missing_fields=_missing_fields(inputs),
        )

    def run_safe_command(self, command: str) -> LiveCommandResult:
        normalized = normalize_pm3_command(command)
        if normalized not in SAFE_LIVE_COMMANDS:
            raise ValueError(f"Refusing live PM3 command outside read-only allowlist: {command}")
        result = self.runner(self._pm3_args("-c", normalized), self.timeout_seconds)
        return LiveCommandResult(normalized, result.returncode, result.stdout, result.stderr, result.timed_out)

    def _pm3_args(self, *pm3_args: str) -> list[str]:
        quoted_args = " ".join(_cmd_quote(arg) for arg in pm3_args)
        command = f"cd /d {self.client_dir} && call setup.bat && bash pm3 {quoted_args}".strip()
        return ["cmd.exe", "/c", command]

    @staticmethod
    def _run_subprocess(args: list[str], timeout_seconds: int) -> LiveCommandResult:
        try:
            completed = subprocess.run(
                args,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            return LiveCommandResult(" ".join(args), 124, exc.stdout or "", exc.stderr or "", timed_out=True)
        return LiveCommandResult(" ".join(args), completed.returncode, completed.stdout, completed.stderr)


def _device_lost_capture(status: Pm3ConnectionStatus) -> CaptureResult:
    inputs = DiscoveryTextInputs(
        session_errors=("Communicating with Proxmark3 device failed",),
        failed_commands=("pm3 --list",),
        cmd_prompt_detected=True,
    )
    return CaptureResult(
        source="live-pm3:auto-port",
        inputs=inputs,
        missing_fields=_missing_fields(inputs),
    )


def _command_outputs(results: list[LiveCommandResult]) -> dict[str, tuple[CapturedCommandOutput, ...]]:
    outputs: dict[str, tuple[CapturedCommandOutput, ...]] = {}
    for result in results:
        normalized = normalize_pm3_command(result.command)
        text = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        outputs[normalized] = (
            CapturedCommandOutput(
                command=result.command,
                normalized_command=normalized,
                command_context=classify_pm3_command_context(normalized),
                output=text,
            ),
        )
    return outputs


def _startup_banner_from_results(results: list[LiveCommandResult]) -> str | None:
    for result in results:
        text = "\n".join(part for part in (result.stdout, result.stderr) if part)
        if "Using UART port" in text or "[ Proxmark3 ]" in text:
            return text.strip()
    return None


def _parse_pm3_list_ports(output: str) -> list[str]:
    ports: list[str] = []
    for line in output.splitlines():
        stripped = line.strip()
        if ": " not in stripped:
            continue
        _, value = stripped.split(": ", 1)
        if value:
            ports.append(value.strip())
    return ports


def _first_error(result: LiveCommandResult) -> str | None:
    for text in (result.stderr, result.stdout):
        for line in text.splitlines():
            stripped = line.strip()
            if stripped:
                return stripped
    return None


def _result_errors(results: list[LiveCommandResult]) -> list[str]:
    errors: list[str] = []
    markers = (
        "UID Request failed!",
        "Couldn't identify a chipset",
        "timeout while waiting for reply",
        "Failed to get current device debug level",
        "Communicating with Proxmark3 device failed",
    )
    for result in results:
        if result.timed_out:
            errors.append("timeout while waiting for reply")
        for text in (result.stdout, result.stderr):
            for marker in markers:
                if marker.lower() in text.lower():
                    errors.append(marker)
    return _dedupe(errors)


def _failed_commands(results: list[LiveCommandResult]) -> list[str]:
    failed: list[str] = []
    for result in results:
        if result.returncode != 0 or result.timed_out:
            failed.append(normalize_pm3_command(result.command))
            continue
        if any(error.lower() in (result.stdout + result.stderr).lower() for error in _result_errors([result])):
            failed.append(normalize_pm3_command(result.command))
    return _dedupe(failed)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _cmd_quote(value: str) -> str:
    if not value or any(char.isspace() for char in value):
        return '"' + value.replace('"', r'\"') + '"'
    return value
