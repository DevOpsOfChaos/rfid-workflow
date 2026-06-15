from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Literal

from pm3_workflow_gui.pm3.parsers import (
    HfSearchResult,
    HitagSRead,
    HwTune,
    HwVersion,
    LfSearchResult,
    StartupBanner,
    parse_hf_search,
    parse_hitag_s_rdbl,
    parse_hw_tune,
    parse_hw_version,
    parse_lf_search,
    parse_startup_banner,
)
from pm3_workflow_gui.pm3.session import Pm3LaunchConfig
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.workflows.hitag_s256 import (
    VerificationResult,
    profile_from_hitag_s_read,
    verify_hitag_s256_profile,
)

ConnectedState = Literal["true", "false", "unknown"]


@dataclass(frozen=True)
class DiscoveryTextInputs:
    startup_banner: str | None = None
    hw_version: str | None = None
    hw_tune: str | None = None
    hf_search: str | None = None
    lf_search: str | None = None
    hitag_rdbl: str | None = None
    reference_hitag_rdbl: str | None = None


@dataclass(frozen=True)
class DiscoveryParseBundle:
    startup_banner: StartupBanner | None = None
    hw_version: HwVersion | None = None
    hw_tune: HwTune | None = None
    hf_search: HfSearchResult | None = None
    lf_search: LfSearchResult | None = None
    hitag_read: HitagSRead | None = None
    reference_profile: HitagS256Profile | None = None


@dataclass(frozen=True)
class UiDiscoverySummary:
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
    risk_notes: tuple[str, ...] = ()
    recommended_next_step: str = "Run read-only discovery"
    verification_status: str | None = None

    def lines(self) -> list[str]:
        return [
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
            hitag_read=parse_hitag_s_rdbl(inputs.hitag_rdbl) if inputs.hitag_rdbl else None,
            reference_profile=reference_profile,
        )

    def summarize_texts(self, inputs: DiscoveryTextInputs) -> UiDiscoverySummary:
        return self.summarize_bundle(self.parse_texts(inputs))

    def summarize_bundle(self, bundle: DiscoveryParseBundle) -> UiDiscoverySummary:
        verification = _verify_if_possible(bundle.hitag_read, bundle.reference_profile)
        tag_type_guess = _tag_type_guess(bundle.lf_search, bundle.hitag_read)
        discovery_data_status = _discovery_data_status(bundle)
        risk_notes = tuple(_risk_notes(bundle, verification))
        connected = _connected(bundle.startup_banner)
        com_port = _first_present(
            bundle.startup_banner.com_port if bundle.startup_banner else None,
            self.launch_config.com_port,
        )
        return UiDiscoverySummary(
            connected=connected,
            launch_mode=self.launch_config.mode,
            com_port=com_port,
            target=bundle.startup_banner.target if bundle.startup_banner else None,
            client_version=_first_present(
                bundle.hw_version.client_version if bundle.hw_version else None,
                bundle.startup_banner.client_version if bundle.startup_banner else None,
            ),
            firmware=bundle.hw_version.firmware if bundle.hw_version else None,
            lf_antenna_status=_antenna_status(bundle.hw_tune.lf_antenna_status if bundle.hw_tune else None),
            hf_antenna_status=_antenna_status(bundle.hw_tune.hf_antenna_status if bundle.hw_tune else None),
            discovery_data_status=discovery_data_status,
            tag_frequency_guess=_tag_frequency_guess(bundle.hf_search, bundle.lf_search, bundle.hitag_read),
            tag_type_guess=tag_type_guess,
            risk_notes=risk_notes,
            recommended_next_step=_recommended_next_step(
                connected,
                com_port,
                tag_type_guess,
                verification,
                discovery_data_status,
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
    hf_search: HfSearchResult | None,
    lf_search: LfSearchResult | None,
    hitag_read: HitagSRead | None,
) -> str:
    if hitag_read or (lf_search and lf_search.classification == "hitag_candidate"):
        return "lf"
    if hf_search and hf_search.status == "no_tag_found":
        return "none"
    return "unknown"


def _tag_type_guess(lf_search: LfSearchResult | None, hitag_read: HitagSRead | None) -> str:
    if hitag_read and hitag_read.is_hitag_s256_plain_no_auth:
        return "hitag_s256_plain"
    if lf_search and lf_search.classification == "hitag_candidate":
        return "hitag_candidate"
    return "unknown"


def _discovery_data_status(bundle: DiscoveryParseBundle) -> str:
    if bundle.hf_search or bundle.lf_search or bundle.hitag_read:
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
    tag_type_guess: str,
    verification: VerificationResult | None,
    discovery_data_status: str,
) -> str:
    if connected == "unknown" and com_port is None and discovery_data_status != "captured":
        return "Start Proxmark with auto-detect"
    if verification and verification.status == "verified_with_uid_mismatch":
        return "Record verification result and keep UID mismatch noted"
    if verification and verification.status == "failed":
        return "Config/TTF differ from profile, write plan required"
    if tag_type_guess == "hitag_s256_plain":
        return "Read/save profile or verify blank compatibility"
    if tag_type_guess == "hitag_candidate":
        return "Run lf hitag hts rdbl -p 0 -c 8"
    if discovery_data_status == "not captured":
        return "Run hf search and lf search with the tag present"
    return "Run read-only discovery"


def _display_tag_type(tag_type_guess: str) -> str:
    labels = {
        "hitag_s256_plain": "Hitag S256 Plain",
        "hitag_candidate": "Hitag candidate",
        "unknown": "unknown",
        "none": "none",
    }
    return labels.get(tag_type_guess, tag_type_guess)
