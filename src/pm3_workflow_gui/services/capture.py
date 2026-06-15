from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field, replace
from pathlib import Path
import re
from typing import Protocol

from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
    DiscoveryTextInputs,
    UiDiscoverySummary,
    default_launch_config,
    load_default_fixture_dir,
    load_scenario,
)

PROMPT_RE = re.compile(r"^\[[^\]]+\]\s*pm3\s*-->\s*(?P<command>.+?)\s*$", re.IGNORECASE)
WINDOWS_CMD_PROMPT_RE = re.compile(r"^[A-Za-z]:\\.*>\s*$")
ERROR_MARKERS = (
    "UID Request failed!",
    "Couldn't identify a chipset",
    "timeout while waiting for reply",
    "Failed to get current device debug level",
    "Communicating with Proxmark3 device failed",
)

@dataclass(frozen=True)
class CapturedCommandOutput:
    command: str
    normalized_command: str
    command_context: str
    output: str


@dataclass(frozen=True)
class CaptureResult:
    source: str
    inputs: DiscoveryTextInputs
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]] = field(default_factory=dict)
    ignored_host_commands: tuple[str, ...] = ()
    missing_fields: tuple[str, ...] = ()

    def summarize(self, facade: DiscoveryFacade | None = None) -> UiDiscoverySummary:
        return (facade or DiscoveryFacade(default_launch_config())).summarize_texts(self.inputs)


class CaptureProvider(Protocol):
    def capture(self) -> CaptureResult:
        ...


@dataclass(frozen=True)
class FixtureCaptureProvider:
    fixture_dir: Path | None = None
    scenario_path: Path | None = None

    def capture(self) -> CaptureResult:
        if self.scenario_path:
            scenario = load_scenario(self.scenario_path)
            return CaptureResult(
                source=f"scenario:{self.scenario_path}",
                inputs=scenario.inputs,
                missing_fields=_missing_fields(scenario.inputs),
            )
        if not self.fixture_dir:
            raise ValueError("FixtureCaptureProvider requires fixture_dir or scenario_path")
        inputs = load_default_fixture_dir(self.fixture_dir)
        return CaptureResult(
            source=f"fixture-dir:{self.fixture_dir}",
            inputs=inputs,
            missing_fields=_missing_fields(inputs),
        )


@dataclass(frozen=True)
class ManualTextCaptureProvider:
    text_blocks: dict[str, str | None]

    def capture(self) -> CaptureResult:
        inputs = DiscoveryTextInputs(
            startup_banner=self.text_blocks.get("startup_banner"),
            hw_version=self.text_blocks.get("hw_version"),
            hw_tune=self.text_blocks.get("hw_tune"),
            hf_search=self.text_blocks.get("hf_search"),
            lf_search=self.text_blocks.get("lf_search"),
            hitag_reader=self.text_blocks.get("hitag_reader"),
            hitag_rdbl=self.text_blocks.get("hitag_rdbl"),
            reference_hitag_rdbl=self.text_blocks.get("reference_hitag_rdbl"),
        )
        return CaptureResult(source="manual-text", inputs=inputs, missing_fields=_missing_fields(inputs))


@dataclass(frozen=True)
class Pm3LogCaptureProvider:
    log_path: Path

    def capture(self) -> CaptureResult:
        text = self.log_path.read_text(encoding="utf-8", errors="replace")
        all_command_outputs = split_pm3_log_commands(text)
        ignored_host_commands = ignored_host_commands_from_outputs(all_command_outputs)
        command_outputs = pm3_relevant_command_outputs(all_command_outputs)
        inputs = discovery_inputs_from_log(text, command_outputs)
        inputs = replace(
            inputs,
            ignored_host_commands=ignored_host_commands,
            log_pollution_detected=bool(ignored_host_commands),
        )
        return CaptureResult(
            source=f"log:{self.log_path}",
            inputs=inputs,
            command_outputs=command_outputs,
            ignored_host_commands=ignored_host_commands,
            missing_fields=_missing_fields(inputs),
        )


class InteractivePm3Provider:
    """Placeholder for future interactive Proxmark capture.

    Windows + MSYS + bash + Proxmark interactive TTY behavior needs dedicated
    testing. This provider intentionally does not start hardware sessions.
    """

    def capture(self) -> CaptureResult:
        raise NotImplementedError("Interactive PM3 automation is intentionally not implemented yet.")


