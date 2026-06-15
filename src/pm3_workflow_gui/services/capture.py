from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
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

@dataclass(frozen=True)
class CapturedCommandOutput:
    command: str
    normalized_command: str
    output: str


@dataclass(frozen=True)
class CaptureResult:
    source: str
    inputs: DiscoveryTextInputs
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]] = field(default_factory=dict)
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
            hitag_rdbl=self.text_blocks.get("hitag_rdbl"),
            reference_hitag_rdbl=self.text_blocks.get("reference_hitag_rdbl"),
        )
        return CaptureResult(source="manual-text", inputs=inputs, missing_fields=_missing_fields(inputs))


@dataclass(frozen=True)
class Pm3LogCaptureProvider:
    log_path: Path

    def capture(self) -> CaptureResult:
        text = self.log_path.read_text(encoding="utf-8", errors="replace")
        command_outputs = split_pm3_log_commands(text)
        inputs = discovery_inputs_from_log(text, command_outputs)
        return CaptureResult(
            source=f"log:{self.log_path}",
            inputs=inputs,
            command_outputs=command_outputs,
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


def discovery_inputs_from_log(
    log_text: str,
    command_outputs: dict[str, tuple[CapturedCommandOutput, ...]],
) -> DiscoveryTextInputs:
    return DiscoveryTextInputs(
        startup_banner=_startup_banner_from_log(log_text),
        hw_version=latest_command_output(command_outputs, "hw version"),
        hw_tune=latest_command_output(command_outputs, "hw tune"),
        hf_search=latest_command_output(command_outputs, "hf search"),
        lf_search=latest_command_output(command_outputs, "lf search"),
        hitag_rdbl=latest_command_output(command_outputs, "lf hitag hts rdbl"),
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
