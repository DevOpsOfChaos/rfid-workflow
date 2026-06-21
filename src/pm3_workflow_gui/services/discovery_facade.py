from __future__ import annotations

from dataclasses import dataclass, field, replace
import json
from pathlib import Path
from typing import Literal

from pm3_workflow_gui.pm3.parsers import (
    HfSearchResult,
    HitagReaderResult,
    HitagSRead,
    HwTune,
    HwVersion,
    LfSearchResult,
    StartupBanner,
    parse_hf_search,
    parse_hitag_reader,
    parse_hitag_s_rdbl,
    parse_hw_tune,
    parse_hw_version,
    parse_indala_reader,
    parse_lf_search,
    parse_startup_banner,
    IndalaReadResult,
)
from pm3_workflow_gui.pm3.session import Pm3LaunchConfig
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.technologies.base import DetectedTechnology
from pm3_workflow_gui.technologies.registry import adapter_for, detect_technology
from pm3_workflow_gui.workflows.hitag_s256 import (
    VerificationResult,
    profile_from_hitag_s_read,
    verify_hitag_s256_profile,
)

ConnectedState = Literal["true", "false", "unknown"]
SessionStatus = Literal["ok", "command_failed", "device_lost", "unknown"]


@dataclass(frozen=True)
class DiscoveryTextInputs:
    startup_banner: str | None = None
    hw_version: str | None = None
    hw_tune: str | None = None
    hf_search: str | None = None
    lf_search: str | None = None
    hitag_reader: str | None = None
    hitag_rdbl: str | None = None
    indala_reader: str | None = None
    reference_hitag_rdbl: str | None = None
    session_errors: tuple[str, ...] = ()
    failed_commands: tuple[str, ...] = ()
    cmd_prompt_detected: bool = False
    ignored_host_commands: tuple[str, ...] = ()
    log_pollution_detected: bool = False


@dataclass(frozen=True)
class DiscoveryParseBundle:
    startup_banner: StartupBanner | None = None
    hw_version: HwVersion | None = None
    hw_tune: HwTune | None = None
    hf_search: HfSearchResult | None = None
    lf_search: LfSearchResult | None = None
    hitag_reader: HitagReaderResult | None = None
    hitag_read: HitagSRead | None = None
    indala_read: IndalaReadResult | None = None
    reference_profile: HitagS256Profile | None = None
    session_errors: tuple[str, ...] = ()
    failed_commands: tuple[str, ...] = ()
    cmd_prompt_detected: bool = False
    ignored_host_commands: tuple[str, ...] = ()
    log_pollution_detected: bool = False


@dataclass(frozen=True)
class UiDiscoverySummary:
    session_status: SessionStatus
    device_reconnect_required: bool
    last_error: str | None
    failed_commands: tuple[str, ...]
    missing_sections: tuple[str, ...]
    ignored_host_commands: tuple[str, ...]
    log_pollution_detected: bool
    connected: ConnectedState
    launch_mode: str
    com_port: str | None
    target: str | None
    client_version: str | None
    firmware: str | None
    lf_antenna_status: str
    hf_antenna_status: str
    discovery_data_status: str
    tag_frequency_guess: str
    tag_type_guess: str
    detected_technology: DetectedTechnology | None = None
    support_level: str = "unknown"
    risk_notes: tuple[str, ...] = ()
    recommended_next_step: str = "Run read-only discovery"
    verification_status: str | None = None

    def lines(self) -> list[str]:
        return [
            f"Session status: {self.session_status}",
            f"Reconnect required: {'yes' if self.device_reconnect_required else 'no'}",
            f"Last error: {self.last_error or 'none'}",
            f"Failed commands: {', '.join(self.failed_commands) if self.failed_commands else 'none'}",
            f"Ignored host commands: {len(self.ignored_host_commands)}",
            f"Launch mode: {self.launch_mode}",
            f"COM port: {self.com_port or 'unknown/auto'}",
            f"Target: {self.target or 'unknown'}",
            f"Client: {self.client_version or 'unknown'}",
            f"Firmware: {self.firmware or 'unknown'}",
            f"LF antenna: {self.lf_antenna_status}",
            f"HF antenna: {self.hf_antenna_status}",
            f"Discovery data: {self.discovery_data_status}",
            f"Tag frequency: {self.tag_frequency_guess}",
            f"Tag type: {_display_tag_type(self.tag_type_guess)}",
            f"Support level: {self.support_level}",
            f"Verification: {self.verification_status or 'not_run'}",
            f"Next step: {self.recommended_next_step}",
            *[f"Risk note: {note}" for note in self.risk_notes],
        ]


@dataclass(frozen=True)
class ScenarioDefinition:
    name: str
    inputs: DiscoveryTextInputs


