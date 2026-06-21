from __future__ import annotations

from pm3_workflow_gui.technologies.base import (
    ChipField,
    ChipReadResult,
    DetectedTechnology,
    READ_STATUS_DETECTED_ONLY,
    READ_STATUS_IDENTITY_READ,
    READ_STATUS_PUBLIC_DETAILS_READ,
    READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS,
    READ_STATUS_NOT_SUPPORTED_YET,
    TechnologyCapabilities,
)


class GenericDetectedChipAdapter:
    technology_id = "generic_detected"
    display_name = "Erkannter Chip"
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
        read_status = _read_status(detection)
        fields = [
            ChipField("Technologie", detection.technology_name),
            ChipField("Frequenz", detection.frequency.upper() if detection.frequency != "unknown" else "unknown"),
            ChipField("Read-Status", _status_label(read_status)),
            ChipField("Unterstützungsgrad", _support_label(detection)),
            ChipField("Confidence", detection.confidence),
        ]
        if detection.uid:
            identity_label = "ID" if detection.technology_id == "em410x" else "UID"
            fields.append(ChipField(identity_label, detection.uid))
        if detection.chipset:
            fields.append(ChipField("Chipset", detection.chipset))
        public_configuration = _public_configuration(detection)
        return ChipReadResult(
            status=read_status,
            technology=detection,
            capabilities=self.capabilities,
            message=_message(detection, read_status),
            fields=tuple(fields),
            public_configuration=public_configuration,
            warnings=_warnings(detection),
            next_step=_next_step(detection, read_status),
            read_status=read_status,
            support_level=detection.support_level,
            raw_read=raw_read,
        )


def _read_status(detection: DetectedTechnology) -> str:
    if detection.technology_id == "mifare_classic":
        return READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS
    if detection.uid:
        return READ_STATUS_IDENTITY_READ
    if detection.chipset or detection.technology_id in {"t5577", "iso14443a"}:
        return READ_STATUS_PUBLIC_DETAILS_READ
    if detection.technology_id in {"unknown_lf", "unknown_hf"}:
        return READ_STATUS_NOT_SUPPORTED_YET
    return READ_STATUS_DETECTED_ONLY


def _message(detection: DetectedTechnology, read_status: str) -> str:
    if detection.technology_id == "mifare_classic":
        return (
            "MIFARE Classic erkannt. UID und Kartentyp wurden gelesen. "
            "Ein vollständiger Speicher-Read benötigt berechtigte Schlüssel und wird nicht automatisch versucht."
        )
    if detection.technology_id == "em410x":
        return "EM410x erkannt. Karten-ID gelesen. Für diesen Chiptyp ist kein zusätzlicher Speicherbereich vorhanden."
    if detection.technology_id == "indala":
        return "Indala erkannt. Öffentliche Basisdaten wurden gelesen; Schreiben und Emulation sind nicht verfügbar."
    if detection.technology_id == "t5577":
        return "T55xx/T5577 erkannt. Öffentliche Basisinformationen wurden gelesen; Schreiben ist nicht freigeschaltet."
    if detection.technology_id == "iso14443a":
        return "ISO14443A erkannt. Öffentliche Basisinformationen wurden gelesen."
    if read_status == READ_STATUS_NOT_SUPPORTED_YET:
        return "Chipfamilie erkannt, aber noch kein sicherer Detail-Adapter vorhanden."
    return "Chip erkannt und Basisdaten gelesen. Ein vollständiger Template-Adapter ist noch nicht verfügbar."


def _next_step(detection: DetectedTechnology, read_status: str) -> str:
    if read_status == READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS:
        return "Nur berechtigte Schlüssel manuell verwalten; kein automatischer Speicher-Read."
    if detection.technology_id == "em410x":
        return "ID kann dokumentiert werden; keine Template-Erstellung in V1."
    if detection.technology_id == "indala":
        return "ID dokumentieren; keine Template-Erstellung in V1."
    return "Analyse öffnen; Detailread und Vorlagen-Workflow sind für diesen Chiptyp noch nicht verfügbar."


def _warnings(detection: DetectedTechnology) -> tuple[str, ...]:
    warnings: list[str] = []
    if detection.confidence == "low":
        warnings.append("Erkennung ist unsicher; Chipposition prüfen und erneut scannen.")
    if detection.technology_id == "mifare_classic":
        warnings.append("Kein Key-Test, keine Wörterlisten und keine Recovery-Aktion werden ausgeführt.")
    return tuple(warnings)


def _public_configuration(detection: DetectedTechnology) -> tuple[ChipField, ...]:
    fields: list[ChipField] = []
    if detection.technology_family:
        fields.append(ChipField("Familie", detection.technology_family))
    if detection.source:
        fields.append(ChipField("Quelle", detection.source))
    return tuple(fields)


def _support_label(detection: DetectedTechnology) -> str:
    return {
        "basic_detection": "Basisdaten",
        "identity": "Identität",
        "public_details": "Öffentliche Details",
    }.get(detection.support_level, detection.support_level)


def _status_label(read_status: str) -> str:
    return {
        READ_STATUS_DETECTED_ONLY: "Nur erkannt",
        READ_STATUS_IDENTITY_READ: "Identität gelesen",
        READ_STATUS_PUBLIC_DETAILS_READ: "Öffentliche Details gelesen",
        READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS: "Berechtigte Zugangsdaten erforderlich",
        READ_STATUS_NOT_SUPPORTED_YET: "Detail-Adapter fehlt",
    }.get(read_status, read_status)
