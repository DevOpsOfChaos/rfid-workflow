from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pm3_workflow_gui.pm3.parsers import HitagSRead, HwTune, HwVersion, IndalaReadResult
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import TemplateRecord, save_template_record
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
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService, PositioningCheckResult
from pm3_workflow_gui.services.pm3_graph_viewer import LOCAL_GRAPH_WORKFLOW
from pm3_workflow_gui.technologies.base import (
    CAPABILITY_LABELS,
    CAPABILITY_STATE_LABELS,
    CapabilityAction,
    CapabilityState,
    DetectedTechnology,
    TechnologyCapabilities,
)
from pm3_workflow_gui.technologies.registry import adapter_for, detect_technology, registered_adapters
from pm3_workflow_gui.workflows.hitag_s256 import profile_from_hitag_s_read

Severity = Literal["ok", "warning", "error", "unknown"]
ValueState = Literal["same", "different", "uid", "config", "incompatible"]

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


@dataclass(frozen=True)
class StartupScreenViewModel:
    title: str
    message: str
    progress_label: str
    connected: bool
    can_continue: bool
    can_retry: bool
    port: str | None = None
    target: str | None = None


@dataclass(frozen=True)
class HardwarePrepViewModel:
    title: str
    message: str
    button_label: str
    ready: bool = False
    lf_antenna_status: str = "unknown"
    hf_antenna_status: str = "unknown"
    diagram_available: bool = LOCAL_GRAPH_WORKFLOW.enabled
    diagram_message: str = LOCAL_GRAPH_WORKFLOW.failure_reason or "PM3-Diagramm lokal bestätigt."


@dataclass(frozen=True)
class ChipFieldViewModel:
    label: str
    value: str
    note: str = ""


@dataclass(frozen=True)
class ChipReadViewModel:
    status: str
    title: str
    message: str
    fields: tuple[ChipFieldViewModel, ...] = ()
    memory_sections: tuple[ChipFieldViewModel, ...] = ()
    public_configuration: tuple[ChipFieldViewModel, ...] = ()
    warnings: tuple[str, ...] = ()
    next_step: str = ""
    read_status: str = ""
    support_level: str = ""
    profile: HitagS256Profile | None = None
    raw_read: HitagSRead | None = None
    public_raw_read: object | None = None
    technology: DetectedTechnology | None = None
    capabilities: TechnologyCapabilities | None = None

    @property
    def is_complete_template_read(self) -> bool:
        return self.profile is not None and bool(self.capabilities and self.capabilities.can_create_template)


@dataclass(frozen=True)
class TemplateValidationViewModel:
    status: str
    message: str
    first: ChipReadViewModel | None = None
    second: ChipReadViewModel | None = None
    differences: tuple[tuple[str, str, str], ...] = ()

    @property
    def can_save(self) -> bool:
        return self.status == "confirmed" and self.first is not None and self.first.profile is not None


@dataclass(frozen=True)
class ComparisonRowViewModel:
    label: str
    current_value: str
    template_value: str
    state: ValueState
    note: str = ""


@dataclass(frozen=True)
class DisabledWriteActionViewModel:
    label: str
    reason: str = "Noch nicht implementiert"
    page: int | None = None
    old_value: str = ""
    new_value: str = ""
    enabled: bool = False


@dataclass(frozen=True)
class WritePlanViewModel:
    compatible: bool
    compatibility_message: str
    summary_lines: tuple[str, ...]
    rows: tuple[ComparisonRowViewModel, ...]
    plan_steps: tuple[str, ...]
    disabled_actions: tuple[DisabledWriteActionViewModel, ...]
    difference_count: int = 0
    writable_difference_count: int = 0


@dataclass(frozen=True)
class WriteActivationViewModel:
    write_ready: bool
    reason: str


@dataclass(frozen=True)
class CapabilityCellViewModel:
    action: CapabilityAction
    label: str
    state: CapabilityState
    state_label: str
    explanation: str = ""


@dataclass(frozen=True)
class CapabilityMatrixRowViewModel:
    technology_id: str
    technology: str
    detect: CapabilityCellViewModel
    identity: CapabilityCellViewModel
    detail_read: CapabilityCellViewModel
    template: CapabilityCellViewModel
    write: CapabilityCellViewModel
    analysis: CapabilityCellViewModel


