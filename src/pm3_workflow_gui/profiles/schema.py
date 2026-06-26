from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re

from pm3_workflow_gui.pm3.parsers import HitagSRead

HITAG_S256_EXPECTED_PAGES: tuple[int, ...] = tuple(range(8))
HITAG_S256_WRITE_SUPPORTED_PAGES: tuple[int, ...] = (1, 4, 5, 6, 7)
HITAG_S256_TEMPLATE_SCOPES = {"legacy_partial", "partial_update", "full_profile"}
HITAG_S256_UID_POLICIES = {"reference_only", "ignore_for_equivalence", "must_match"}


def _validate_page_data(data: str) -> str:
    parts = re.findall(r"[0-9A-Fa-f]{2}", data)
    if len(parts) != 4 or any(len(part) != 2 for part in parts):
        raise ValueError(f"Expected exactly four hex bytes, got: {data}")
    int_values = [int(part, 16) for part in parts]
    return " ".join(f"{value:02X}" for value in int_values)


@dataclass(frozen=True)
class HitagS256Profile:
    uid: str
    pages: dict[int, str]
    mode: str = "plain_no_auth"
    template_scope: str = "partial_update"
    uid_policy: str = "reference_only"
    ttf_pages: tuple[int, ...] = (4, 5, 6, 7)
    ttf_data_rate: str = "2 kBit"
    write_uid: bool = False
    write_config_last: bool = True
    write_order: tuple[int, ...] = (4, 5, 6, 7, 1)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self) -> None:
        normalized_uid = _validate_page_data(self.uid)
        normalized_pages = {int(page): _validate_page_data(data) for page, data in self.pages.items()}
        if self.template_scope not in HITAG_S256_TEMPLATE_SCOPES:
            raise ValueError(f"Unknown Hitag S256 template scope: {self.template_scope}")
        if self.uid_policy not in HITAG_S256_UID_POLICIES:
            raise ValueError(f"Unknown Hitag S256 UID policy: {self.uid_policy}")
        if 0 not in normalized_pages:
            raise ValueError("Hitag S256 profile must include read-only UID page 0.")
        if normalized_pages[0] != normalized_uid:
            raise ValueError("UID must match page 0.")
        object.__setattr__(self, "uid", normalized_uid)
        object.__setattr__(self, "pages", normalized_pages)

    @property
    def writable_data_pages(self) -> tuple[int, ...]:
        return tuple(page for page in self.ttf_pages if page in self.pages and page not in {0, 1})

    @property
    def missing_expected_pages(self) -> tuple[int, ...]:
        return tuple(page for page in HITAG_S256_EXPECTED_PAGES if page not in self.pages)

    @property
    def is_complete_snapshot(self) -> bool:
        return not self.missing_expected_pages

    @property
    def can_be_full_profile_template(self) -> bool:
        return self.is_complete_snapshot

    @property
    def equivalence_pages(self) -> tuple[int, ...]:
        if self.template_scope == "full_profile":
            pages = [page for page in HITAG_S256_EXPECTED_PAGES if page != 0]
            if self.uid_policy == "must_match":
                pages.insert(0, 0)
            return tuple(pages)
        return tuple(page for page in sorted(self.pages) if page != 0)

    def config_page(self) -> str | None:
        return self.pages.get(1)

    @classmethod
    def from_hitag_s_read(cls, read: HitagSRead) -> "HitagS256Profile":
        if not read.is_hitag_s256_plain_no_auth:
            raise ValueError("Expected Hitag S256 Plain/No Auth read output.")
        if read.uid is None:
            raise ValueError("Hitag S256 read output must include UID page 0.")
        pages = {page: item.data for page, item in read.pages.items()}
        return cls(
            uid=read.uid,
            pages=pages,
            mode="plain_no_auth",
            template_scope="full_profile" if _is_complete_hitag_s256_read(read) else "partial_update",
            uid_policy="reference_only",
            ttf_pages=_ttf_pages_from_mode(read.ttf_mode),
            ttf_data_rate=read.ttf_data_rate or "unknown",
            write_uid=False,
            write_config_last=True,
            write_order=(4, 5, 6, 7, 1),
        )


def _ttf_pages_from_mode(ttf_mode: str | None) -> tuple[int, ...]:
    if not ttf_mode:
        return ()
    return tuple(int(page) for page in re.findall(r"Page\s+(\d+)", ttf_mode))


def _is_complete_hitag_s256_read(read: HitagSRead) -> bool:
    return all(page in read.pages for page in HITAG_S256_EXPECTED_PAGES)
