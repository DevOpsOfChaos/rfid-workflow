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
        template_scope=payload.get("template_scope", "legacy_partial"),
        uid_policy=payload.get("uid_policy", "reference_only"),
        ttf_pages=tuple(payload.get("ttf_pages", (4, 5, 6, 7))),
        ttf_data_rate=payload.get("ttf_data_rate", "2 kBit"),
        write_uid=payload.get("write_uid", False),
        write_config_last=payload.get("write_config_last", True),
        write_order=tuple(payload.get("write_order", (4, 5, 6, 7, 1))),
        created_at=payload.get("created_at"),
    )


@dataclass(frozen=True)
class TemplateRecord:
    title: str
    description: str
    chip_type: str
    technology: str
    uid_reference: str
    relevant_pages: dict[int, str]
    configuration: str | None
    write_uid: bool
    write_config_last: bool
    supported_write_plan: tuple[int, ...]
    profile: HitagS256Profile
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    template_id: str = field(default_factory=lambda: f"tmpl_{uuid4().hex}")
    technology_id: str = "hitag_s256"
    technology_name: str = "Hitag S256"
    frequency: str = "lf"
    adapter_version: str = "1.0"
    identity: dict[str, str] = field(default_factory=dict)
    fields: dict[str, str] = field(default_factory=dict)
    capabilities: dict[str, bool] = field(default_factory=dict)
    validation_requirements: tuple[str, ...] = ("second_scan_must_match",)
    write_policy: dict[str, bool | str] = field(default_factory=dict)
    template_creation_allowed: bool = True
    template_scope: str = "full_profile"
    uid_policy: str = "reference_only"

    @classmethod
    def from_hitag_s256_profile(cls, title: str, description: str, profile: HitagS256Profile) -> "TemplateRecord":
        if not profile.can_be_full_profile_template:
            raise ValueError("Full Hitag S256 templates require pages 0-7.")
        profile = HitagS256Profile(
            uid=profile.uid,
            pages=profile.pages,
            mode=profile.mode,
            template_scope="full_profile",
            uid_policy=profile.uid_policy,
            ttf_pages=profile.ttf_pages,
            ttf_data_rate=profile.ttf_data_rate,
            write_uid=profile.write_uid,
            write_config_last=profile.write_config_last,
            write_order=profile.write_order,
            created_at=profile.created_at,
        )
        relevant_pages = {page: profile.pages[page] for page in sorted(profile.pages) if page != 0}
        return cls(
            title=title.strip(),
            description=description.strip(),
            chip_type="Hitag S256",
            technology="LF",
            uid_reference=profile.uid,
            relevant_pages=relevant_pages,
            configuration=profile.config_page(),
            write_uid=False,
            write_config_last=True,
            supported_write_plan=profile.write_order,
            profile=profile,
            technology_id="hitag_s256",
            technology_name="Hitag S256",
            frequency="lf",
            adapter_version="1.0",
            identity={"uid": profile.uid},
            fields={
                **{f"block_{page}": value for page, value in relevant_pages.items()},
                **({"config": profile.config_page()} if profile.config_page() else {}),
            },
            capabilities={
                "can_detect": True,
                "can_read_identity": True,
                "can_read_details": True,
                "can_create_template": True,
                "can_compare_template": True,
                "can_plan_write": True,
                "can_write": True,
            },
            validation_requirements=("second_scan_must_match",),
            write_policy={"write_uid": False, "config_last": True, "uid_policy": profile.uid_policy, "template_scope": "full_profile"},
            template_creation_allowed=True,
            template_scope="full_profile",
            uid_policy=profile.uid_policy,
        )


def default_template_dir() -> Path:
    return local_data_dir() / "templates"


