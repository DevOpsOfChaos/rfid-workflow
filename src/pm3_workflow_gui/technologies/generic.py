from __future__ import annotations

from pm3_workflow_gui.technologies.base import (
    ChipField,
    ChipReadResult,
    DetectedTechnology,
    TechnologyCapabilities,
)


class GenericDetectedChipAdapter:
    technology_id = "generic_detected"
    display_name = "Erkannter Chip"
    adapter_version = "1.0"
    capabilities = TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_details=False,
        can_create_template=False,
        can_compare_template=False,
        can_plan_write=False,
        can_write=False,
    )

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        fields = [
            ChipField("Technologie", detection.technology_name),
            ChipField("Frequenz", detection.frequency.upper() if detection.frequency != "unknown" else "unknown"),
            ChipField("Unterstützungsgrad", "Basis-Erkennung"),
            ChipField("Confidence", detection.confidence),
        ]
        if detection.uid:
            fields.append(ChipField("UID", detection.uid))
        if detection.chipset:
            fields.append(ChipField("Chipset", detection.chipset))
        return ChipReadResult(
            status="basic_detection",
            technology=detection,
            capabilities=self.capabilities,
            message=(
                "Diese Version kann diesen Chiptyp erkennen. "
                "Vollständiges Lesen und Vorlagen-Erstellung sind noch nicht verfügbar."
            ),
            fields=tuple(fields),
            raw_read=raw_read,
        )
