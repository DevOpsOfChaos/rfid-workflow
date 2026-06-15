from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path

from pm3_workflow_gui.profiles.schema import HitagS256Profile


def save_hitag_s256_profile(profile: HitagS256Profile, path: str | Path) -> None:
    payload = asdict(profile)
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def load_hitag_s256_profile(path: str | Path) -> HitagS256Profile:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    pages = {int(page): data for page, data in payload["pages"].items()}
    return HitagS256Profile(
        uid=payload["uid"],
        pages=pages,
        mode=payload.get("mode", "plain_no_auth"),
        ttf_pages=tuple(payload.get("ttf_pages", (4, 5, 6, 7))),
        ttf_data_rate=payload.get("ttf_data_rate", "2 kBit"),
        write_uid=payload.get("write_uid", False),
        write_config_last=payload.get("write_config_last", True),
        write_order=tuple(payload.get("write_order", (4, 5, 6, 7, 1))),
        created_at=payload.get("created_at"),
    )
