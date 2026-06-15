from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pm3_workflow_gui.services.capture import (
    CaptureResult,
    FixtureCaptureProvider,
    Pm3LogCaptureProvider,
    latest_log_file,
)
from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
    UiDiscoverySummary,
    default_launch_config,
)

Severity = Literal["ok", "warning", "error", "unknown"]

DEFAULT_LOG_DIR = Path(r"C:\Tools\proxmark3\client\.proxmark3\logs")
RECOMMENDED_START_COMMAND = r'cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"'


@dataclass(frozen=True)
class DemoSource:
    label: str
    kind: Literal["scenario", "log"]
    path: Path


@dataclass(frozen=True)
class DiscoveryViewModel:
    source: str
    source_path: str | None
    status_severity: Severity
    title: str
    primary_action_hint: str
    session_status: str
    reconnect_required: bool
    last_error: str | None
    failed_commands: tuple[str, ...]
    launch_mode: str
    com_port: str
    target: str
    client: str
    firmware: str
    lf_antenna_status: str
    hf_antenna_status: str
    discovery_data_status: str
    tag_frequency: str
    tag_type: str
    verification_status: str
    next_step: str
    risk_notes: tuple[str, ...]
    recognized_pm3_commands: tuple[str, ...]
    ignored_host_commands: tuple[str, ...]
    missing_sections: tuple[str, ...]


def demo_sources(repo_root: Path | None = None) -> tuple[DemoSource, ...]:
    root = repo_root or _repo_root()
    scenarios = root / "tests" / "fixtures" / "scenarios"
    pm3 = root / "tests" / "fixtures" / "pm3"
    return (
        DemoSource("Original Hitag scenario", "scenario", scenarios / "hitag_s256_original_discovery.json"),
        DemoSource("Blank before write", "scenario", scenarios / "hitag_s256_blank_before_write.json"),
        DemoSource("Blank after write", "scenario", scenarios / "hitag_s256_blank_after_write.json"),
        DemoSource("Help-only", "log", pm3 / "session_log_help_only_real.txt"),
        DemoSource("Lost device", "log", pm3 / "session_log_device_lost_after_failed_discovery.txt"),
        DemoSource("Success blank read", "log", pm3 / "session_log_hitag_s256_blank_read_success_real.txt"),
    )


def load_demo_view_model(label: str) -> DiscoveryViewModel:
    sources = {source.label: source for source in demo_sources()}
    try:
        source = sources[label]
    except KeyError as exc:
        raise ValueError(f"Unknown demo source: {label}") from exc
    provider = FixtureCaptureProvider(scenario_path=source.path) if source.kind == "scenario" else Pm3LogCaptureProvider(source.path)
    return view_model_from_capture(provider.capture(), source_label=source.label)


def load_log_view_model(path: str | Path) -> DiscoveryViewModel:
    log_path = Path(path)
    return view_model_from_capture(Pm3LogCaptureProvider(log_path).capture(), source_label="PM3 log")


def load_latest_log_view_model(log_dir: str | Path = DEFAULT_LOG_DIR) -> DiscoveryViewModel:
    latest = latest_log_file(log_dir)
    return load_log_view_model(latest)


def view_model_from_capture(capture: CaptureResult, source_label: str | None = None) -> DiscoveryViewModel:
    summary = capture.summarize(DiscoveryFacade(default_launch_config()))
    return view_model_from_summary(
        summary,
        recognized_pm3_commands=tuple(sorted(capture.command_outputs)),
        ignored_host_commands=capture.ignored_host_commands,
        missing_sections=capture.missing_fields,
        source=source_label or capture.source,
        source_path=_source_path(capture.source),
    )


def view_model_from_summary(
    summary: UiDiscoverySummary,
    recognized_pm3_commands: tuple[str, ...] = (),
    ignored_host_commands: tuple[str, ...] = (),
    missing_sections: tuple[str, ...] = (),
    source: str = "summary",
    source_path: str | None = None,
) -> DiscoveryViewModel:
    title = _title(summary)
    return DiscoveryViewModel(
        source=source,
        source_path=source_path,
        status_severity=_severity(summary),
        title=title,
        primary_action_hint=summary.recommended_next_step,
        session_status=summary.session_status,
        reconnect_required=summary.device_reconnect_required,
        last_error=summary.last_error,
        failed_commands=summary.failed_commands,
        launch_mode=summary.launch_mode,
        com_port=summary.com_port or "unknown/auto",
        target=summary.target or "unknown",
        client=summary.client_version or "unknown",
        firmware=summary.firmware or "unknown",
        lf_antenna_status=summary.lf_antenna_status,
        hf_antenna_status=summary.hf_antenna_status,
        discovery_data_status=summary.discovery_data_status,
        tag_frequency=summary.tag_frequency_guess,
        tag_type=_display_tag_type(summary.tag_type_guess),
        verification_status=summary.verification_status or "not_run",
        next_step=summary.recommended_next_step,
        risk_notes=summary.risk_notes,
        recognized_pm3_commands=recognized_pm3_commands,
        ignored_host_commands=ignored_host_commands or summary.ignored_host_commands,
        missing_sections=missing_sections or summary.missing_sections,
    )


def _severity(summary: UiDiscoverySummary) -> Severity:
    if summary.session_status == "device_lost":
        return "error"
    if summary.session_status == "command_failed":
        return "warning"
    if summary.discovery_data_status == "not captured":
        return "warning"
    if summary.tag_type_guess in {"hitag_s256_plain", "hitag_candidate"}:
        return "ok"
    if summary.session_status == "ok":
        return "warning"
    return "unknown"


def _title(summary: UiDiscoverySummary) -> str:
    if summary.session_status == "device_lost":
        return "Device lost"
    if summary.tag_type_guess == "hitag_s256_plain":
        return "Tag detected - Hitag S256"
    if summary.tag_type_guess == "hitag_candidate":
        return "Tag detected - Hitag candidate"
    if summary.discovery_data_status == "not captured":
        return "Discovery not captured"
    if summary.connected == "true":
        return "Proxmark connected"
    return "Session status unknown"


def _display_tag_type(tag_type: str) -> str:
    return {
        "hitag_s256_plain": "Hitag S256 Plain",
        "hitag_candidate": "Hitag candidate",
        "unknown": "unknown",
        "none": "none",
    }.get(tag_type, tag_type)


def _source_path(source: str) -> str | None:
    if ":" not in source:
        return None
    return source.split(":", 1)[1]


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "pyproject.toml").exists():
            return parent
    return current.parents[3]
