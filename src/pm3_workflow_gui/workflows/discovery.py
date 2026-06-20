from __future__ import annotations

from dataclasses import dataclass

from pm3_workflow_gui.pm3.parsers import (
    HfSearchResult,
    HitagSRead,
    HwTune,
    HwVersion,
    LfSearchResult,
    StartupBanner,
)
from pm3_workflow_gui.pm3.session import Pm3LaunchConfig
from pm3_workflow_gui.technologies.registry import detect_technology


@dataclass(frozen=True)
class DiscoveryInputs:
    launch_config: Pm3LaunchConfig
    startup_banner: StartupBanner | None = None
    hw_version: HwVersion | None = None
    hw_tune: HwTune | None = None
    hf_search: HfSearchResult | None = None
    lf_search: LfSearchResult | None = None
    hitag_read: HitagSRead | None = None


@dataclass(frozen=True)
class DiscoverySummary:
    device_status: str
    pm3_model: str | None
    client_version: str | None
    lf_antenna_status: str
    hf_antenna_status: str
    tag_status: str
    summary: str
    next_step: str


def summarize_discovery(inputs: DiscoveryInputs) -> DiscoverySummary:
    device_status = "connected" if inputs.startup_banner and inputs.startup_banner.com_port else "unknown"
    pm3_model = _first_present(
        inputs.hw_version.firmware if inputs.hw_version else None,
        inputs.startup_banner.target if inputs.startup_banner else None,
    )
    client_version = _first_present(
        inputs.hw_version.client_version if inputs.hw_version else None,
        inputs.startup_banner.client_version if inputs.startup_banner else None,
    )
    lf_antenna_status = _antenna_status(inputs.hw_tune.lf_antenna_status if inputs.hw_tune else None)
    hf_antenna_status = _antenna_status(inputs.hw_tune.hf_antenna_status if inputs.hw_tune else None)
    tag_status = _tag_status(inputs.hf_search, inputs.lf_search, inputs.hitag_read)
    summary, next_step = _summary_and_next_step(tag_status)
    return DiscoverySummary(
        device_status=device_status,
        pm3_model=pm3_model,
        client_version=client_version,
        lf_antenna_status=lf_antenna_status,
        hf_antenna_status=hf_antenna_status,
        tag_status=tag_status,
        summary=summary,
        next_step=next_step,
    )


def _first_present(*values: str | None) -> str | None:
    return next((value for value in values if value), None)


def _antenna_status(status: str | None) -> str:
    return "OK" if status == "ok" else "unknown"


def _tag_status(hf_search: HfSearchResult | None, lf_search: LfSearchResult | None, hitag_read: HitagSRead | None) -> str:
    detected = detect_technology(hf_search=hf_search, lf_search=lf_search, hitag_read=hitag_read)
    if detected:
        return detected.technology_id
    if hf_search and hf_search.status == "no_tag_found":
        return "none"
    return "unknown"


def _summary_and_next_step(tag_status: str) -> tuple[str, str]:
    if tag_status == "hitag_s256":
        return "Hitag S256 tag detected", "Create template or verify target read-only"
    if tag_status == "hitag_s_candidate":
        return "Hitag candidate detected", "Run lf hitag hts rdbl manually"
    if tag_status not in {"unknown", "none"}:
        return "RFID technology detected", "Open analysis; full template workflow is not available for this chip type yet"
    if tag_status == "none":
        return "No HF tag detected", "Run LF search if expecting a low-frequency tag"
    return "Discovery incomplete", "Run read-only startup, hw version, hw tune, hf search, and lf search checks"
