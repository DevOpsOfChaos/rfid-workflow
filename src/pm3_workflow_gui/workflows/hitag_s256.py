from __future__ import annotations

from dataclasses import dataclass
import re

from pm3_workflow_gui.pm3.parsers import HitagSRead
from pm3_workflow_gui.pm3.risk import RiskLevel
from pm3_workflow_gui.profiles.schema import HitagS256Profile


@dataclass(frozen=True)
class WorkflowStep:
    label: str
    command_template: str | None
    risk: RiskLevel
    requires_manual_approval: bool = False


@dataclass(frozen=True)
class VerificationResult:
    status: str
    uid_matches: bool
    mismatched_pages: tuple[int, ...]
    missing_pages: tuple[int, ...]

    @property
    def success(self) -> bool:
        return self.status in {"verified", "verified_with_uid_mismatch"}


def build_safe_write_plan(profile: HitagS256Profile) -> list[WorkflowStep]:
    """Return a gated plan; execution belongs in the future workflow runner."""
    steps = [
        WorkflowStep("Read profile from source tag", "lf hitag hts dump", RiskLevel.READ_ONLY_WITH_FILE_OUTPUT),
        WorkflowStep("Validate target blank compatibility", "lf hitag hts dump", RiskLevel.READ_ONLY_WITH_FILE_OUTPUT),
    ]
    for page in profile.write_order:
        if page in {0, 1} or page not in profile.pages:
            continue
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
    steps.append(WorkflowStep("Final full verification", "lf hitag hts dump", RiskLevel.READ_ONLY_WITH_FILE_OUTPUT))
    return steps


def verify_hitag_s256_profile(target_read: HitagSRead, profile: HitagS256Profile) -> VerificationResult:
    target_pages = {page: item.data for page, item in target_read.pages.items()}
    uid_matches = _compact(profile.uid) == target_read.uid
    pages_to_verify = tuple(page for page in sorted(profile.pages) if page != 0)
    missing_pages = tuple(page for page in pages_to_verify if page not in target_pages)
    mismatched_pages = tuple(
        page
        for page in pages_to_verify
        if page in target_pages and _compact(profile.pages[page]) != target_pages[page]
    )
    if missing_pages or mismatched_pages:
        status = "failed"
    elif uid_matches:
        status = "verified"
    else:
        status = "verified_with_uid_mismatch"
    return VerificationResult(
        status=status,
        uid_matches=uid_matches,
        mismatched_pages=mismatched_pages,
        missing_pages=missing_pages,
    )


def profile_from_hitag_s_read(read: HitagSRead) -> HitagS256Profile:
    return HitagS256Profile.from_hitag_s_read(read)


def _compact(value: str) -> str:
    return "".join(re.findall(r"[0-9A-Fa-f]{2}", value)).upper()
