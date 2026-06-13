from __future__ import annotations

from dataclasses import dataclass

from pm3_workflow_gui.pm3.risk import RiskLevel
from pm3_workflow_gui.profiles.schema import HitagS256Profile


@dataclass(frozen=True)
class WorkflowStep:
    label: str
    command_template: str | None
    risk: RiskLevel
    requires_manual_approval: bool = False


def build_safe_write_plan(profile: HitagS256Profile) -> list[WorkflowStep]:
    """Return a gated plan; execution belongs in the future workflow runner."""
    steps = [
        WorkflowStep("Read profile from source tag", "lf hitag hts dump", RiskLevel.READ_ONLY),
        WorkflowStep("Validate target blank compatibility", "lf hitag hts dump", RiskLevel.READ_ONLY),
    ]
    for page in profile.writable_data_pages:
        steps.append(
            WorkflowStep(
                f"Write data page {page}",
                f"lf hitag hts wrbl --page {page} --data {profile.pages[page]}",
                RiskLevel.WRITE,
                requires_manual_approval=True,
            )
        )
        steps.append(WorkflowStep(f"Verify data page {page}", f"lf hitag hts rdbl --page {page}", RiskLevel.READ_ONLY))
    if profile.config_page() is not None:
        steps.append(
            WorkflowStep(
                "Write config page 1 last",
                f"lf hitag hts wrbl --page 1 --data {profile.config_page()}",
                RiskLevel.HIGH_RISK_CONFIG,
                requires_manual_approval=True,
            )
        )
        steps.append(WorkflowStep("Verify config page 1", "lf hitag hts rdbl --page 1", RiskLevel.READ_ONLY))
    steps.append(WorkflowStep("Final full verification", "lf hitag hts dump", RiskLevel.READ_ONLY))
    return steps