def latest_log_file(log_dir: str | Path) -> Path:
    candidates = [path for path in Path(log_dir).glob("*.txt") if path.is_file()]
    if not candidates:
        raise FileNotFoundError(f"No PM3 log files found in: {log_dir}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def split_pm3_log_commands(log_text: str) -> dict[str, tuple[CapturedCommandOutput, ...]]:
    grouped: defaultdict[str, list[CapturedCommandOutput]] = defaultdict(list)
    current_command: str | None = None
    current_normalized: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        if current_command is None or current_normalized is None:
            return
        output = "\n".join(current_lines).strip()
        grouped[current_normalized].append(
            CapturedCommandOutput(
                command=current_command,
                normalized_command=current_normalized,
                command_context=classify_pm3_command_context(current_normalized),
                output=output,
            )
        )

    for raw_line in log_text.splitlines():
        match = PROMPT_RE.match(raw_line.strip())
        if match:
            flush()
            current_command = match.group("command").strip()
            current_normalized = normalize_pm3_command(current_command)
            current_lines = []
            continue
        if current_command is not None:
            current_lines.append(raw_line)
    flush()
    return {command: tuple(outputs) for command, outputs in grouped.items()}


def normalize_pm3_command(command: str) -> str:
    return re.sub(r"\s+", " ", command.strip().lower())


def classify_pm3_command_context(command: str) -> str:
    normalized = normalize_pm3_command(command)
    if is_host_shell_command(normalized):
        return "host_shell"
    if normalized in {"hw version", "hw tune"}:
        return "hardware_status"
    if normalized in {
        "hf search -h",
        "hf search --help",
        "lf search -h",
        "lf search --help",
        "lf hitag hts",
        "lf hitag hts -h",
        "lf hitag hts --help",
        "lf hitag hts rdbl -h",
        "lf hitag hts rdbl --help",
        "lf hitag hts wrbl -h",
        "lf hitag hts wrbl --help",
        "lf hitag hts dump -h",
        "lf hitag hts dump --help",
    }:
        return "help_capability"
    if normalized in {"hf search", "lf search", "lf search -u"}:
        return "discovery"
    if normalized.startswith("lf hitag hts reader"):
        return "reader"
    if normalized.startswith("lf hitag hts rdbl") and not _has_help_flag(normalized):
        return "read"
    return "other"


def is_host_shell_command(command: str) -> bool:
    normalized = normalize_pm3_command(command)
    if re.match(r"^[a-z]:\\", normalized):
        return True
    first = normalized.split(" ", 1)[0]
    return first in {"cd", "dir", "ls", "python", "py", "powershell", "cmd"}


def _has_help_flag(command: str) -> bool:
    return bool(re.search(r"(^|\s)(-h|--help)(\s|$)", command))


def latest_command_output(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
    command_prefix: str,
) -> str | None:
    normalized_prefix = normalize_pm3_command(command_prefix)
    matches = [
        outputs[-1]
        for command, outputs in command_outputs.items()
        if command.startswith(normalized_prefix) and outputs
    ]
    return matches[-1].output if matches else None


def latest_command_output_by_context(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
    allowed_commands: set[str],
    context: str,
) -> str | None:
    matches = [
        outputs[-1]
        for command, outputs in command_outputs.items()
        if command in allowed_commands and outputs and outputs[-1].command_context == context
    ]
    return matches[-1].output if matches else None


def latest_hitag_read_output(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> str | None:
    matches = [
        outputs[-1]
        for command, outputs in command_outputs.items()
        if command.startswith("lf hitag hts rdbl") and outputs and outputs[-1].command_context == "read"
    ]
    return matches[-1].output if matches else None


def latest_hitag_reader_output(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> str | None:
    matches = [
        outputs[-1]
        for command, outputs in command_outputs.items()
        if command.startswith("lf hitag hts reader") and outputs and outputs[-1].command_context == "reader"
    ]
    return matches[-1].output if matches else None


def ignored_host_commands_from_outputs(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> tuple[str, ...]:
    ignored: list[str] = []
    for outputs in command_outputs.values():
        ignored.extend(output.normalized_command for output in outputs if output.command_context == "host_shell")
    return tuple(_dedupe(ignored))


def pm3_relevant_command_outputs(
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> dict[str, tuple[CapturedCommandOutput, ...]]:
    return {
        command: tuple(output for output in outputs if output.command_context != "host_shell")
        for command, outputs in command_outputs.items()
        if any(output.command_context != "host_shell" for output in outputs)
    }


def discovery_inputs_from_log(
    log_text: str,
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> DiscoveryTextInputs:
    diagnostics = _session_diagnostics_from_log(log_text, command_outputs)
    return DiscoveryTextInputs(
        startup_banner=_startup_banner_from_log(log_text),
        hw_version=latest_command_output(command_outputs, "hw version"),
        hw_tune=latest_command_output(command_outputs, "hw tune"),
        hf_search=latest_command_output_by_context(command_outputs, {"hf search"}, "discovery"),
        lf_search=latest_command_output_by_context(command_outputs, {"lf search", "lf search -u"}, "discovery"),
        hitag_reader=latest_hitag_reader_output(command_outputs),
        hitag_rdbl=latest_hitag_read_output(command_outputs),
        session_errors=diagnostics["session_errors"],
        failed_commands=diagnostics["failed_commands"],
        cmd_prompt_detected=diagnostics["cmd_prompt_detected"],
    )


def _startup_banner_from_log(log_text: str) -> str | None:
    prompt_match = PROMPT_RE.search(log_text)
    candidate = log_text[: prompt_match.start()] if prompt_match else log_text
    if "Using UART port" in candidate or "[ Proxmark3 ]" in candidate:
        return candidate.strip()
    return None


def _missing_fields(inputs: DiscoveryTextInputs) -> tuple[str, ...]:
    fields = (
        "startup_banner",
        "hw_version",
        "hw_tune",
        "hf_search",
        "lf_search",
        "hitag_rdbl",
    )
    return tuple(field for field in fields if getattr(inputs, field) is None)


def _session_diagnostics_from_log(
    log_text: str,
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> dict[str, tuple[str, ...] | bool]:
    session_errors: list[str] = []
    failed_commands: list[str] = []
    for outputs in command_outputs.values():
        for output in outputs:
            errors = _known_errors(output.output)
            if not errors:
                continue
            session_errors.extend(errors)
            failed_commands.append(output.normalized_command)

    return {
        "session_errors": tuple(_dedupe(session_errors)),
        "failed_commands": tuple(_dedupe(failed_commands)),
        "cmd_prompt_detected": _has_windows_cmd_prompt_fallback(log_text),
    }


def _known_errors(output: str) -> list[str]:
    errors: list[str] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        for marker in ERROR_MARKERS:
            if marker.lower() in line.lower():
                errors.append(marker)
                break
    return errors


def _has_windows_cmd_prompt_fallback(log_text: str) -> bool:
    return any(WINDOWS_CMD_PROMPT_RE.match(line.strip()) for line in log_text.splitlines())


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
