from __future__ import annotations

from dataclasses import replace

from pm3_workflow_gui.technologies.base import (
    CapabilityDefinition,
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
        actions=(
            CapabilityDefinition("detect", "available", "HF/LF-Suche erkennt Chipfamilie oder Kandidat."),
            CapabilityDefinition("read_identity", "available", "UID oder öffentliche ID wird gelesen, sofern PM3 sie meldet."),
            CapabilityDefinition("read_public_details", "available", "Öffentliche Basisdaten werden angezeigt."),
            CapabilityDefinition("read_memory", "not_implemented_yet", "Für diesen Chiptyp wurde noch kein Detail-Adapter implementiert."),
            CapabilityDefinition("create_template", "not_implemented_yet", "Vorlagen benötigen einen vollständigen technologiebezogenen Read."),
            CapabilityDefinition("compare_template", "not_implemented_yet", "Vergleich benötigt ein technologiebezogenes Datenmodell."),
            CapabilityDefinition("write_memory", "not_implemented_yet", "Kein Schreibadapter für diesen Chiptyp implementiert."),
            CapabilityDefinition("restore_memory", "not_implemented_yet", "Kein Restore-Adapter für diesen Chiptyp implementiert."),
            CapabilityDefinition("simulate", "not_implemented_yet", "Keine Simulation für diesen Chiptyp implementiert."),
            CapabilityDefinition("emulate", "not_implemented_yet", "Keine Emulation für diesen Chiptyp implementiert."),
            CapabilityDefinition("analyse_signal", "available", "Signal- und Erkennungsdaten können geprüft werden."),
            CapabilityDefinition("open_graph", "available", "Frequenzdiagramm kann geöffnet werden, wenn lokal verfügbar."),
        ),
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
            "Ein vollständiger Speicher-Read benötigt bekannte Zugangsdaten."
        )
    if detection.technology_id == "em410x":
        return "EM410x erkannt. Karten-ID gelesen. Für diesen Chiptyp ist kein zusätzlicher Speicherbereich vorhanden."
    if detection.technology_id == "indala":
        return "Indala erkannt. Öffentliche Basisdaten wurden gelesen; schreibbare Speicherbereiche meldet dieser Adapter nicht."
    if detection.technology_id == "t5577":
        return "T55xx/T5577 erkannt. Öffentliche Basisinformationen wurden gelesen; technologieabhängige Schreibfunktionen benötigen einen konkreten Adapter."
    if detection.technology_id == "iso14443a":
        return "ISO14443A erkannt. Öffentliche Basisinformationen wurden gelesen."
    if read_status == READ_STATUS_NOT_SUPPORTED_YET:
        return "Chipfamilie erkannt, aber noch kein Detail-Adapter vorhanden."
    return "Chip erkannt und Basisdaten gelesen. Ein vollständiger Template-Adapter ist noch nicht verfügbar."


def _next_step(detection: DetectedTechnology, read_status: str) -> str:
    if read_status == READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS:
        return "Bekannte Zugangsdaten verwalten; Detailread danach gezielt starten."
    if detection.technology_id == "em410x":
        return "ID kann dokumentiert werden; kein vollständiger Vorlagen-Read für diesen Chiptyp."
    if detection.technology_id == "indala":
        return "ID dokumentieren; kein vollständiger Vorlagen-Read für diesen Chiptyp."
    return "Analyse öffnen; dieser Chiptyp liefert keinen vollständigen Vorlagen-Read."


def _warnings(detection: DetectedTechnology) -> tuple[str, ...]:
    warnings: list[str] = []
    if detection.confidence == "low":
        warnings.append("Erkennung ist unsicher; Chipposition prüfen und erneut scannen.")
    if detection.technology_id == "mifare_classic":
        warnings.append("Keys werden nicht in normalen Statusmeldungen ausgegeben.")
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


class CatalogTechnologyAdapter:
    adapter_version = "1.0"

    def __init__(self, technology_id: str, display_name: str, capabilities: TechnologyCapabilities) -> None:
        self.technology_id = technology_id
        self.display_name = display_name
        self.capabilities = capabilities

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        result = GenericDetectedChipAdapter().read_result(detection, raw_read)
        return replace(result, capabilities=self.capabilities)


MIFARE_CLASSIC_ADAPTER = CatalogTechnologyAdapter(
    "mifare_classic",
    "MIFARE Classic",
    TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_public_details=True,
        can_read_memory=False,
        can_create_template=False,
        can_compare_template=False,
        can_plan_write=False,
        can_write=False,
        actions=(
            CapabilityDefinition("detect", "available", "ISO14443A/MIFARE-Erkennung über hf search."),
            CapabilityDefinition("read_identity", "available", "UID und Kartentyp sind öffentlich lesbar."),
            CapabilityDefinition("read_public_details", "available", "Öffentliche Kartendaten werden angezeigt."),
            CapabilityDefinition("read_memory", "requires_known_credentials", "Vollständiger Speicherread benötigt bekannte Zugangsdaten."),
            CapabilityDefinition("create_template", "requires_known_credentials", "Vorlage benötigt einen vollständigen Read mit bekannten Zugangsdaten."),
            CapabilityDefinition("compare_template", "requires_known_credentials", "Vergleich benötigt gelesene Sektordaten."),
            CapabilityDefinition("write_memory", "requires_known_credentials", "Schreiben benötigt bekannte Zugangsdaten und einen konkreten Adapter."),
            CapabilityDefinition("restore_memory", "requires_known_credentials", "Restore benötigt bekannte Zugangsdaten und Vorher-Read."),
            CapabilityDefinition("simulate", "not_implemented_yet", "Noch kein strukturierter Simulationsadapter implementiert."),
            CapabilityDefinition("emulate", "not_implemented_yet", "Noch kein strukturierter Emulationsadapter implementiert."),
            CapabilityDefinition("analyse_signal", "available", "HF-Signal und Erkennung können analysiert werden."),
            CapabilityDefinition("open_graph", "available", "Frequenzdiagramm kann geöffnet werden, wenn lokal verfügbar."),
        ),
    ),
)

