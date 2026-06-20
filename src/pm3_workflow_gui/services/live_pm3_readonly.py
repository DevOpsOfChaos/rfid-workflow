from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
import time
from typing import Callable

from pm3_workflow_gui.pm3.parsers import parse_hf_search, parse_hw_tune, parse_hw_version, parse_lf_search
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
COMMAND_EXECUTION_FAILED = "Proxmark port was found, but PM3 command execution failed."


@dataclass(frozen=True)
class LiveCommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    elapsed_seconds: float = 0.0
    launch_variant: str = "pm3-wrapper"


@dataclass(frozen=True)
class Pm3ConnectionStatus:
    connected: bool
    ports: tuple[str, ...] = ()
    last_error: str | None = None
    stdout: str = ""
    stderr: str = ""


Runner = Callable[[list[str], int], LiveCommandResult]


@dataclass(frozen=True)
class LiveCaptureResult(CaptureResult):
    debug_results: tuple[LiveCommandResult, ...] = ()
    connection_status: Pm3ConnectionStatus | None = None


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
        self.proxmark_exe = self.client_dir / "proxmark3.exe"
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

        port = status.ports[0]
        results = [self.run_safe_command(command, port=port) for command in SAFE_LIVE_COMMANDS]
        valid_outputs = _valid_command_outputs(results)
        errors = _result_errors(results)
        failed_commands = _failed_commands(results)
        if not _hw_version_is_meaningful(valid_outputs.get("hw version")):
            errors.append(COMMAND_EXECUTION_FAILED)
            failed_commands.append("hw version")
        inputs = DiscoveryTextInputs(
            startup_banner=_startup_banner_from_results(results),
            hw_version=valid_outputs.get("hw version"),
            hw_tune=valid_outputs.get("hw tune"),
            hf_search=valid_outputs.get("hf search"),
            lf_search=valid_outputs.get("lf search"),
            session_errors=tuple(_dedupe(errors)),
            failed_commands=tuple(_dedupe(failed_commands)),
        )
        return LiveCaptureResult(
            source="live-pm3:auto-port",
            inputs=inputs,
            command_outputs=_command_outputs(results),
            missing_fields=_missing_fields(inputs),
            debug_results=tuple(results),
            connection_status=status,
        )

    def run_safe_command(self, command: str, port: str | None = None) -> LiveCommandResult:
        normalized = normalize_pm3_command(command)
        if normalized not in SAFE_LIVE_COMMANDS:
            raise ValueError(f"Refusing live PM3 command outside read-only allowlist: {command}")
        if port:
            result = self.runner(self._proxmark_args(port, normalized), self.timeout_seconds)
            return LiveCommandResult(
                normalized,
                result.returncode,
                result.stdout,
                result.stderr,
                result.timed_out,
                result.elapsed_seconds,
                "proxmark3.exe detected-port -c",
            )
        result = self.runner(self._pm3_args("-c", normalized), self.timeout_seconds)
        return LiveCommandResult(
            normalized,
            result.returncode,
            result.stdout,
            result.stderr,
            result.timed_out,
            result.elapsed_seconds,
            "pm3-wrapper -c",
        )

    def _pm3_args(self, *pm3_args: str) -> list[str]:
        quoted_args = " ".join(_cmd_quote(arg) for arg in pm3_args)
        command = f"cd /d {self.client_dir} && call setup.bat && bash pm3 {quoted_args}".strip()
        return ["cmd.exe", "/c", command]

    def _proxmark_args(self, port: str, command: str) -> list[str]:
        return [str(self.proxmark_exe), port, "-c", command]

    def _run_subprocess(self, args: list[str], timeout_seconds: int) -> LiveCommandResult:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                args,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                cwd=self.client_dir,
                env=self._proxmark_env(),
            )
        except subprocess.TimeoutExpired as exc:
            elapsed = time.monotonic() - started
            return LiveCommandResult(
                " ".join(args),
                124,
                exc.stdout or "",
                exc.stderr or "",
                timed_out=True,
                elapsed_seconds=elapsed,
            )
        elapsed = time.monotonic() - started
        return LiveCommandResult(" ".join(args), completed.returncode, completed.stdout, completed.stderr, elapsed_seconds=elapsed)

    def _proxmark_env(self) -> dict[str, str]:
        env = os.environ.copy()
        home = str(self.client_dir) + "\\"
        qt_plugin_path = home + "libs\\"
        env["HOME"] = home
        env["QT_PLUGIN_PATH"] = qt_plugin_path
        env["QT_QPA_PLATFORM_PLUGIN_PATH"] = qt_plugin_path
        env["PATH"] = qt_plugin_path + ";" + qt_plugin_path + "shell\\;" + env.get("PATH", "")
        env["MSYSTEM"] = "MINGW64"
        return env


def _device_lost_capture(status: Pm3ConnectionStatus) -> CaptureResult:
    inputs = DiscoveryTextInputs(
        session_errors=("Communicating with Proxmark3 device failed",),
        failed_commands=("pm3 --list",),
        cmd_prompt_detected=True,
    )
    return LiveCaptureResult(
        source="live-pm3:auto-port",
        inputs=inputs,
        missing_fields=_missing_fields(inputs),
        connection_status=status,
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


def _valid_command_outputs(results: list[LiveCommandResult]) -> dict[str, str]:
    valid: dict[str, str] = {}
    for result in results:
        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        if not output or result.timed_out:
            continue
        if result.command == "hw version" and _hw_version_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "hw tune" and _hw_tune_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "hf search" and _hf_search_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "lf search" and _lf_search_is_meaningful(output):
            valid[result.command] = output
    return valid


def _hw_version_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hw_version(output)
    return bool(parsed.client_version or parsed.firmware)


def _hw_tune_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hw_tune(output)
    return bool(parsed.lf_antenna_status or parsed.hf_antenna_status or parsed.hf_13_56mhz_voltage)


def _hf_search_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hf_search(output)
    return parsed.status != "unknown"


def _lf_search_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_lf_search(output)
    return parsed.identification_status != "unknown" or bool(parsed.uid or parsed.tag_type or parsed.chipset or parsed.hint)


def _looks_like_command_catalog(output: str) -> bool:
    normalized = output.lower()
    return (
        "use `<command> help` for details of a command" in normalized
        and "technology -----------------------" in normalized
    )


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
        if result.returncode != 0 and not _result_has_meaningful_output(result):
            errors.append(COMMAND_EXECUTION_FAILED)
        for text in (result.stdout, result.stderr):
            for marker in markers:
                if marker.lower() in text.lower():
                    errors.append(marker)
    return _dedupe(errors)


def _failed_commands(results: list[LiveCommandResult]) -> list[str]:
    failed: list[str] = []
    for result in results:
        if result.timed_out or (result.returncode != 0 and not _result_has_meaningful_output(result)):
            failed.append(normalize_pm3_command(result.command))
            continue
        if any(error.lower() in (result.stdout + result.stderr).lower() for error in _result_errors([result])):
            failed.append(normalize_pm3_command(result.command))
    return _dedupe(failed)


def _result_has_meaningful_output(result: LiveCommandResult) -> bool:
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.command == "hw version":
        return _hw_version_is_meaningful(output)
    if result.command == "hw tune":
        return _hw_tune_is_meaningful(output)
    if result.command == "hf search":
        return _hf_search_is_meaningful(output)
    if result.command == "lf search":
        return _lf_search_is_meaningful(output)
    return False


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
