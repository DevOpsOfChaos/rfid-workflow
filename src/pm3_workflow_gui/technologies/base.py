from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


READ_STATUS_NO_CHIP = "no_chip"
READ_STATUS_DETECTED_ONLY = "detected_only"
READ_STATUS_IDENTITY_READ = "identity_read"
READ_STATUS_PUBLIC_DETAILS_READ = "public_details_read"
READ_STATUS_FULL_SUPPORTED_READ = "full_supported_read"
READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS = "read_requires_authorized_credentials"
READ_STATUS_NOT_SUPPORTED_YET = "read_not_supported_yet"
READ_STATUS_SIGNAL_UNSTABLE = "signal_unstable"
READ_STATUS_DEVICE_LOST = "device_lost"


@dataclass(frozen=True)
class TechnologyCapabilities:
    can_detect: bool = True
    can_read_identity: bool = False
    can_read_public_details: bool = False
    can_read_memory: bool = False
    can_create_template: bool = False
    can_compare_template: bool = False
    can_plan_write: bool = False
    can_write: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "can_detect": self.can_detect,
            "can_read_identity": self.can_read_identity,
            "can_read_public_details": self.can_read_public_details,
            "can_read_memory": self.can_read_memory,
            "can_read_details": self.can_read_public_details or self.can_read_memory,
            "can_create_template": self.can_create_template,
            "can_compare_template": self.can_compare_template,
            "can_plan_write": self.can_plan_write,
            "can_write": self.can_write,
        }


@dataclass(frozen=True)
class DetectedTechnology:
    technology_id: str
    technology_name: str
    frequency: str
    technology_family: str
    chipset: str | None = None
    uid: str | None = None
    confidence: str = "low"
    support_level: str = "basic_detection"
    source: str = "search"
    status: str = "detected"
    read_status: str = READ_STATUS_DETECTED_ONLY


@dataclass(frozen=True)
class ChipField:
    label: str
    value: str
    note: str = ""


@dataclass(frozen=True)
class ChipReadResult:
    status: str
    technology: DetectedTechnology | None
    capabilities: TechnologyCapabilities
    message: str
    fields: tuple[ChipField, ...] = ()
    memory_sections: tuple[ChipField, ...] = ()
    public_configuration: tuple[ChipField, ...] = ()
    warnings: tuple[str, ...] = ()
    next_step: str = ""
    read_status: str = READ_STATUS_DETECTED_ONLY
    support_level: str = "basic_detection"
    raw_read: object | None = None
    template_payload: object | None = None

    @property
    def is_complete_template_read(self) -> bool:
        return self.template_payload is not None and self.capabilities.can_create_template


@dataclass(frozen=True)
class TemplateCompatibilityResult:
    compatible: bool
    message: str
    rows: tuple[tuple[str, str, str, str], ...] = ()
    plan_steps: tuple[str, ...] = ()


class TechnologyAdapter(Protocol):
    technology_id: str
    display_name: str
    adapter_version: str
    capabilities: TechnologyCapabilities

    def read_result(self, detection: DetectedTechnology, raw_read: object | None = None) -> ChipReadResult:
        ...