class DiscoveryFacade:
    """UI-facing read-only boundary over PM3 parsers and profile workflows."""

    def __init__(self, launch_config: Pm3LaunchConfig) -> None:
        self.launch_config = launch_config

    def parse_texts(self, inputs: DiscoveryTextInputs) -> DiscoveryParseBundle:
        reference_read = parse_hitag_s_rdbl(inputs.reference_hitag_rdbl) if inputs.reference_hitag_rdbl else None
        reference_profile = profile_from_hitag_s_read(reference_read) if reference_read else None
        return DiscoveryParseBundle(
            startup_banner=parse_startup_banner(inputs.startup_banner) if inputs.startup_banner else None,
            hw_version=parse_hw_version(inputs.hw_version) if inputs.hw_version else None,
            hw_tune=parse_hw_tune(inputs.hw_tune) if inputs.hw_tune else None,
            hf_search=parse_hf_search(inputs.hf_search) if inputs.hf_search else None,
            lf_search=parse_lf_search(inputs.lf_search) if inputs.lf_search else None,
            hitag_reader=parse_hitag_reader(inputs.hitag_reader) if inputs.hitag_reader else None,
            hitag_read=parse_hitag_s_rdbl(inputs.hitag_rdbl) if inputs.hitag_rdbl else None,
            indala_read=parse_indala_reader(inputs.indala_reader) if inputs.indala_reader else None,
            reference_profile=reference_profile,
            session_errors=inputs.session_errors,
            failed_commands=inputs.failed_commands,
            cmd_prompt_detected=inputs.cmd_prompt_detected,
            ignored_host_commands=inputs.ignored_host_commands,
            log_pollution_detected=inputs.log_pollution_detected,
        )

    def summarize_texts(self, inputs: DiscoveryTextInputs) -> UiDiscoverySummary:
        return self.summarize_bundle(self.parse_texts(inputs))

    def summarize_bundle(self, bundle: DiscoveryParseBundle) -> UiDiscoverySummary:
        verification = _verify_if_possible(bundle.hitag_read, bundle.reference_profile)
        discovery_data_status = _discovery_data_status(bundle)
        session_status = _session_status(bundle)
        last_error = _last_error(bundle)
        detected = None if session_status == "device_lost" else detect_technology(bundle.hf_search, bundle.lf_search, bundle.hitag_reader, bundle.hitag_read)
        if detected and detected.technology_id == "indala" and bundle.indala_read and bundle.indala_read.false_positive_note:
            detected = replace(
                detected,
                uid=None,
                confidence="low",
                support_level="public_details",
                source="lf_indala_reader",
                read_status="signal_unstable",
            )
        tag_type_guess = _tag_type_guess(detected)
        risk_notes = tuple(_risk_notes(bundle, verification))
        connected = _connected(bundle.startup_banner)
        com_port = _first_present(
            bundle.startup_banner.com_port if bundle.startup_banner else None,
            self.launch_config.com_port,
        )
        return UiDiscoverySummary(
            session_status=session_status,
            device_reconnect_required=session_status == "device_lost",
            last_error=last_error,
            failed_commands=bundle.failed_commands,
            missing_sections=_missing_sections_from_bundle(bundle),
            ignored_host_commands=bundle.ignored_host_commands,
            log_pollution_detected=bundle.log_pollution_detected,
            connected=connected,
            launch_mode=self.launch_config.mode,
            com_port=com_port,
            target=_first_present(
                bundle.startup_banner.target if bundle.startup_banner else None,
                bundle.hw_version.firmware if bundle.hw_version else None,
            ),
            client_version=_first_present(
                bundle.hw_version.client_version if bundle.hw_version else None,
                bundle.startup_banner.client_version if bundle.startup_banner else None,
            ),
            firmware=bundle.hw_version.firmware if bundle.hw_version else None,
            lf_antenna_status=_antenna_status(bundle.hw_tune.lf_antenna_status if bundle.hw_tune else None),
            hf_antenna_status=_antenna_status(bundle.hw_tune.hf_antenna_status if bundle.hw_tune else None),
            discovery_data_status=discovery_data_status,
            tag_frequency_guess=_tag_frequency_guess(detected, bundle.hf_search),
            tag_type_guess=tag_type_guess,
            detected_technology=detected,
            support_level=_support_level(detected),
            risk_notes=risk_notes,
            recommended_next_step=_recommended_next_step(
                connected,
                com_port,
                session_status,
                tag_type_guess,
                verification,
                discovery_data_status,
                last_error,
            ),
            verification_status=verification.status if verification else None,
        )

    def summarize_scenario(self, scenario: ScenarioDefinition) -> UiDiscoverySummary:
        return self.summarize_texts(scenario.inputs)


