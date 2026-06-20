from __future__ import annotations

from pm3_workflow_gui.pm3.parsers import HitagSRead
from pm3_workflow_gui.technologies.base import (
    ChipField,
    ChipReadResult,
    DetectedTechnology,
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
        can_read_details=True,
        can_create_template=True,
        can_compare_template=True,
        can_plan_write=True,
        can_write=False,
    )

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        if not isinstance(raw_read, HitagSRead) or not raw_read.is_hitag_s256_plain_no_auth:
            return ChipReadResult(
                status="retry",
                technology=detection,
                capabilities=self.capabilities,
                message="Chip erkannt, aber Signal ist zu schwach für einen stabilen Detail-Read. Bitte Position leicht verändern und erneut scannen.",
                raw_read=raw_read,
            )
        profile = profile_from_hitag_s_read(raw_read)
        fields = (
            ChipField("Chiptyp", "Hitag S256"),
            ChipField("Bereich", "LF"),
            ChipField("UID", _compact_display(raw_read.uid), "Nur Referenz · nicht schreibbar"),
            ChipField("Config", _compact_display(raw_read.config_page)),
            ChipField("Datenrate", raw_read.ttf_data_rate or "unknown"),
            ChipField("TTF-Modus", _mode_label(raw_read.ttf_mode)),
            ChipField("Blöcke 4-7", _memory_ranges(profile.writable_data_pages)),
        )
        return ChipReadResult(
            status="complete",
            technology=detection,
            capabilities=self.capabilities,
            message="Bitte denselben Chip erneut scannen, um die Werte zu bestätigen.",
            fields=fields,
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
        support_level="full_readonly",
        source="hitag_rdbl",
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