@dataclass(frozen=True)
class ExpertToolViewModel:
    technology_id: str
    action: CapabilityAction
    label: str
    state: CapabilityState
    state_label: str
    explanation: str
    parameter_hint: str = ""


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


def normal_navigation_items() -> tuple[str, ...]:
    return ("Vorlage", "Schreiben", "Analyse")


def expert_navigation_items() -> tuple[str, ...]:
    return ("Technologien", "Werkzeuge", "Vorlagen & Dumps", "Analyse", "Protokoll")


def capability_matrix_view_model() -> tuple[CapabilityMatrixRowViewModel, ...]:
    return tuple(
        CapabilityMatrixRowViewModel(
            technology_id=adapter.technology_id,
            technology=adapter.display_name,
            detect=_capability_cell(adapter.capabilities, "detect"),
            identity=_capability_cell(adapter.capabilities, "read_identity"),
            detail_read=_capability_cell(adapter.capabilities, "read_memory"),
            template=_capability_cell(adapter.capabilities, "create_template"),
            write=_capability_cell(adapter.capabilities, "write_memory"),
            analysis=_capability_cell(adapter.capabilities, "analyse_signal"),
        )
        for adapter in registered_adapters()
    )


def expert_tools_view_model(technology_id: str | None = None) -> tuple[ExpertToolViewModel, ...]:
    adapters = registered_adapters()
    selected = next((adapter for adapter in adapters if adapter.technology_id == technology_id), adapters[0])
    return tuple(
        ExpertToolViewModel(
            technology_id=selected.technology_id,
            action=definition.action,
            label=_tool_label(definition.action),
            state=definition.state,
            state_label=definition.state_label,
            explanation=definition.explanation or definition.state_label,
            parameter_hint=_parameter_hint(definition.action),
        )
        for definition in selected.capabilities.registered_actions()
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


def load_live_scan_view_model(service: LivePm3ReadonlyService | None = None) -> DiscoveryViewModel:
    live_service = service or LivePm3ReadonlyService()
    return view_model_from_capture(live_service.capture(), source_label="Live scan")


def startup_view_model_initial() -> StartupScreenViewModel:
    return StartupScreenViewModel(
        title="PM3 Workflow",
        message="Proxmark wird verbunden ...",
        progress_label="pm3 --list",
        connected=False,
        can_continue=False,
        can_retry=False,
    )


def startup_view_model_from_check(check) -> StartupScreenViewModel:
    if check.connected:
        target = check.target or "PM3 Generic"
        return StartupScreenViewModel(
            title="PM3 Workflow",
            message="Proxmark erkannt",
            progress_label="hw version ok",
            connected=True,
            can_continue=True,
            can_retry=False,
            port=check.port,
            target=target,
        )
    return StartupScreenViewModel(
        title="PM3 Workflow",
        message="Proxmark nicht gefunden. Bitte USB-Kabel kurz trennen, erneut verbinden und dann erneut prüfen.",
        progress_label="Verbindung fehlgeschlagen",
        connected=False,
        can_continue=False,
        can_retry=True,
        port=check.port,
        target=check.target,
    )


def startup_view_model_error(message: str) -> StartupScreenViewModel:
    return StartupScreenViewModel(
        title="PM3 Workflow",
        message=f"Startprüfung fehlgeschlagen: {message}",
        progress_label="Verbindung fehlgeschlagen",
        connected=False,
        can_continue=False,
        can_retry=True,
    )


def hardware_prep_initial() -> HardwarePrepViewModel:
    return HardwarePrepViewModel(
        title="Vorbereitung",
        message="Liegt aktuell kein Chip auf dem Proxmark?\n\nBitte entferne alle RFID-/NFC-Chips von der Antenne.",
        button_label="Kein Chip liegt auf · Hardware prüfen",
    )


def hardware_prep_from_check(check) -> HardwarePrepViewModel:
    if check.ok:
        return HardwarePrepViewModel(
            title="Vorbereitung",
            message="LF/HF-Antenne geprüft.",
            button_label="Hardware geprüft",
            ready=True,
            lf_antenna_status=check.lf_antenna_status,
            hf_antenna_status=check.hf_antenna_status,
            diagram_available=LOCAL_GRAPH_WORKFLOW.enabled,
            diagram_message=LOCAL_GRAPH_WORKFLOW.failure_reason or "Frequenzdiagramm lokal bestätigt.",
        )
    return HardwarePrepViewModel(
        title="Vorbereitung",
        message="Hardwareprüfung nicht eindeutig. Entferne Chips von der Antenne und prüfe die USB-Verbindung.",
        button_label="Erneut prüfen",
        ready=False,
        lf_antenna_status=check.lf_antenna_status,
        hf_antenna_status=check.hf_antenna_status,
        diagram_available=LOCAL_GRAPH_WORKFLOW.enabled,
        diagram_message=LOCAL_GRAPH_WORKFLOW.failure_reason or "Frequenzdiagramm lokal bestätigt.",
    )


def chip_read_view_model_from_hitag_read(read: HitagSRead) -> ChipReadViewModel:
    detection = detect_technology(hitag_read=read)
    if detection is None:
        return ChipReadViewModel(
            status="unsupported",
            title="Chip erkannt",
            message="Dieser Chiptyp wird erkannt, aber ein vollständiger Vorlagen-Read ist in V1 noch nicht verfügbar.",
            raw_read=read,
        )
    return _chip_read_view_model_from_adapter_result(detection, read)


def chip_read_view_model_from_live_result(result) -> ChipReadViewModel:
    detection = getattr(result, "detected_technology", None)
    if detection is None and getattr(result, "status", None) != "signal_unstable":
        detection = detect_technology(
            hf_search=getattr(result, "hf_search", None),
            lf_search=getattr(result, "lf_search", None),
            hitag_read=getattr(result, "hitag_read", None),
        )
    if result.success and result.hitag_read and detection:
        return _chip_read_view_model_from_adapter_result(detection, result.hitag_read)
    if result.status in {"signal_unstable", "hitag_candidate_unstable", "reader_failed", "detail_read_unstable", "uid_request_failed"}:
        fields = _unstable_signal_fields(result)
        return ChipReadViewModel(
            "signal_unstable",
            "Chip-Signal gefunden",
            result.message or "Noch keine stabile Identifikation.",
            fields=fields,
            warnings=_evidence_warning_labels(getattr(result, "scan_evidence", None)),
            next_step="Position prüfen oder weiter messen.",
            technology=detection,
            capabilities=adapter_for(detection).capabilities if detection else None,
        )
    if detection:
        return _chip_read_view_model_from_adapter_result(
            detection,
            getattr(result, "hitag_read", None) or getattr(result, "indala_read", None),
        )
    if result.status == "no_chip":
        return ChipReadViewModel(
            "no_chip",
            "Kein Chip erkannt",
            result.message or "Bitte Chip mittig auflegen und erneut scannen.",
        )
    return ChipReadViewModel("error", "Scan nicht abgeschlossen", result.message or "Scan fehlgeschlagen")


def chip_read_view_model_from_positioning_result(result: PositioningCheckResult) -> ChipReadViewModel:
    if result.status == "stable_detected" and result.stable_candidate:
        fields = [
            ChipFieldViewModel("Technologie", _display_tag_type(result.stable_candidate.family)),
            ChipFieldViewModel("Frequenz", result.stable_candidate.frequency.upper()),
        ]
        if result.stable_candidate.uid_or_raw_value:
            fields.append(ChipFieldViewModel("UID / ID", result.stable_candidate.uid_or_raw_value))
        if result.stable_candidate.chipset:
            fields.append(ChipFieldViewModel("Chipset", result.stable_candidate.chipset))
        return ChipReadViewModel(
            "position_stable",
            "Stabil erkannt",
            "Der Kandidat wurde wiederholt gleich gemessen.",
            fields=tuple(fields),
            next_step=result.next_step or "Nächster Schritt: Details lesen",
            technology=result.detected_technology,
            capabilities=adapter_for(result.detected_technology).capabilities if result.detected_technology else None,
        )
    if result.status == "no_signal":
        return ChipReadViewModel(
            "no_chip",
            "Kein Signal",
            result.message or "Kein Signal erkannt.",
            next_step=result.next_step or "Chip langsam über die Antenne bewegen.",
        )
    return ChipReadViewModel(
        "signal_unstable",
        "Chip-Signal gefunden",
        "Die Daten sind noch nicht stabil genug.\nVerschiebe den Chip einige Millimeter oder drehe ihn leicht.",
        fields=(ChipFieldViewModel("Signal", "vorhanden"),),
        warnings=_evidence_warning_labels(result.scan_evidence),
        next_step=result.next_step or "Weiter messen.",
    )


def validate_second_scan(first: ChipReadViewModel, second: ChipReadViewModel) -> TemplateValidationViewModel:
    if not first.profile or not second.profile:
        return TemplateValidationViewModel(
            "blocked",
            "Ein vollständiger Vorlagen-Read ist für beide Scans erforderlich.",
            first,
            second,
        )
    differences = _profile_differences(first.profile, second.profile)
    if differences:
        return TemplateValidationViewModel(
            "mismatch",
            "Die beiden Scans unterscheiden sich. Speichern ist blockiert.",
            first,
            second,
            differences,
        )
    return TemplateValidationViewModel("confirmed", "Scan bestätigt", first, second)


def save_confirmed_template(
    validation: TemplateValidationViewModel,
    title: str,
    description: str,
    directory: str | Path | None = None,
) -> Path:
    if not validation.can_save or validation.first is None or validation.first.profile is None:
        raise ValueError("Template can only be saved after two matching scans.")
    if not title.strip():
        raise ValueError("Template title is required.")
    record = TemplateRecord.from_hitag_s256_profile(title, description, validation.first.profile)
    return save_template_record(record, directory)


def build_write_plan_view_model(current: HitagS256Profile, template: TemplateRecord | HitagS256Profile) -> WritePlanViewModel:
    template_profile = template.profile if isinstance(template, TemplateRecord) else template
    incompatible_reasons = _incompatible_reasons(current, template_profile)
    rows = list(_comparison_rows(current, template_profile, incompatible=bool(incompatible_reasons)))
    differing_writable_pages = tuple(
        page
        for page in template_profile.writable_data_pages
        if current.pages.get(page) != template_profile.pages.get(page)
    )
    config_differs = current.config_page() != template_profile.config_page()
    only_uid_mismatch = current.uid != template_profile.uid and not differing_writable_pages and not config_differs
    compatible = not incompatible_reasons
    if only_uid_mismatch:
        compatibility_message = "Kompatibilität: Zielchip ist geeignet; nur UID weicht ab"
    elif compatible:
        compatibility_message = "Kompatibilität: Zielchip ist geeignet"
    else:
        compatibility_message = "Kompatibilität: Zielchip ist nicht geeignet"
    summary = []
    summary.extend(incompatible_reasons)
    if differing_writable_pages:
        summary.append(f"{len(differing_writable_pages)} Speicherbereiche unterscheiden sich")
    if config_differs:
        summary.append("Konfiguration muss angepasst werden")
    if only_uid_mismatch:
        summary.append("Nur UID weicht ab; UID ist nicht schreibbar")
    if not summary:
        summary.append("Alle relevanten Bereiche passen")
    changed_pages = set(differing_writable_pages)
    if config_differs:
        changed_pages.add(1)
    plan_pages = tuple(page for page in template_profile.write_order if page in changed_pages and page in {4, 5, 6, 7, 1})
    plan_steps = tuple(
        f"{index}. {'Konfiguration schreiben' if page == 1 else f'Block {page} schreiben'}"
        for index, page in enumerate(plan_pages, start=1)
    )
    disabled_actions = tuple(
        DisabledWriteActionViewModel(
            "Konfiguration schreiben" if page == 1 else f"Block {page} schreiben",
            _write_action_block_reason(page, current, template_profile),
            page,
            _compact_display(current.pages.get(page)),
            _compact_display(template_profile.pages.get(page)),
            _write_action_available(page, current, template_profile),
        )
        for page in plan_pages
    )
    writable_difference_count = sum(1 for action in disabled_actions if action.enabled)
    return WritePlanViewModel(
        compatible,
        compatibility_message,
        tuple(summary),
        tuple(rows),
        plan_steps,
        disabled_actions,
        len(changed_pages) + (1 if current.uid != template_profile.uid else 0),
        writable_difference_count,
    )


def write_activation_view_model(
    template_selected: bool,
    target_scanned: bool,
    authorized: bool,
    plan: WritePlanViewModel | None,
) -> WriteActivationViewModel:
    if not template_selected:
        return WriteActivationViewModel(False, "Bitte zuerst eine Vorlage auswählen.")
    if not target_scanned:
        return WriteActivationViewModel(False, "Bitte zuerst einen Zielchip scannen.")
    if plan is None:
        return WriteActivationViewModel(False, "Vergleich noch nicht erstellt.")
    if plan.writable_difference_count == 0:
        return WriteActivationViewModel(False, "Keine schreibbaren Unterschiede vorhanden.")
    if not authorized:
        return WriteActivationViewModel(False, "Schreibmodus aktivieren.")
    return WriteActivationViewModel(True, "Schreibmodus aktiv. Änderungen werden danach verifiziert.")


def unavailable_write_plan_view_model(chip: ChipReadViewModel | None = None) -> WritePlanViewModel:
    technology_name = chip.technology.technology_name if chip and chip.technology else "Dieser Chiptyp"
    capabilities = chip.capabilities if chip and chip.capabilities else adapter_for(chip.technology if chip else None).capabilities
    write_state = capabilities.definition_for("write_memory")
    reason = write_state.explanation or write_state.state_label
    return WritePlanViewModel(
        compatible=False,
        compatibility_message=f"Schreiben für {technology_name}: {reason}",
        summary_lines=("Kein technisch verfügbarer Schreibplan für diesen konkreten Chip.",),
        rows=(),
        plan_steps=(),
        disabled_actions=(),
    )


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
    if summary.scan_state in {"signal_detected_but_ambiguous", "signal_unstable", "technology_candidate"}:
        return "warning"
    if summary.discovery_data_status == "not captured":
        return "warning"
    if summary.tag_type_guess in {"hitag_s256", "hitag_s_candidate"}:
        return "ok"
    if summary.detected_technology is not None:
        return "warning"
    if summary.session_status == "ok":
        return "warning"
    return "unknown"


def _title(summary: UiDiscoverySummary) -> str:
    if summary.session_status == "device_lost":
        return "Device lost"
    if summary.scan_state in {"signal_detected_but_ambiguous", "signal_unstable", "technology_candidate"}:
        return "Chip-Signal erkannt"
    if summary.detected_technology is not None:
        return f"Chip erkannt - {summary.detected_technology.technology_name}"
    if summary.discovery_data_status == "not captured":
        return "Discovery not captured"
    if summary.connected == "true":
        return "Proxmark connected"
    return "Session status unknown"


def _display_tag_type(tag_type: str) -> str:
    return {
        "hitag_s256": "Hitag S256",
        "hitag_s256_plain": "Hitag S256 Plain",
        "hitag_s_candidate": "Hitag S candidate",
        "hitag_candidate": "Hitag candidate",
        "mifare_classic": "MIFARE Classic",
        "iso14443a": "ISO14443A",
        "em410x": "EM410x",
        "indala": "Indala",
        "t5577": "T5577",
        "unknown_lf": "Unbekannter LF-Chip",
        "unknown_hf": "Unbekannter HF-Chip",
        "unknown": "unknown",
        "none": "none",
    }.get(tag_type, tag_type)


def _chip_read_view_model_from_adapter_result(detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadViewModel:
    adapter = adapter_for(detection)
    result = adapter.read_result(detection, raw_read)
    profile = result.template_payload if isinstance(result.template_payload, HitagS256Profile) else None
    fields = tuple(ChipFieldViewModel(field.label, field.value, field.note) for field in result.fields)
    memory_sections = tuple(ChipFieldViewModel(field.label, field.value, field.note) for field in result.memory_sections)
    public_configuration = tuple(ChipFieldViewModel(field.label, field.value, field.note) for field in result.public_configuration)
    title = _chip_read_title(detection, result)
    return ChipReadViewModel(
        status=result.status,
        title=title,
        message=result.message,
        fields=fields,
        memory_sections=memory_sections,
        public_configuration=public_configuration,
        warnings=result.warnings,
        next_step=result.next_step,
        read_status=result.read_status,
        support_level=result.support_level,
        profile=profile,
        raw_read=raw_read if isinstance(raw_read, HitagSRead) else None,
        public_raw_read=raw_read if not isinstance(raw_read, HitagSRead) else None,
        technology=detection,
        capabilities=result.capabilities,
    )


def _chip_read_title(detection: DetectedTechnology, result) -> str:
    if result.is_complete_template_read:
        return f"{detection.technology_name} erkannt"
    if result.read_status in {"identity_read", "public_details_read"}:
        return "Chip gelesen"
    return "Chip erkannt"


def _compact_display(value: str | None) -> str:
    if not value:
        return "unknown"
    return value.replace(" ", "").upper()


def _mode_label(ttf_mode: str | None) -> str:
    if not ttf_mode:
        return "unknown"
    if "disabled" in ttf_mode.lower() or "rtf" in ttf_mode.lower():
        return "RTF"
    return "TTF"


def _memory_ranges(pages: tuple[int, ...]) -> str:
    if not pages:
        return "keine"
    ordered = tuple(sorted(pages))
    if ordered == tuple(range(ordered[0], ordered[-1] + 1)):
        return f"{ordered[0]}-{ordered[-1]}"
    return ", ".join(str(page) for page in ordered)


def _lf_search_fields(lf_search) -> tuple[ChipFieldViewModel, ...]:
    if lf_search is None:
        return ()
    return tuple(
        ChipFieldViewModel(label, value)
        for label, value in (
            ("Bereich", "LF"),
            ("UID", lf_search.uid or "unknown"),
            ("Chiptyp", lf_search.tag_type or "unknown"),
            ("Chipset", lf_search.chipset or "unknown"),
        )
        if value != "unknown"
    )


def _unstable_signal_fields(result) -> tuple[ChipFieldViewModel, ...]:
    evidence = getattr(result, "scan_evidence", None)
    fields: list[ChipFieldViewModel] = [ChipFieldViewModel("Signal", "vorhanden")]
    if evidence and evidence.candidate:
        fields.append(ChipFieldViewModel("Bereich", evidence.candidate.frequency.upper()))
        fields.append(ChipFieldViewModel("Chipfamilie", "nicht stabil bestimmt"))
    elif getattr(result, "lf_search", None):
        fields.append(ChipFieldViewModel("Bereich", "LF"))
        fields.append(ChipFieldViewModel("Chipfamilie", "nicht stabil bestimmt"))
    return tuple(fields)


def _evidence_warning_labels(evidence) -> tuple[str, ...]:
    if evidence is None:
        return ()
    labels = {
        "false_positive": "False-Positive-Hinweis",
        "odd_size": "ungewoehnliche Bitgroesse",
        "unstable_raw": "wechselnde Raw-Werte",
        "unstable_bit_length": "wechselnde Bitlaenge",
        "signal_weak": "schwaches Signal",
    }
    return tuple(labels[warning] for warning in evidence.warnings if warning in labels)


def _profile_differences(first: HitagS256Profile, second: HitagS256Profile) -> tuple[tuple[str, str, str], ...]:
    differences: list[tuple[str, str, str]] = []
    if first.uid != second.uid:
        differences.append(("UID", first.uid, second.uid))
    pages = sorted(set(first.pages) | set(second.pages))
    for page in pages:
        if first.pages.get(page) != second.pages.get(page):
            differences.append((f"Block {page}", first.pages.get(page, "fehlt"), second.pages.get(page, "fehlt")))
    if first.ttf_data_rate != second.ttf_data_rate:
        differences.append(("Datenrate", first.ttf_data_rate, second.ttf_data_rate))
    return tuple(differences)


def _comparison_rows(
    current: HitagS256Profile,
    template: HitagS256Profile,
    incompatible: bool = False,
) -> tuple[ComparisonRowViewModel, ...]:
    chip_type_state: ValueState = "incompatible" if current.mode != template.mode else "same"
    config_state: ValueState
    if current.config_page() == template.config_page():
        config_state = "same"
    else:
        config_state = "incompatible" if incompatible else "config"
    rows = [
        ComparisonRowViewModel("Chiptyp", "Hitag S256", "Hitag S256", chip_type_state),
        ComparisonRowViewModel("UID", _compact_display(current.uid), _compact_display(template.uid), "uid", "UID ist nicht schreibbar"),
        ComparisonRowViewModel(
            "Config",
            _compact_display(current.config_page()),
            _compact_display(template.config_page()),
            config_state,
            "Konfiguration wird zuletzt behandelt",
        ),
    ]
    relevant_pages = tuple(page for page in sorted(set(current.writable_data_pages) | set(template.writable_data_pages)) if page in {4, 5, 6, 7})
    for page in relevant_pages:
        current_value = current.pages.get(page, "fehlt")
        template_value = template.pages.get(page, "fehlt")
        if current_value == template_value:
            state: ValueState = "same"
        else:
            state = "incompatible" if incompatible else "different"
        rows.append(ComparisonRowViewModel(f"Block {page}", _compact_display(current_value), _compact_display(template_value), state))
    return tuple(rows)


def _incompatible_reasons(current: HitagS256Profile, template: HitagS256Profile) -> tuple[str, ...]:
    reasons: list[str] = []
    if current.mode != template.mode:
        reasons.append("falscher Chiptyp oder Modus")
    missing_pages = [page for page in template.writable_data_pages if page not in current.pages]
    if missing_pages:
        reasons.append("falscher Speicherumfang")
    return tuple(reasons)


def _write_action_available(page: int, current: HitagS256Profile, template: HitagS256Profile) -> bool:
    return (
        page != 0
        and current.mode == template.mode
        and page in current.pages
        and page in template.pages
    )


def _write_action_block_reason(page: int, current: HitagS256Profile, template: HitagS256Profile) -> str:
    if _write_action_available(page, current, template):
        return ""
    if page == 0:
        return "UID ist nicht schreibbar"
    if current.mode != template.mode:
        return "falscher Chiptyp oder Modus"
    if page not in current.pages:
        return "Bereich wurde am aktuellen Chip nicht gelesen"
    if page not in template.pages:
        return "Zielwert fehlt"
    return "Bereich nicht freigegeben"


def _capability_cell(capabilities: TechnologyCapabilities, action: CapabilityAction) -> CapabilityCellViewModel:
    definition = capabilities.definition_for(action)
    return CapabilityCellViewModel(
        action=action,
        label=CAPABILITY_LABELS[action],
        state=definition.state,
        state_label=CAPABILITY_STATE_LABELS[definition.state],
        explanation=definition.explanation,
    )


def _tool_label(action: CapabilityAction) -> str:
    return {
        "detect": "Chip erkennen",
        "read_identity": "UID / Basisdaten lesen",
        "read_public_details": "Öffentliche Daten lesen",
        "read_memory": "Details lesen",
        "create_template": "Vorlage erstellen",
        "compare_template": "Vorlage vergleichen",
        "write_memory": "Speicher schreiben",
        "restore_memory": "Speicher wiederherstellen",
        "simulate": "Simulation vorbereiten",
        "emulate": "Emulation vorbereiten",
        "analyse_signal": "Signal analysieren",
        "open_graph": "Frequenzdiagramm öffnen",
    }[action]


def _parameter_hint(action: CapabilityAction) -> str:
    return {
        "detect": "Frequenz: Auto / LF / HF",
        "read_identity": "Read-Modus: öffentlich",
        "read_public_details": "Detailtiefe: öffentlich lesbar",
        "read_memory": "Bereich, bekannte Zugangsdaten falls nötig",
        "create_template": "Name, Beschreibung, Validierungsscan",
        "compare_template": "Vorlage oder Dump auswählen",
        "write_memory": "Speicherbereich, Zielwert, Vorher-/Nachher-Read",
        "restore_memory": "Backup/Dump auswählen, Vorher-Read erzwingen",
        "simulate": "Vorlage/Dump auswählen",
        "emulate": "Vorlage/Dump auswählen",
        "analyse_signal": "Antenne, Messdauer, Frequenzbereich",
        "open_graph": "LF/HF-Diagramm",
    }[action]


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
