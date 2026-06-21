from __future__ import annotations

from pm3_workflow_gui.pm3.parsers import IndalaReadResult
from pm3_workflow_gui.technologies.base import (
    ChipField,
    ChipReadResult,
    DetectedTechnology,
    READ_STATUS_IDENTITY_READ,
    READ_STATUS_SIGNAL_UNSTABLE,
    TechnologyCapabilities,
)


class IndalaAdapter:
    technology_id = "indala"
    display_name = "Indala"
    adapter_version = "1.0"
    capabilities = TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_public_details=True,
        can_read_memory=False,
        can_create_template=False,
        can_compare_template=False,
        can_plan_write=False,
        can_write=False,
    )

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        indala = raw_read if isinstance(raw_read, IndalaReadResult) else None
        read_status = detection.read_status
        if indala and indala.has_identity and read_status != READ_STATUS_SIGNAL_UNSTABLE:
            read_status = READ_STATUS_IDENTITY_READ

        fields = [
            ChipField("Technologie", detection.technology_name),
            ChipField("Frequenz", "LF"),
            ChipField("Chipset", detection.chipset or "Indala"),
            ChipField("Read-Status", _status_label(read_status)),
        ]
        identity = _identity_value(detection, indala)
        if identity:
            if read_status == READ_STATUS_SIGNAL_UNSTABLE:
                fields.append(ChipField("Raw-Leseprobe", identity, "Nicht als stabile ID verwenden"))
            else:
                fields.append(ChipField("ID", identity, "Raw Indala ID aus PM3-Reader"))
        if indala and indala.bit_length is not None:
            fields.append(ChipField("Bitlaenge", str(indala.bit_length)))

        public_configuration = [
            ChipField("Familie", "Indala"),
            ChipField("Read-only Befehl", "lf indala reader"),
        ]
        warnings = []
        if indala and indala.false_positive_note:
            warnings.append(indala.false_positive_note)
        if read_status == READ_STATUS_SIGNAL_UNSTABLE:
            warnings.append("Indala-Raw-Werte waren zwischen mehreren Read-only-Leseproben nicht stabil.")

        return ChipReadResult(
            status=read_status,
            technology=detection,
            capabilities=self.capabilities,
            message=_message(read_status),
            fields=tuple(fields),
            public_configuration=tuple(public_configuration),
            warnings=tuple(warnings),
            next_step=_next_step(read_status),
            read_status=read_status,
            support_level="identity_read" if read_status == READ_STATUS_IDENTITY_READ else "public_details",
            raw_read=raw_read,
        )


def indala_detection(
    raw_id: str | None = None,
    bit_length: int | None = None,
    confidence: str = "medium",
    read_status: str = READ_STATUS_IDENTITY_READ,
) -> DetectedTechnology:
    return DetectedTechnology(
        technology_id="indala",
        technology_name="Indala",
        frequency="lf",
        technology_family="indala",
        chipset=f"Indala ({bit_length} bit)" if bit_length else "Indala",
        uid=raw_id,
        confidence=confidence,
        support_level="identity_read" if raw_id else "public_details",
        source="lf_indala_reader" if raw_id else "lf_search",
        read_status=read_status,
    )


def _identity_value(detection: DetectedTechnology, indala: IndalaReadResult | None) -> str | None:
    if indala and indala.raw_id:
        return indala.raw_id
    return detection.uid


def _message(read_status: str) -> str:
    if read_status == READ_STATUS_SIGNAL_UNSTABLE:
        return "Chip erkannt, aber Details konnten nicht stabil gelesen werden. Bitte Chip leicht verschieben und erneut scannen."
    return "Chip gelesen. Indala-ID und oeffentliche Basisdaten wurden gelesen; ein Speicher-Template wird fuer diesen Chiptyp nicht erstellt."


def _next_step(read_status: str) -> str:
    if read_status == READ_STATUS_SIGNAL_UNSTABLE:
        return "Chip leicht verschieben und erneut scannen."
    return "ID dokumentieren; keine Schreib- oder Emulationsaktion ausfuehren."


def _status_label(read_status: str) -> str:
    return {
        READ_STATUS_IDENTITY_READ: "Identitaet gelesen",
        READ_STATUS_SIGNAL_UNSTABLE: "Signal instabil",
    }.get(read_status, read_status)
