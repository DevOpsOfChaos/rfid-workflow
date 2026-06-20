from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TechnologyCapabilities:
    can_detect: bool = True
    can_read_identity: bool = False
    can_read_details: bool = False
    can_create_template: bool = False
    can_compare_template: bool = False
    can_plan_write: bool = False
    can_write: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "can_detect": self.can_detect,
            "can_read_identity": self.can_read_identity,
            "can_read_details": self.can_read_details,
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
