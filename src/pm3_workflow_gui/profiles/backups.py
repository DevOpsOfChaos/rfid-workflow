from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.settings import local_data_dir


@dataclass(frozen=True)
class BackupRecord:
    source: str
    profile: HitagS256Profile
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    backup_id: str = field(default_factory=lambda: f"bak_{uuid4().hex}")
    technology_id: str = "hitag_s256"
    technology_name: str = "Hitag S256"
    frequency: str = "lf"
    uid_reference: str = ""

    def __post_init__(self) -> None:
        if not self.uid_reference:
            object.__setattr__(self, "uid_reference", self.profile.uid)

    @classmethod
    def from_hitag_s256_profile(cls, profile: HitagS256Profile, source: str) -> "BackupRecord":
        return cls(source=source.strip() or "Backup", profile=profile)


def default_backup_dir() -> Path:
    return local_data_dir() / "backups"


def save_backup_record(record: BackupRecord, directory: str | Path | None = None) -> Path:
    target_dir = Path(directory) if directory else default_backup_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    path = _unique_backup_path(target_dir, record.technology_name, record.created_at)
    path.write_text(json.dumps(_backup_record_to_payload(record), indent=2, sort_keys=True), encoding="utf-8")
    return path


def load_backup_record(path: str | Path) -> BackupRecord:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    profile_payload = payload["profile"]
    profile = HitagS256Profile(
        uid=profile_payload["uid"],
        pages={int(page): value for page, value in profile_payload["pages"].items()},
        mode=profile_payload.get("mode", "plain_no_auth"),
        template_scope=profile_payload.get("template_scope", "partial_update"),
        uid_policy=profile_payload.get("uid_policy", "reference_only"),
        ttf_pages=tuple(profile_payload.get("ttf_pages", (4, 5, 6, 7))),
        ttf_data_rate=profile_payload.get("ttf_data_rate", "unknown"),
        write_uid=profile_payload.get("write_uid", False),
        write_config_last=profile_payload.get("write_config_last", True),
        write_order=tuple(profile_payload.get("write_order", (4, 5, 6, 7, 1))),
        created_at=profile_payload.get("created_at"),
    )
    return BackupRecord(
        source=payload.get("source", "Backup"),
        profile=profile,
        created_at=payload.get("created_at", profile.created_at),
        backup_id=payload.get("backup_id", f"legacy_{_slug(payload.get('source', 'backup'))}"),
        technology_id=payload.get("technology_id", "hitag_s256"),
        technology_name=payload.get("technology_name", "Hitag S256"),
        frequency=payload.get("frequency", "lf"),
        uid_reference=payload.get("uid_reference", profile.uid),
    )


def load_backup_records(directory: str | Path | None = None) -> tuple[tuple[Path, BackupRecord], ...]:
    target_dir = Path(directory) if directory else default_backup_dir()
    if not target_dir.exists():
        return ()
    return tuple((path, load_backup_record(path)) for path in sorted(target_dir.glob("*.json"), reverse=True))


def _backup_record_to_payload(record: BackupRecord) -> dict:
    return {
        "backup_id": record.backup_id,
        "source": record.source,
        "created_at": record.created_at,
        "technology_id": record.technology_id,
        "technology_name": record.technology_name,
        "frequency": record.frequency,
        "uid_reference": record.uid_reference or record.profile.uid,
        "profile": asdict(record.profile),
    }


def _unique_backup_path(directory: Path, label: str, created_at: str) -> Path:
    timestamp = re.sub(r"[^0-9]", "", created_at)[:14] or "backup"
    slug = _slug(label)
    path = directory / f"{timestamp}-{slug}.json"
    counter = 2
    while path.exists():
        path = directory / f"{timestamp}-{slug}-{counter}.json"
        counter += 1
    return path


def _slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-") or "backup"