def default_launch_config() -> Pm3LaunchConfig:
    proxmark_root = Path(r"C:\Tools\proxmark3")
    return Pm3LaunchConfig(
        mode="client_setup_bash",
        proxmark_root=proxmark_root,
        client_dir=proxmark_root / "client",
        com_port=None,
    )


def load_scenario(path: str | Path) -> ScenarioDefinition:
    scenario_path = Path(path)
    payload = json.loads(scenario_path.read_text(encoding="utf-8"))
    base_dir = scenario_path.parent

    def read_optional(key: str) -> str | None:
        value = payload.get(key)
        if not value:
            return None
        return (base_dir / value).resolve().read_text(encoding="utf-8")

    return ScenarioDefinition(
        name=payload["name"],
        inputs=DiscoveryTextInputs(
            startup_banner=read_optional("startup_banner"),
            hw_version=read_optional("hw_version"),
            hw_tune=read_optional("hw_tune"),
            hf_search=read_optional("hf_search"),
            lf_search=read_optional("lf_search"),
            hitag_reader=read_optional("hitag_reader"),
            hitag_rdbl=read_optional("hitag_rdbl"),
            reference_hitag_rdbl=read_optional("reference_hitag_rdbl"),
        ),
    )


def load_default_fixture_dir(fixture_dir: str | Path) -> DiscoveryTextInputs:
    base = Path(fixture_dir)

    def read(name: str) -> str | None:
        path = base / name
        return path.read_text(encoding="utf-8") if path.exists() else None

    return DiscoveryTextInputs(
        startup_banner=read("startup_banner_com16.txt"),
        hw_version=read("hw_version_pm3_generic.txt"),
        hw_tune=read("hw_tune_ok_no_tag.txt"),
        hf_search=read("hf_search_no_tag_found.txt"),
        lf_search=read("lf_search_hitag_s256_original.txt"),
        hitag_rdbl=read("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
    )


def _connected(startup_banner: StartupBanner | None) -> ConnectedState:
    if startup_banner is None:
        return "unknown"
    return "true" if startup_banner.com_port else "unknown"


def _first_present(*values: str | None) -> str | None:
    return next((value for value in values if value), None)


def _antenna_status(status: str | None) -> str:
    if status == "ok":
        return "ok"
    return "unknown"


def _tag_frequency_guess(
    detected: DetectedTechnology | None,
    hf_search: HfSearchResult | None,
) -> str:
    if detected:
        return detected.frequency
    if hf_search and hf_search.status == "no_tag_found":
        return "none"
    return "unknown"


def _tag_type_guess(detected: DetectedTechnology | None) -> str:
    return detected.technology_id if detected else "unknown"


def _discovery_data_status(bundle: DiscoveryParseBundle) -> str:
    if (
        (bundle.hf_search and bundle.hf_search.status != "unknown")
        or (bundle.lf_search and (bundle.lf_search.identification_status != "unknown" or bundle.lf_search.uid or bundle.lf_search.tag_type or bundle.lf_search.chipset or bundle.lf_search.hint))
        or bundle.hitag_reader
        or bundle.hitag_read
        or bundle.indala_read
    ):
        return "captured"
    if bundle.hw_version and bundle.hw_tune:
        return "not captured"
    return "unknown"


def _verify_if_possible(
    hitag_read: HitagSRead | None,
    reference_profile: HitagS256Profile | None,
) -> VerificationResult | None:
    if hitag_read is None or reference_profile is None:
        return None
    return verify_hitag_s256_profile(hitag_read, reference_profile)


def _risk_notes(bundle: DiscoveryParseBundle, verification: VerificationResult | None) -> list[str]:
    notes: list[str] = []
    if bundle.lf_search and bundle.lf_search.false_positive_notes:
        notes.append("LF search included possible false positives; Hitag hint was evaluated separately.")
    if bundle.indala_read and bundle.indala_read.false_positive_note:
        notes.append("Indala reader reported possible false-positive sizing; repeat read and check tag position.")
    if bundle.lf_search and bundle.lf_search.identification_status == "no_chipset":
        notes.append("LF search did not identify a supported chipset.")
    if bundle.hitag_read and bundle.hitag_read.is_hitag_s256_plain_no_auth:
        notes.append("Plain/No Auth detected; do not enable crypto, password, or locking options.")
        notes.append("UID page 0 is read-only and must not be written.")
    if verification and verification.status == "failed":
        notes.append("Config/TTF differ from profile, write plan required.")
    if verification and verification.status == "verified_with_uid_mismatch":
        notes.append("Profile verified with UID mismatch; UID difference is expected for the blank.")
    return notes


def _recommended_next_step(
    connected: ConnectedState,
    com_port: str | None,
    session_status: SessionStatus,
    tag_type_guess: str,
    verification: VerificationResult | None,
    discovery_data_status: str,
    last_error: str | None,
) -> str:
    if session_status == "device_lost":
        return "Reconnect USB and restart PM3 session"
    if session_status == "command_failed":
        if last_error == "Proxmark port was found, but PM3 command execution failed.":
            return "Proxmark port was found, but PM3 command execution failed."
        return "Check tag placement and run lf search again"
    if connected == "unknown" and com_port is None and discovery_data_status != "captured":
        return "Start Proxmark with auto-detect"
    if verification and verification.status == "verified_with_uid_mismatch":
        return "Record verification result and keep UID mismatch noted"
    if verification and verification.status == "failed":
        return "Config/TTF differ from profile, write plan required"
    if tag_type_guess == "hitag_s256":
        return "Vorlage erstellen oder Zielchip read-only vergleichen"
    if tag_type_guess == "hitag_s_candidate":
        return "Run lf hitag hts rdbl -p 0 -c 8"
    if tag_type_guess == "indala":
        return "Indala public identity read available; repeat if Raw ID or length is unstable"
    if tag_type_guess not in {"unknown", "none"}:
        return "Analyse öffnen; Detailread und Vorlagen-Workflow sind für diesen Chiptyp noch nicht verfügbar"
    if discovery_data_status == "not captured":
        return "Run hf search and lf search with the tag present"
    return "Place tag on antenna and run hf search / lf search"


def _session_status(bundle: DiscoveryParseBundle) -> SessionStatus:
    if any(error == "Communicating with Proxmark3 device failed" for error in bundle.session_errors):
        return "device_lost"
    if bundle.cmd_prompt_detected and any(
        error in {"timeout while waiting for reply", "Failed to get current device debug level"}
        for error in bundle.session_errors
    ):
        return "device_lost"
    command_failure_errors = {
        "UID Request failed!",
        "timeout while waiting for reply",
        "Failed to get current device debug level",
        "Proxmark port was found, but PM3 command execution failed.",
    }
    if any(error in command_failure_errors for error in bundle.session_errors):
        return "command_failed"
    if bundle.startup_banner or bundle.hw_version or bundle.hw_tune or bundle.hf_search or bundle.lf_search or bundle.hitag_reader or bundle.hitag_read or bundle.indala_read:
        return "ok"
    return "unknown"


def _last_error(bundle: DiscoveryParseBundle) -> str | None:
    if not bundle.session_errors:
        return None
    priority = (
        "Communicating with Proxmark3 device failed",
        "Failed to get current device debug level",
        "Proxmark port was found, but PM3 command execution failed.",
        "timeout while waiting for reply",
        "UID Request failed!",
        "Couldn't identify a chipset",
        "No known/supported 13.56 MHz tags found",
    )
    for candidate in priority:
        if candidate in bundle.session_errors:
            return candidate
    return bundle.session_errors[-1]


def _has_hitag_read_error(hitag_read: HitagSRead | None) -> bool:
    return bool(hitag_read and hitag_read.errors)


def _missing_sections_from_bundle(bundle: DiscoveryParseBundle) -> tuple[str, ...]:
    fields = (
        ("startup_banner", bundle.startup_banner),
        ("hw_version", bundle.hw_version),
        ("hw_tune", bundle.hw_tune),
        ("hf_search", bundle.hf_search),
        ("lf_search", bundle.lf_search),
        ("hitag_rdbl", bundle.hitag_read),
    )
    return tuple(name for name, value in fields if value is None)


def _display_tag_type(tag_type_guess: str) -> str:
    labels = {
        "hitag_s256": "Hitag S256",
        "hitag_s256_plain": "Hitag S256 Plain",
        "hitag_s_candidate": "Hitag S candidate",
        "hitag_candidate": "Hitag candidate",
        "mifare_classic": "MIFARE Classic",
        "iso14443a": "ISO14443A",
        "em410x": "EM410x",
        "indala": "Indala",
        "t5577": "T5577",
        "unknown_lf": "Unknown LF chip",
        "unknown_hf": "Unknown HF chip",
        "unknown": "unknown",
        "none": "none",
    }
    return labels.get(tag_type_guess, tag_type_guess)


def _support_level(detected: DetectedTechnology | None) -> str:
    if not detected:
        return "none"
    capabilities = adapter_for(detected).capabilities
    if capabilities.can_create_template and capabilities.can_compare_template and capabilities.can_read_memory:
        return "full_supported_read"
    return detected.read_status or detected.support_level
