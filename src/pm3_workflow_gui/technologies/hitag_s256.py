from __future__ import annotations

from pm3_workflow_gui.pm3.parsers import HitagSRead
from pm3_workflow_gui.technologies.base import (
    CapabilityDefinition,
    ChipField,
    ChipReadResult,
    DetectedTechnology,
    READ_STATUS_FULL_SUPPORTED_READ,
    READ_STATUS_SIGNAL_UNSTABLE,
    TechnologyCapabilities,
)
from pm3_workflow_gui.workflows.hitag_s256 import profile_from_hitag_s_read


class HitagS256Adapter:
    technology_id = "hitag_s256"
    display_name = "Hitag S256"
    adapter_version = "1.0"
    capabilities = TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_public_details=True,
        can_read_memory=True,
        can_create_template=True,
        can_compare_template=True,
        can_plan_write=True,
        can_write=True,
        actions=(
            CapabilityDefinition("detect", "available", "PM3-Erkennung über lf search und Hitag-Detailread."),
            CapabilityDefinition("read_identity", "available", "UID Page 0 wird gelesen."),
            CapabilityDefinition("read_public_details", "available", "Konfiguration und TTF-Modus werden gelesen."),
            CapabilityDefinition("read_memory", "available", "Pages 0-7 werden über lf hitag hts rdbl gelesen."),
            CapabilityDefinition("create_template", "available", "Vorlage aus bestätigtem vollständigem Read."),
            CapabilityDefinition("compare_template", "available", "Vergleich gegen gespeicherte Vorlage."),
            CapabilityDefinition("write_memory", "available", "Pages 4-7 und Config Page 1 sind geplant und werden danach verifiziert."),
            CapabilityDefinition("restore_memory", "available", "Restore ist als strukturierter Vorgang vorgesehen; Vorher-Read und Verifikation bleiben Pflicht."),
            CapabilityDefinition("simulate", "available", "Simulation wird aus gelesenen Daten vorbereitet."),
            CapabilityDefinition("emulate", "available", "Emulation wird aus gelesenen Daten vorbereitet."),
            CapabilityDefinition("analyse_signal", "available", "Signal und Reader-Stabilität können analysiert werden."),
            CapabilityDefinition("open_graph", "available", "LF-Frequenzdiagramm kann geöffnet werden."),
        ),
    )

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        if not isinstance(raw_read, HitagSRead) or not raw_read.is_hitag_s256_plain_no_auth:
            return ChipReadResult(
                status=READ_STATUS_SIGNAL_UNSTABLE,
                technology=detection,
                capabilities=self.capabilities,
                message="Chip erkannt, aber Signal ist zu schwach für einen stabilen Detail-Read. Bitte Position leicht verändern und erneut scannen.",
                read_status=READ_STATUS_SIGNAL_UNSTABLE,
                support_level="full_supported_read",
                next_step="Chip leicht verschieben und erneut scannen.",
                raw_read=raw_read,
            )
        profile = profile_from_hitag_s_read(raw_read)
        identity_fields = (
            ChipField("Chiptyp", "Hitag S256"),
            ChipField("Bereich", "LF"),
            ChipField("UID", _compact_display(raw_read.uid), "Referenz · hardwareseitig nicht schreibbar"),
            ChipField("Config", _compact_display(raw_read.config_page)),
            ChipField("Datenrate", raw_read.ttf_data_rate or "unknown"),
            ChipField("TTF-Modus", _mode_label(raw_read.ttf_mode)),
            ChipField("Pages 0-7", "vollständig" if profile.is_complete_snapshot else f"unvollständig; fehlt {_memory_ranges(profile.missing_expected_pages)}"),
        )
        memory_fields = tuple(
            ChipField(
                f"Page {page}",
                _compact_display(profile.pages[page]),
                "UID / Referenz" if page == 0 else "Konfiguration" if page == 1 else "lesbar und vergleichbar" if page in {2, 3} else "Datenbereich",
            )
            for page in sorted(profile.pages)
            if page in set(range(8))
        )
        public_configuration = (
            ChipField("Config Page 1", _compact_display(profile.config_page()), "Konfiguration · zuletzt schreiben"),
        )
        return ChipReadResult(
            status=READ_STATUS_FULL_SUPPORTED_READ,
            technology=detection,
            capabilities=self.capabilities,
            message="Bitte denselben Chip erneut scannen, um die Werte zu bestätigen.",
            fields=identity_fields,
            memory_sections=memory_fields,
            public_configuration=public_configuration,
            warnings=tuple(
                warning
                for warning in (
                    "UID Page 0 wird nie geschrieben.",
                    None if profile.is_complete_snapshot else "Unvollständiger Hitag-S256-Read: nicht als Full-Profile-Vorlage verwendbar.",
                )
                if warning
            ),
            next_step="Zweiten Scan durchführen oder als Zielchip read-only vergleichen.",
            read_status=READ_STATUS_FULL_SUPPORTED_READ,
            support_level="full_supported_read",
            raw_read=raw_read,
            template_payload=profile,
        )


def hitag_s256_detection(uid: str | None = None, confidence: str = "high") -> DetectedTechnology:
    return DetectedTechnology(
        technology_id="hitag_s256",
        technology_name="Hitag S256",
        frequency="lf",
        technology_family="hitag_s",
        chipset="Hitag S 256",
        uid=uid,
        confidence=confidence,
        support_level="full_supported_read",
        source="hitag_rdbl",
        read_status=READ_STATUS_FULL_SUPPORTED_READ,
    )


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