EM410X_ADAPTER = CatalogTechnologyAdapter(
    "em410x",
    "EM410x",
    TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_public_details=True,
        can_read_memory=False,
        actions=(
            CapabilityDefinition("detect", "available", "LF-Suche erkennt EM410x."),
            CapabilityDefinition("read_identity", "available", "Karten-ID ist öffentlich lesbar."),
            CapabilityDefinition("read_public_details", "available", "Öffentliche Basisdaten werden angezeigt."),
            CapabilityDefinition("read_memory", "unavailable", "EM410x stellt keinen frei adressierbaren Speicher bereit."),
            CapabilityDefinition("create_template", "not_implemented_yet", "ID-Vorlagenmodell noch nicht implementiert."),
            CapabilityDefinition("compare_template", "not_implemented_yet", "ID-Vergleich noch nicht als Vorlage implementiert."),
            CapabilityDefinition("write_memory", "unavailable", "Originaler EM410x ist nicht beschreibbar."),
            CapabilityDefinition("restore_memory", "unavailable", "Kein Speicherrestore für EM410x."),
            CapabilityDefinition("simulate", "not_implemented_yet", "Simulation noch nicht implementiert."),
            CapabilityDefinition("emulate", "not_implemented_yet", "Emulation noch nicht implementiert."),
            CapabilityDefinition("analyse_signal", "available", "LF-Signal kann analysiert werden."),
            CapabilityDefinition("open_graph", "available", "Frequenzdiagramm kann geöffnet werden, wenn lokal verfügbar."),
        ),
    ),
)

T5577_ADAPTER = CatalogTechnologyAdapter(
    "t5577",
    "T5577",
    TechnologyCapabilities(
        can_detect=True,
        can_read_identity=True,
        can_read_public_details=True,
        can_read_memory=True,
        can_create_template=True,
        actions=(
            CapabilityDefinition("detect", "available", "LF-Suche erkennt T55xx/T5577-Kandidaten."),
            CapabilityDefinition("read_identity", "available", "Öffentliche ID oder Modusdaten werden gelesen, wenn vorhanden."),
            CapabilityDefinition("read_public_details", "available", "Öffentliche Konfiguration ist technologieabhängig lesbar."),
            CapabilityDefinition("read_memory", "available", "Öffentliche Speicherbereiche sind lesbar."),
            CapabilityDefinition("create_template", "available", "Vorlage aus gelesenen öffentlichen Daten möglich."),
            CapabilityDefinition("compare_template", "available", "Vergleich gegen gelesene öffentliche Daten möglich."),
            CapabilityDefinition("write_memory", "not_implemented_yet", "Schreibadapter noch nicht implementiert."),
            CapabilityDefinition("restore_memory", "not_implemented_yet", "Restore-Adapter noch nicht implementiert."),
            CapabilityDefinition("simulate", "not_implemented_yet", "Simulation noch nicht implementiert."),
            CapabilityDefinition("emulate", "not_implemented_yet", "Emulation noch nicht implementiert."),
            CapabilityDefinition("analyse_signal", "available", "LF-Signal kann analysiert werden."),
            CapabilityDefinition("open_graph", "available", "Frequenzdiagramm kann geöffnet werden, wenn lokal verfügbar."),
        ),
    ),
)

UNKNOWN_LF_HF_ADAPTER = CatalogTechnologyAdapter(
    "unknown_lf_hf",
    "Unbekannt LF/HF",
    TechnologyCapabilities(
        can_detect=True,
        actions=(
            CapabilityDefinition("detect", "available", "HF/LF-Suche kann unbekannte Signale melden."),
            CapabilityDefinition("read_identity", "unavailable", "Keine stabile Identität verfügbar."),
            CapabilityDefinition("read_public_details", "unavailable", "Keine stabile öffentliche Detailstruktur verfügbar."),
            CapabilityDefinition("read_memory", "not_implemented_yet", "Für diesen Chiptyp wurde noch kein Adapter implementiert."),
            CapabilityDefinition("create_template", "unavailable", "Vorlage benötigt einen vollständigen Read."),
            CapabilityDefinition("compare_template", "unavailable", "Vergleich benötigt ein technologiebezogenes Datenmodell."),
            CapabilityDefinition("write_memory", "unavailable", "Kein Schreibziel ohne konkrete Technologie."),
            CapabilityDefinition("restore_memory", "unavailable", "Kein Restore ohne konkrete Technologie."),
            CapabilityDefinition("simulate", "unavailable", "Keine Simulation ohne konkrete Technologie."),
            CapabilityDefinition("emulate", "unavailable", "Keine Emulation ohne konkrete Technologie."),
            CapabilityDefinition("analyse_signal", "available", "Signal kann analysiert werden."),
            CapabilityDefinition("open_graph", "available", "Frequenzdiagramm kann geöffnet werden, wenn lokal verfügbar."),
        ),
    ),
)
