from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re

from pm3_workflow_gui.pm3.parsers import HitagSRead


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
    ttf_pages: tuple[int, ...] = (4, 5, 6, 7)
    ttf_data_rate: str = "2 kBit"
    write_uid: bool = False
    write_config_last: bool = True
    write_order: tuple[int, ...] = (4, 5, 6, 7, 1)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self) -> None:
        normalized_uid = _validate_page_data(self.uid)
        normalized_pages = {int(page): _validate_page_data(data) for page, data in self.pages.items()}
        if 0 not in normalized_pages:
            raise ValueError("Hitag S256 profile must include read-only UID page 0.")
        if normalized_pages[0] != normalized_uid:
            raise ValueError("UID must match page 0.")
        object.__setattr__(self, "uid", normalized_uid)
        object.__setattr__(self, "pages", normalized_pages)

    @property
    def writable_data_pages(self) -> tuple[int, ...]:
        return tuple(page for page in self.ttf_pages if page in self.pages and page not in {0, 1})

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