def save_template_record(record: TemplateRecord, directory: str | Path | None = None) -> Path:
    target_dir = Path(directory) if directory else default_template_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    path = _unique_template_path(target_dir, record.title or "template", record.created_at)
    payload = _template_record_to_payload(record)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def load_template_record(path: str | Path) -> TemplateRecord:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    profile_payload = payload["profile"]
    pages = {int(page): data for page, data in profile_payload["pages"].items()}
    scope = payload.get("template_scope") or profile_payload.get("template_scope") or "legacy_partial"
    uid_policy = payload.get("uid_policy") or profile_payload.get("uid_policy") or payload.get("write_policy", {}).get("uid_policy", "reference_only")
    profile = HitagS256Profile(
        uid=profile_payload["uid"],
        pages=pages,
        mode=profile_payload.get("mode", "plain_no_auth"),
        template_scope=scope,
        uid_policy=uid_policy,
        ttf_pages=tuple(profile_payload.get("ttf_pages", (4, 5, 6, 7))),
        ttf_data_rate=profile_payload.get("ttf_data_rate", "unknown"),
        write_uid=profile_payload.get("write_uid", False),
        write_config_last=profile_payload.get("write_config_last", True),
        write_order=tuple(profile_payload.get("write_order", (4, 5, 6, 7, 1))),
        created_at=profile_payload.get("created_at"),
    )
    return TemplateRecord(
        title=payload["title"],
        description=payload.get("description", ""),
        chip_type=payload.get("chip_type", "Hitag S256"),
        technology=payload.get("technology", "LF"),
        uid_reference=payload.get("uid_reference", profile.uid),
        relevant_pages={int(page): data for page, data in payload.get("relevant_pages", {}).items()},
        configuration=payload.get("configuration"),
        write_uid=payload.get("write_uid", False),
        write_config_last=payload.get("write_config_last", True),
        supported_write_plan=tuple(payload.get("supported_write_plan", profile.write_order)),
        profile=profile,
        created_at=payload.get("created_at", profile.created_at),
        template_id=payload.get("template_id", f"legacy_{_slug(payload.get('title', 'template'))}"),
        technology_id=payload.get("technology_id", "hitag_s256"),
        technology_name=payload.get("technology_name", payload.get("chip_type", "Hitag S256")),
        frequency=payload.get("frequency", payload.get("technology", "LF")).lower(),
        adapter_version=payload.get("adapter_version", "1.0"),
        identity=payload.get("identity", {"uid": payload.get("uid_reference", profile.uid)}),
        fields=payload.get("fields", _legacy_fields_payload(payload, profile)),
        capabilities=payload.get("capabilities", _hitag_capabilities_payload()),
        validation_requirements=tuple(payload.get("validation_requirements", ("second_scan_must_match",))),
        write_policy=payload.get(
            "write_policy",
            {
                "write_uid": payload.get("write_uid", False),
                "config_last": payload.get("write_config_last", True),
                "uid_policy": uid_policy,
                "template_scope": scope,
            },
        ),
        template_creation_allowed=payload.get("template_creation_allowed", True),
        template_scope=scope,
        uid_policy=uid_policy,
    )


def load_template_records(directory: str | Path | None = None) -> tuple[tuple[Path, TemplateRecord], ...]:
    target_dir = Path(directory) if directory else default_template_dir()
    if not target_dir.exists():
        return ()
    records: list[tuple[Path, TemplateRecord]] = []
    for path in sorted(target_dir.glob("*.json")):
        records.append((path, load_template_record(path)))
    return tuple(records)


def _template_record_to_payload(record: TemplateRecord) -> dict:
    profile_payload = asdict(record.profile)
    return {
        "template_id": record.template_id,
        "title": record.title,
        "description": record.description,
        "created_at": record.created_at,
        "technology_id": record.technology_id,
        "technology_name": record.technology_name,
        "frequency": record.frequency,
        "adapter_version": record.adapter_version,
        "identity": record.identity or {"uid": record.uid_reference},
        "fields": record.fields,
        "capabilities": record.capabilities or _hitag_capabilities_payload(),
        "validation_requirements": list(record.validation_requirements),
        "write_policy": record.write_policy or {"write_uid": record.write_uid, "config_last": record.write_config_last},
        "template_scope": record.template_scope,
        "uid_policy": record.uid_policy,
        "template_creation_allowed": record.template_creation_allowed,
        "chip_type": record.chip_type,
        "technology": record.technology,
        "uid_reference": record.uid_reference,
        "relevant_pages": {str(page): data for page, data in record.relevant_pages.items()},
        "configuration": record.configuration,
        "write_uid": record.write_uid,
        "write_config_last": record.write_config_last,
        "supported_write_plan": list(record.supported_write_plan),
        "config_last_rule": "configuration page is planned last",
        "profile": profile_payload,
    }


def _unique_template_path(directory: Path, title: str, created_at: str) -> Path:
    timestamp = re.sub(r"[^0-9]", "", created_at)[:14] or "template"
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", title.strip().lower()).strip("-") or "template"
    path = directory / f"{timestamp}-{slug}.json"
    counter = 2
    while path.exists():
        path = directory / f"{timestamp}-{slug}-{counter}.json"
        counter += 1
    return path


def _hitag_capabilities_payload() -> dict[str, bool]:
    return {
        "can_detect": True,
        "can_read_identity": True,
        "can_read_details": True,
        "can_create_template": True,
        "can_compare_template": True,
        "can_plan_write": True,
        "can_write": True,
    }


def _legacy_fields_payload(payload: dict, profile: HitagS256Profile) -> dict[str, str]:
    relevant_pages = payload.get("relevant_pages", {})
    fields = {f"block_{page}": data for page, data in relevant_pages.items()}
    config = payload.get("configuration") or profile.config_page()
    if config:
        fields["config"] = config
    return fields


def _slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-") or "template"
