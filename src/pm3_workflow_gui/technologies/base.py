from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


READ_STATUS_NO_CHIP = "no_chip"
READ_STATUS_DETECTED_ONLY = "detected_only"
READ_STATUS_IDENTITY_READ = "identity_read"
READ_STATUS_PUBLIC_DETAILS_READ = "public_details_read"
READ_STATUS_FULL_SUPPORTED_READ = "full_supported_read"
READ_STATUS_REQUIRES_AUTHORIZED_CREDENTIALS = "read_requires_authorized_credentials"
READ_STATUS_NOT_SUPPORTED_YET = "read_not_supported_yet"
READ_STATUS_SIGNAL_UNSTABLE = "signal_unstable"
READ_STATUS_DEVICE_LOST = "device_lost"

CapabilityAction = Literal[
    "detect",
    "read_identity",
    "read_public_details",
    "read_memory",
    "create_template",
    "compare_template",
    "write_memory",
    "restore_memory",
    "simulate",
    "emulate",
    "analyse_signal",
    "open_graph",
]
CapabilityState = Literal[
    "available",
    "unavailable",
    "requires_known_credentials",
    "hardware_locked",
    "not_implemented_yet",
]

CAPABILITY_ACTIONS: tuple[CapabilityAction, ...] = (
    "detect",
    "read_identity",
    "read_public_details",
    "read_memory",
    "create_template",
    "compare_template",
    "write_memory",
    "restore_memory",
    "simulate",
    "emulate",
    "analyse_signal",
    "open_graph",
)

CAPABILITY_LABELS: dict[CapabilityAction, str] = {
    "detect": "Erkennen",
    "read_identity": "Basisdaten",
    "read_public_details": "Öffentliche Details",
    "read_memory": "Detailread",
    "create_template": "Vorlage",
    "compare_template": "Vergleichen",
    "write_memory": "Schreiben",
    "restore_memory": "Restore",
    "simulate": "Simulation",
    "emulate": "Emulation",
    "analyse_signal": "Analyse",
    "open_graph": "Signalgraph",
}

CAPABILITY_STATE_LABELS: dict[CapabilityState, str] = {
    "available": "verfügbar",
    "unavailable": "nicht verfügbar",
    "requires_known_credentials": "benötigt bekannte Zugangsdaten",
    "hardware_locked": "hardwareseitig nicht schreibbar",
    "not_implemented_yet": "noch nicht implementiert",
}


@dataclass(frozen=True)
class CapabilityDefinition:
    action: CapabilityAction
    state: CapabilityState
    explanation: str = ""

    @property
    def label(self) -> str:
        return CAPABILITY_LABELS[self.action]

    @property
    def state_label(self) -> str:
        return CAPABILITY_STATE_LABELS[self.state]


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
    actions: tuple[CapabilityDefinition, ...] = ()

    def __post_init__(self) -> None:
        if self.actions:
            return
        defaults = (
            CapabilityDefinition("detect", "available" if self.can_detect else "unavailable"),
            CapabilityDefinition("read_identity", "available" if self.can_read_identity else "unavailable"),
            CapabilityDefinition("read_public_details", "available" if self.can_read_public_details else "unavailable"),
            CapabilityDefinition("read_memory", "available" if self.can_read_memory else "not_implemented_yet"),
            CapabilityDefinition("create_template", "available" if self.can_create_template else "not_implemented_yet"),
            CapabilityDefinition("compare_template", "available" if self.can_compare_template else "not_implemented_yet"),
            CapabilityDefinition("write_memory", "available" if self.can_write else "not_implemented_yet"),
            CapabilityDefinition("restore_memory", "not_implemented_yet"),
            CapabilityDefinition("simulate", "not_implemented_yet"),
            CapabilityDefinition("emulate", "not_implemented_yet"),
            CapabilityDefinition("analyse_signal", "available"),
            CapabilityDefinition("open_graph", "available"),
        )
        object.__setattr__(self, "actions", defaults)

    def state_for(self, action: CapabilityAction) -> CapabilityState:
        for item in self.actions:
            if item.action == action:
                return item.state
        return "unavailable"

    def explanation_for(self, action: CapabilityAction) -> str:
        for item in self.actions:
            if item.action == action:
                return item.explanation
        return ""

    def definition_for(self, action: CapabilityAction) -> CapabilityDefinition:
        for item in self.actions:
            if item.action == action:
                return item
        return CapabilityDefinition(action, "unavailable")

    def registered_actions(self) -> tuple[CapabilityDefinition, ...]:
        return tuple(item for item in self.actions if item.state != "unavailable")

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

    def state_dict(self) -> dict[str, str]:
        return {item.action: item.state for item in self.actions}


@dataclass(frozen=True)
class WriteOperation:
    label: str
    target: str
    old_value: str
    new_value: str
    capability_state: CapabilityState = "available"


@dataclass(frozen=True)
class VerifyOperation:
    label: str
    target: str
    expected_value: str


@dataclass(frozen=True)
class RestoreOperation:
    label: str
    source: str
    capability_state: CapabilityState = "not_implemented_yet"


@dataclass(frozen=True)
class SimulationOperation:
    label: str
    source: str
    capability_state: CapabilityState = "not_implemented_yet"


@dataclass(frozen=True)
class TechnologyWritePlan:
    technology_id: str
    before_read_required: bool
    operations: tuple[WriteOperation, ...]
    verify_operations: tuple[VerifyOperation, ...]
    restore_operations: tuple[RestoreOperation, ...] = ()
    simulation_operations: tuple[SimulationOperation, ...] = ()


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
