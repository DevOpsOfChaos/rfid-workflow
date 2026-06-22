from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any

from pm3_workflow_gui.pm3.parsers import parse_hf_search, parse_hw_tune, parse_hw_version
from pm3_workflow_gui.profiles.backups import (
    BackupRecord,
    default_backup_dir,
    load_backup_record,
    load_backup_records,
    save_backup_record,
)
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import (
    TemplateRecord,
    default_template_dir,
    load_template_record,
    load_template_records,
    save_template_record,
)
from pm3_workflow_gui.profiles.settings import load_settings, settings_payload, update_settings
from pm3_workflow_gui.services.live_pm3_readonly import (
    HitagS256LiveReadResult,
    LivePm3ReadonlyService,
    Pm3StartupCheck,
    _combined_output,
)
from pm3_workflow_gui.technologies.registry import detect_technology
from pm3_workflow_gui.ui.viewmodel import (
    ChipFieldViewModel,
    ChipReadViewModel,
    build_write_plan_view_model,
    chip_read_view_model_from_live_result,
    chip_read_view_model_from_positioning_result,
    validate_second_scan,
)
from pm3_workflow_gui.web_desktop.operation_manager import (
    ConnectionLostError,
    OperationManager,
    VerificationFailedError,
)
from pm3_workflow_gui.web_desktop.state import ConnectionSnapshot, TargetSnapshot, WebDesktopState


VERIFIED_CLIENT_BASELINE = "v4.21611-321-gc7b95a94e"
VERIFIED_TARGET = "PM3 GENERIC"


class WebDesktopBridge:
    def __init__(
        self,
        service: LivePm3ReadonlyService | None = None,
        template_dir: str | Path | None = None,
        backup_dir: str | Path | None = None,
    ) -> None:
        self.service = service or LivePm3ReadonlyService()
        self.template_dir = Path(template_dir) if template_dir else default_template_dir()
        self.backup_dir = Path(backup_dir) if backup_dir else default_backup_dir()
        self.operations = OperationManager()
        self.state = WebDesktopState()

    def get_app_settings(self) -> dict:
        return {"ok": True, "settings": settings_payload(load_settings())}

    def update_app_settings(self, updates: dict) -> dict:
        return {"ok": True, "settings": settings_payload(update_settings(updates))}

    def complete_first_run(self) -> dict:
        return {"ok": True, "settings": settings_payload(update_settings({"first_run_completed": True}))}

    def refresh_connection(self) -> dict:
        check = self.service.startup_check()
        snapshot = _connection_from_startup(check)
        self.state.set_connection(snapshot)
        if check.connected and getattr(self.service, "client_dir", None):
            update_settings({"last_known_pm3_path": str(self.service.client_dir)})
        return self.get_connection_state()

    def get_connection_state(self) -> dict:
        return _connection_to_payload(self.state.connection)

    def start_scan(self, mode: str = "auto") -> dict:
        self.state.clear_last_scan()
        operation_id = self.operations.start("scan", lambda progress: self._scan_operation(mode, progress))
        return {"operation_id": operation_id}

    def get_operation_state(self, operation_id: str) -> dict:
        return self.operations.get(operation_id)

    def get_last_scan(self) -> dict:
        snapshot = self.state.snapshot()
        return _scan_payload(
            snapshot["last_scan"],
            confirmed=bool(snapshot["last_scan_confirmed"]),
            second_status=str(snapshot["last_scan_second_status"]),
        )

    def save_template(self, name: str, description: str = "", category: str = "") -> dict:
        snapshot = self.state.snapshot()
        scan = snapshot["last_scan"]
        if not snapshot["last_scan_confirmed"] or scan is None or scan.profile is None:
            return _error("Vorlage kann erst nach einem bestaetigten zweiten Scan gespeichert werden.")
        if not name.strip():
            return _error("Name ist erforderlich.")
        record = TemplateRecord.from_hitag_s256_profile(name, description, scan.profile)
        path = save_template_record(record, self.template_dir)
        if category.strip():
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["category"] = category.strip()
            path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        saved = load_template_record(path)
        return {"ok": True, "message": "Vorlage gespeichert", "template": self._template_payload(path, saved)}

    def list_templates(self) -> dict:
        return {"ok": True, "templates": [self._template_payload(path, record) for path, record in self._template_entries()]}

    def update_template(self, template_id: str, metadata: dict) -> dict:
        path = self._find_template_path(template_id)
        if path is None:
            return _error("Vorlage nicht gefunden.")
        payload = json.loads(path.read_text(encoding="utf-8"))
        title = str(metadata.get("name") or metadata.get("title") or payload.get("title") or "").strip()
        if not title:
            return _error("Name ist erforderlich.")
        payload["title"] = title
        payload["description"] = str(metadata.get("description", payload.get("description", ""))).strip()
        payload["category"] = str(metadata.get("category", payload.get("category", ""))).strip()
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        record = load_template_record(path)
        return {"ok": True, "message": "Vorlage aktualisiert", "template": self._template_payload(path, record)}

    def duplicate_template(self, template_id: str) -> dict:
        source = self._find_template_path(template_id)
        if source is None:
            return _error("Vorlage nicht gefunden.")
        payload = json.loads(source.read_text(encoding="utf-8"))
        payload["template_id"] = f"tmpl_{_slug(payload.get('title', 'template'))}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        payload["title"] = f"{payload.get('title', 'Vorlage')} Kopie"
        payload["created_at"] = datetime.now(timezone.utc).isoformat()
        target = _unique_json_path(self.template_dir, payload["title"], payload["created_at"])
        self.template_dir.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        record = load_template_record(target)
        return {"ok": True, "message": "Vorlage dupliziert", "template": self._template_payload(target, record)}

    def delete_template(self, template_id: str) -> dict:
        path = self._find_template_path(template_id)
        if path is None:
            return _error("Vorlage nicht gefunden.")
        path.unlink()
        target = self.state.snapshot()["target"]
        if target and target.kind == "template" and target.item_id == template_id:
            self.state.set_target(None)
        return {"ok": True, "message": "Vorlage geloescht"}

    def import_existing_templates(self) -> dict:
        self.template_dir.mkdir(parents=True, exist_ok=True)
        existing_fingerprints = {_template_fingerprint(record) for _, record in self._template_entries()}
        imported = 0
        already_present = 0
        checked = 0
        for source_dir in _legacy_template_dirs(self.template_dir):
            if not source_dir.exists():
                continue
            for source_path in source_dir.glob("*.json"):
                checked += 1
                try:
                    record = load_template_record(source_path)
                except Exception:
                    continue
                fingerprint = _template_fingerprint(record)
                if fingerprint in existing_fingerprints:
                    already_present += 1
                    continue
                target_path = _unique_json_path(self.template_dir, record.title, record.created_at)
                shutil.copy2(source_path, target_path)
                existing_fingerprints.add(fingerprint)
                imported += 1
        return {
            "ok": True,
            "message": f"{imported} Vorlagen importiert, {already_present} bereits vorhanden",
            "imported": imported,
            "already_present": already_present,
            "checked": checked,
            "templates": [self._template_payload(path, record) for path, record in self._template_entries()],
        }

    def start_current_chip_scan(self) -> dict:
        self.state.clear_current_chip()
        operation_id = self.operations.start("current_chip_scan", self._current_chip_scan_operation)
        return {"operation_id": operation_id}

    def get_current_chip(self) -> dict:
        snapshot = self.state.snapshot()
        return {
            "ok": True,
            "chip": _chip_payload(snapshot["current_chip"]),
            "backup": _backup_payload_from_record(snapshot["current_backup"]) if snapshot["current_backup"] else None,
        }

    def list_backups(self) -> dict:
        return {"ok": True, "backups": [self._backup_payload(path, record) for path, record in self._backup_entries()]}

    def delete_backup(self, backup_id: str) -> dict:
        path = self._find_backup_path(backup_id)
        if path is None:
            return _error("Backup nicht gefunden.")
        path.unlink()
        target = self.state.snapshot()["target"]
        if target and target.kind == "backup" and target.item_id == backup_id:
            self.state.set_target(None)
        return {"ok": True, "message": "Backup geloescht"}

    def use_backup_as_target(self, backup_id: str) -> dict:
        path = self._find_backup_path(backup_id)
        if path is None:
            return _error("Backup nicht gefunden.")
        record = load_backup_record(path)
        target = TargetSnapshot("backup", record.backup_id, _display_datetime(record.created_at), backup=record)
        self.state.set_target(target)
        return {"ok": True, "message": "Backup als Zielzustand verwendet", "target": self.get_target_state()["target"]}

    def set_target_template(self, template_id: str) -> dict:
        path = self._find_template_path(template_id)
        if path is None:
            return _error("Vorlage nicht gefunden.")
        record = load_template_record(path)
        self.state.set_target(TargetSnapshot("template", record.template_id, record.title, template=record))
        return {"ok": True, "message": "Vorlage als Zielzustand verwendet", "target": self.get_target_state()["target"]}

    def get_target_state(self) -> dict:
        target = self.state.snapshot()["target"]
        return {"ok": True, "target": _target_payload(target)}

    def compare_current_to_target(self) -> dict:
        snapshot = self.state.snapshot()
        current = snapshot["current_chip"]
        target = snapshot["target"]
        if current is None or current.profile is None:
            return _error("Kein real gelesener aktueller Chip vorhanden.")
        target_profile = _target_profile(target)
        if target_profile is None:
            return _error("Kein realer Zielzustand ausgewaehlt.")
        plan = build_write_plan_view_model(current.profile, target_profile)
        return {"ok": True, "comparison": _comparison_payload(plan)}

    def start_write_region(self, region_id: str) -> dict:
        operation_id = self.operations.start("write_region", lambda progress: self._write_region_operation(region_id, progress))
        return {"operation_id": operation_id}

    def start_write_all(self) -> dict:
        operation_id = self.operations.start("write_all", self._write_all_operation)
        return {"operation_id": operation_id}

    def get_write_operation_state(self, operation_id: str) -> dict:
        return self.get_operation_state(operation_id)

    def start_position_check(self) -> dict:
        operation_id = self.operations.start("position_check", self._position_operation)
        return {"operation_id": operation_id}

    def start_antenna_check(self) -> dict:
        operation_id = self.operations.start("antenna_check", self._antenna_operation)
        return {"operation_id": operation_id}

    def get_technical_details(self) -> dict:
        snapshot = self.state.snapshot()
        chip = snapshot["current_chip"] or snapshot["last_scan"]
        return {
            "ok": True,
            "details": chip.details if hasattr(chip, "details") else _technical_details_payload(chip),
            "chip": _chip_payload(chip),
        }

    def _scan_operation(self, mode: str, progress) -> dict:
        mode = _normalize_mode(mode)
        check = self._verify_connection(progress)
        progress("Suche HF ..." if mode == "hf" else "Suche LF ..." if mode == "lf" else "Suche HF/LF ...")
        first_result = self._read_chip_for_mode(mode, check.port)
        self._raise_if_device_lost(first_result)
        first = chip_read_view_model_from_live_result(first_result)
        if not first.is_complete_template_read:
            self.state.set_last_scan(first, confirmed=False, second_status="nicht bestaetigt")
            return _scan_payload(first, confirmed=False, second_status="nicht bestaetigt")

        progress("Zweiter Scan wird geprueft ...")
        second_result = self._read_chip_for_mode(mode, check.port)
        self._raise_if_device_lost(second_result)
        second = chip_read_view_model_from_live_result(second_result)
        validation = validate_second_scan(first, second)
        confirmed = validation.can_save
        self.state.set_last_scan(first, confirmed=confirmed, second_status=validation.status)
        payload = _scan_payload(first, confirmed=confirmed, second_status=validation.status)
        payload["message"] = validation.message
        return payload

    def _current_chip_scan_operation(self, progress) -> dict:
        check = self._verify_connection(progress)
        progress("Aktueller Chip wird gelesen ...")
        result = self.service.read_chip(check.port)
        self._raise_if_device_lost(result)
        model = chip_read_view_model_from_live_result(result)
        backup = None
        if model.profile is not None:
            progress("Backup wird gespeichert ...")
            backup = BackupRecord.from_hitag_s256_profile(model.profile, "Vor dem Schreiben")
            save_backup_record(backup, self.backup_dir)
        self.state.set_current_chip(model, backup)
        payload = {
            "ok": True,
            "message": "Backup erstellt" if backup else model.message,
            "chip": _chip_payload(model),
            "backup": _backup_payload_from_record(backup) if backup else None,
        }
        if backup is None:
            payload["write_available"] = False
        return payload

    def _write_region_operation(self, region_id: str, progress) -> dict:
        snapshot = self.state.snapshot()
        current = snapshot["current_chip"]
        target = snapshot["target"]
        if current is None or current.profile is None:
            raise ValueError("Kein aktueller Hitag-S256-Read vorhanden.")
        target_profile = _target_profile(target)
        target_id = _target_id(target)
        if target_profile is None or target_id is None:
            raise ValueError("Kein Zielzustand ausgewaehlt.")
        page = _page_from_region(region_id)
        if page == 0:
            raise ValueError("UID wird nicht geschrieben.")
        if page is None:
            raise ValueError(f"Unbekannter Schreibbereich: {region_id}")
        plan = build_write_plan_view_model(current.profile, target_profile)
        action = next((item for item in plan.disabled_actions if item.page == page), None)
        if action is None or not action.enabled:
            raise ValueError("Fuer diesen Bereich gibt es keine freigegebene Schreibaktion.")

        check = self._verify_connection(progress)
        label = "Konfiguration" if page == 1 else f"Block {page}"
        progress(f"{label} wird uebernommen ...")
        result = self.service.write_hitag_s256_page(
            page,
            current.profile.pages[page],
            target_profile.pages[page],
            target_id,
            current.profile.uid,
            check.port,
        )
        self._raise_if_device_lost(result.verify_result)
        if not result.success:
            raise VerificationFailedError(result.message)
        verified = chip_read_view_model_from_live_result(result.verify_result)
        self.state.set_current_chip(verified, snapshot["current_backup"])
        progress(f"{label} verifiziert")
        return {
            "ok": True,
            "message": f"{label} uebernommen",
            "region_id": region_id,
            "page": page,
            "verification_value": _compact(result.verification_value),
            "chip": _chip_payload(verified),
            "comparison": self.compare_current_to_target().get("comparison"),
        }

    def _write_all_operation(self, progress) -> dict:
        snapshot = self.state.snapshot()
        current = snapshot["current_chip"]
        target = snapshot["target"]
        if current is None or current.profile is None:
            raise ValueError("Kein aktueller Hitag-S256-Read vorhanden.")
        target_profile = _target_profile(target)
        target_id = _target_id(target)
        if target_profile is None or target_id is None:
            raise ValueError("Kein Zielzustand ausgewaehlt.")

        plan = build_write_plan_view_model(current.profile, target_profile)
        actions = tuple(action for action in plan.disabled_actions if action.enabled and action.page != 0)
        if not plan.compatible:
            raise ValueError("Zielzustand ist nicht kompatibel.")
        if not actions:
            return {
                "ok": True,
                "message": "Keine offenen Unterschiede",
                "completed_regions": [],
                "comparison": _comparison_payload(plan),
            }

        check = self._verify_connection(progress)
        current_model = current
        completed: list[str] = []
        total = len(actions)
        for index, action in enumerate(actions, start=1):
            if action.page is None:
                continue
            region_id = f"page_{action.page}"
            label = _write_label(action.page)
            progress(
                {
                    "message": f"{index - 1} / {total} Bereiche uebernommen · {label} wird geschrieben ...",
                    "active_region": region_id,
                    "completed_regions": list(completed),
                    "completed_steps": index - 1,
                    "total_steps": total,
                }
            )
            if current_model.profile is None:
                raise VerificationFailedError(f"{label} konnte nicht verifiziert werden. Ablauf angehalten.")
            result = self.service.write_hitag_s256_page(
                action.page,
                current_model.profile.pages[action.page],
                target_profile.pages[action.page],
                target_id,
                current_model.profile.uid,
                check.port,
            )
            self._raise_if_device_lost(result.verify_result)
            verified = chip_read_view_model_from_live_result(result.verify_result)
            if verified.profile is not None:
                self.state.set_current_chip(verified, snapshot["current_backup"])
                current_model = verified
            if not result.success:
                progress(
                    {
                        "message": f"{label} konnte nicht verifiziert werden. Ablauf angehalten.",
                        "active_region": None,
                        "failed_region": region_id,
                        "completed_regions": list(completed),
                        "completed_steps": len(completed),
                        "total_steps": total,
                    }
                )
                raise VerificationFailedError(f"{label} konnte nicht verifiziert werden. Ablauf angehalten.")
            completed.append(region_id)
            progress(
                {
                    "message": f"{index} / {total} Bereiche uebernommen · {label} verifiziert",
                    "active_region": None,
                    "completed_regions": list(completed),
                    "completed_steps": index,
                    "total_steps": total,
                }
            )

        final_comparison = self.compare_current_to_target().get("comparison")
        return {
            "ok": True,
            "message": "Alle Unterschiede uebernommen und verifiziert",
            "completed_regions": completed,
            "comparison": final_comparison,
            "chip": self.get_current_chip().get("chip"),
        }

    def _position_operation(self, progress) -> dict:
        check = self._verify_connection(progress)
        progress("Position wird mit echten Read-only-Messungen geprueft ...")
        result = self.service.position_chip(check.port, max_lf_attempts=6)
        if result.status == "device_lost":
            self.state.mark_connection_lost(result.message or "Verbindung verloren")
            raise ConnectionLostError(result.message or "Verbindung verloren")
        model = chip_read_view_model_from_positioning_result(result)
        return {
            "ok": True,
            "message": result.message or model.message,
            "position": {
                "status": result.status,
                "title": model.title,
                "message": model.message,
                "fields": [_field_payload(field) for field in model.fields],
                "next_step": model.next_step,
                "history": _position_history(result),
            },
        }

    def _antenna_operation(self, progress) -> dict:
        check = self._verify_connection(progress)
        progress("Antennenpruefung laeuft ...")
        hardware = self.service.hardware_check(check.port)
        if not hardware.ok and hardware.message == "No Proxmark3 port found":
            self.state.mark_connection_lost(hardware.message)
            raise ConnectionLostError(hardware.message)
        return {
            "ok": hardware.ok,
            "message": hardware.message or "Antennenpruefung abgeschlossen",
            "antenna": _antenna_payload(hardware),
        }

    def _verify_connection(self, progress) -> Pm3StartupCheck:
        progress("PM3 wird geprueft ...")
        check = self.service.startup_check()
        snapshot = _connection_from_startup(check)
        self.state.set_connection(snapshot)
        if not check.connected:
            raise ConnectionLostError(check.message or "Kein Proxmark erkannt")
        return check

    def _read_chip_for_mode(self, mode: str, port: str | None) -> HitagS256LiveReadResult:
        if mode == "hf":
            hf_result = self.service.run_safe_command("hf search", port=port)
            output = _combined_output(hf_result)
            hf_search = parse_hf_search(output) if output else None
            detected = detect_technology(hf_search=hf_search)
            if hf_search and hf_search.status == "device_lost":
                return HitagS256LiveReadResult("device_lost", port, hf_search=hf_search, message=hf_search.message or "Device lost")
            if detected:
                return HitagS256LiveReadResult(
                    "basic_detection",
                    port,
                    message="HF-Chip erkannt. Vollstaendiges Lesen ist fuer diesen Chiptyp noch nicht verfuegbar.",
                    raw_results=(hf_result,),
                    hf_search=hf_search,
                    detected_technology=detected,
                )
            return HitagS256LiveReadResult(
                "no_chip",
                port,
                message="Kein HF-Chip erkannt.",
                raw_results=(hf_result,),
                hf_search=hf_search,
            )
        return self.service.read_chip(port)

    def _raise_if_device_lost(self, result: Any) -> None:
        if getattr(result, "status", None) == "device_lost":
            self.state.mark_connection_lost()
            raise ConnectionLostError(getattr(result, "message", "") or "Verbindung verloren")

    def _template_entries(self) -> tuple[tuple[Path, TemplateRecord], ...]:
        return load_template_records(self.template_dir)

    def _backup_entries(self) -> tuple[tuple[Path, BackupRecord], ...]:
        return load_backup_records(self.backup_dir)

    def _find_template_path(self, template_id: str) -> Path | None:
        for path, record in self._template_entries():
            if record.template_id == template_id:
                return path
        return None

    def _find_backup_path(self, backup_id: str) -> Path | None:
        for path, record in self._backup_entries():
            if record.backup_id == backup_id:
                return path
        return None

    def _template_payload(self, path: Path, record: TemplateRecord) -> dict:
        category = ""
        try:
            category = str(json.loads(path.read_text(encoding="utf-8")).get("category", ""))
        except Exception:
            category = ""
        return {
            "id": record.template_id,
            "name": record.title,
            "description": record.description,
            "category": category,
            "technology": record.technology_name,
            "frequency": record.frequency.upper(),
            "uid": _compact(record.uid_reference),
            "created_at": record.created_at,
            "created_display": _display_datetime(record.created_at),
            "path": str(path),
            "chip": _chip_from_profile(record.profile, record.technology_name, record.frequency, record.created_at, "Vorlage geprueft"),
        }

    def _backup_payload(self, path: Path, record: BackupRecord) -> dict:
        payload = _backup_payload_from_record(record)
        payload["path"] = str(path)
        return payload


def _connection_from_startup(check: Pm3StartupCheck) -> ConnectionSnapshot:
    compatibility = _compatibility_from_startup(check)
    if check.connected:
        return ConnectionSnapshot(
            "connected",
            True,
            "PM3 verbunden",
            port=check.port,
            target=check.target or "PM3 Generic",
            client_version=check.client_version,
            compatibility=compatibility["status"],
            compatibility_label=compatibility["label"],
            firmware_version=compatibility["firmware_version"],
            platform=compatibility["platform"],
        )
    return ConnectionSnapshot(
        "disconnected",
        False,
        check.message or "Kein Proxmark erkannt. Bitte PM3 verbinden und erneut pruefen.",
        port=None,
        target=None,
        client_version=None,
    )


def _connection_to_payload(snapshot: ConnectionSnapshot) -> dict:
    return {
        "status": snapshot.status,
        "connected": snapshot.connected,
        "message": snapshot.message,
        "port": snapshot.port,
        "target": snapshot.target,
        "client_version": snapshot.client_version,
        "compatibility": snapshot.compatibility,
        "compatibility_label": snapshot.compatibility_label,
        "firmware_version": snapshot.firmware_version,
        "platform": snapshot.platform,
        "can_read": snapshot.connected,
        "can_write": snapshot.connected,
    }


def _compatibility_from_startup(check: Pm3StartupCheck) -> dict[str, str | None]:
    payload: dict[str, str | None] = {
        "status": "unknown",
        "label": "Unknown",
        "firmware_version": None,
        "platform": None,
    }
    if not check.connected:
        payload["status"] = "no_device"
        payload["label"] = "No compatible device found"
        return payload
    output = _combined_output(check.hw_version) if check.hw_version else ""
    parsed = parse_hw_version(output) if output else None
    client = parsed.client_version if parsed else check.client_version
    firmware = parsed.firmware if parsed else check.target
    bootrom = parsed.bootrom if parsed else None
    os_version = parsed.os if parsed else None
    platform = parsed.platform if parsed else None
    payload["firmware_version"] = firmware
    payload["platform"] = platform

    combined = "\n".join(value or "" for value in (client, firmware, bootrom, os_version, platform, output)).lower()
    if "mismatch" in combined or "doesn't match" in combined or "does not match" in combined:
        payload["status"] = "client_firmware_mismatch"
        payload["label"] = "Client / firmware mismatch"
        return payload

    target = (firmware or check.target or "").upper()
    has_verified_client = VERIFIED_CLIENT_BASELINE.lower() in (client or "").lower()
    has_verified_arm = VERIFIED_CLIENT_BASELINE.lower() in ((bootrom or "") + " " + (os_version or "")).lower()
    has_verified_target = VERIFIED_TARGET in target
    if has_verified_client and has_verified_target and (has_verified_arm or not output):
        payload["status"] = "verified"
        payload["label"] = "Verified"
        return payload

    payload["status"] = "recognized_untested"
    payload["label"] = "Recognized but untested"
    return payload


def _scan_payload(
    scan: ChipReadViewModel | None,
    confirmed: bool,
    second_status: str,
) -> dict:
    if scan is None:
        return {
            "ok": True,
            "status": "empty",
            "message": "Noch kein Scan vorhanden.",
            "confirmed": False,
            "canSave": False,
            "chip": None,
            "second_scan_status": "nicht ausgefuehrt",
        }
    status = "confirmed" if confirmed else scan.status
    return {
        "ok": True,
        "status": status,
        "message": scan.message,
        "title": scan.title,
        "confirmed": confirmed,
        "canSave": confirmed and scan.profile is not None,
        "second_scan_status": second_status,
        "warnings": list(scan.warnings),
        "next_step": scan.next_step,
        "chip": _chip_payload(scan, second_scan_status=second_status),
    }


def _chip_payload(scan: ChipReadViewModel | None, second_scan_status: str = "nicht bestaetigt") -> dict | None:
    if scan is None:
        return None
    if scan.profile is not None:
        technology_name = scan.technology.technology_name if scan.technology else "Hitag S256"
        frequency = scan.technology.frequency if scan.technology else "lf"
        return _chip_from_profile(scan.profile, technology_name, frequency, scan.profile.created_at, second_scan_status)
    fields = {field.label.lower(): field.value for field in scan.fields}
    uid = _value_by_label(scan.fields, ("UID", "UID / ID"))
    frequency = scan.technology.frequency.upper() if scan.technology else fields.get("bereich", "")
    technology = scan.technology.technology_name if scan.technology else scan.title
    return {
        "technology": technology,
        "frequency": frequency,
        "uid": _compact(uid),
        "config": None,
        "memoryRange": "",
        "memoryRegions": [_field_payload(field) for field in scan.memory_sections],
        "fields": [_field_payload(field) for field in scan.fields],
        "details": {
            "Chipfamilie": technology,
            "Frequenz": frequency,
            "UID": _compact(uid) or "",
            "Status zweiter Scan": second_scan_status,
        },
        "read_status": scan.read_status,
        "support_level": scan.support_level,
    }


def _chip_from_profile(
    profile: HitagS256Profile,
    technology_name: str,
    frequency: str,
    created_at: str,
    second_scan_status: str,
) -> dict:
    regions = [
        {
            "id": f"page_{page}",
            "label": f"Block {page}",
            "value": _compact(profile.pages.get(page)),
            "writable": page in profile.write_order and page != 0,
        }
        for page in sorted(page for page in profile.pages if page in {4, 5, 6, 7})
    ]
    config = _compact(profile.config_page())
    return {
        "technology": technology_name,
        "frequency": frequency.upper(),
        "uid": _compact(profile.uid),
        "config": config,
        "memoryRange": _memory_range(tuple(int(region["id"].split("_")[1]) for region in regions)),
        "memoryRegions": regions,
        "fields": [
            {"label": "Chiptyp", "value": technology_name, "note": ""},
            {"label": "UID", "value": _compact(profile.uid), "note": "nicht schreibbar"},
            {"label": "Config", "value": config or "", "note": "Konfiguration zuletzt"},
            {"label": "Frequenz", "value": frequency.upper(), "note": ""},
        ],
        "details": {
            "Chipfamilie": technology_name,
            "Frequenz": frequency.upper(),
            "UID": _compact(profile.uid),
            "Config": config or "",
            "Datenrate": profile.ttf_data_rate,
            "Modus": profile.mode,
            "Scanzeitpunkt": _display_datetime(created_at),
            "Status zweiter Scan": second_scan_status,
        },
    }


def _comparison_payload(plan) -> dict:
    if not plan.compatible:
        status = "danger"
        message = "Nicht kompatibel · Zielzustand passt nicht zum aktuellen Chip"
    elif plan.writable_difference_count:
        status = "success"
        message = f"Kompatibel · {plan.writable_difference_count} {_plural(plan.writable_difference_count, 'uebernehmbare Aenderung', 'uebernehmbare Aenderungen')}"
    else:
        status = "success"
        message = "Kompatibel · keine offenen schreibbaren Aenderungen"
    return {
        "compatible": plan.compatible,
        "status": status,
        "message": message,
        "summary": list(plan.summary_lines),
        "difference_count": plan.difference_count,
        "writable_difference_count": plan.writable_difference_count,
        "rows": [asdict(row) for row in plan.rows],
        "actions": [
            {
                "region_id": f"page_{action.page}",
                "page": action.page,
                "label": _write_label(action.page),
                "fromValue": _compact(action.old_value),
                "toValue": _compact(action.new_value),
                "enabled": bool(action.enabled and plan.compatible),
                "reason": action.reason,
            }
            for action in plan.disabled_actions
            if action.page != 0
        ],
    }


def _target_payload(target: TargetSnapshot | None) -> dict | None:
    if target is None:
        return None
    if target.template is not None:
        return {
            "kind": "template",
            "id": target.item_id,
            "label": target.label,
            "source": f"Vorlage · {target.label}",
            "chip": _chip_from_profile(target.template.profile, target.template.technology_name, target.template.frequency, target.template.created_at, "Vorlage geprueft"),
        }
    if target.backup is not None:
        return {
            "kind": "backup",
            "id": target.item_id,
            "label": target.label,
            "source": f"Backup · {target.label}",
            "chip": _chip_from_profile(target.backup.profile, target.backup.technology_name, target.backup.frequency, target.backup.created_at, "Backup"),
        }
    return None


def _backup_payload_from_record(record: BackupRecord | None) -> dict | None:
    if record is None:
        return None
    return {
        "id": record.backup_id,
        "source": record.source,
        "technology": record.technology_name,
        "frequency": record.frequency.upper(),
        "uid": _compact(record.uid_reference),
        "created_at": record.created_at,
        "created_display": _display_datetime(record.created_at),
        "chip": _chip_from_profile(record.profile, record.technology_name, record.frequency, record.created_at, "Backup"),
    }


def _technical_details_payload(chip: ChipReadViewModel | None) -> dict:
    if chip is None:
        return {}
    payload = {
        "Status": chip.status,
        "Meldung": chip.message,
        "Read-Status": chip.read_status,
        "Support": chip.support_level,
    }
    if chip.technology is not None:
        payload.update(
            {
                "Chipfamilie": chip.technology.technology_name,
                "Frequenz": chip.technology.frequency.upper(),
                "UID": _compact(chip.technology.uid),
            }
        )
    for field in chip.fields:
        payload[field.label] = field.value
    return {key: value for key, value in payload.items() if value}


def _position_history(result) -> list[dict]:
    evidence = getattr(result, "scan_evidence", None)
    attempts = getattr(evidence, "attempts", ()) if evidence else ()
    history = []
    for index, attempt in enumerate(attempts, start=1):
        if getattr(attempt, "candidate_family", None):
            status = "Chip stabil erkannt" if result.status == "stable_detected" and index == len(attempts) else "Signal vorhanden"
        elif getattr(attempt, "frequency", ""):
            status = "Signal nicht erkannt"
        else:
            status = "Messung ohne Ergebnis"
        history.append(
            {
                "label": f"Messung {index}",
                "frequency": getattr(attempt, "frequency", "").upper(),
                "status": status,
            }
        )
    return history


def _antenna_payload(hardware) -> dict:
    output = _combined_output(hardware.hw_tune) if hardware.hw_tune else ""
    tune = parse_hw_tune(output) if output else None
    return {
        "ok": hardware.ok,
        "port": hardware.port,
        "lf": {
            "status": hardware.lf_antenna_status,
            "voltage_125khz": _format_voltage(tune.lf_125khz_voltage if tune else None),
            "voltage_134_83khz": _format_voltage(tune.lf_134_83khz_voltage if tune else None),
            "optimal_frequency": _format_frequency(tune.lf_optimal_frequency_khz if tune else None, "kHz"),
            "optimal_voltage": _format_voltage(tune.lf_optimal_voltage if tune else None),
        },
        "hf": {
            "status": hardware.hf_antenna_status,
            "voltage_13_56mhz": _format_voltage(tune.hf_13_56mhz_voltage if tune else None),
        },
    }


def _format_voltage(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.2f} V".replace(".", ",")


def _format_frequency(value: float | None, unit: str) -> str:
    if value is None:
        return ""
    return f"{value:.2f} {unit}".replace(".", ",")


def _target_profile(target: TargetSnapshot | None) -> HitagS256Profile | None:
    if target is None:
        return None
    if target.template is not None:
        return target.template.profile
    if target.backup is not None:
        return target.backup.profile
    return None


def _target_id(target: TargetSnapshot | None) -> str | None:
    if target is None:
        return None
    return target.item_id


def _legacy_template_dirs(current_dir: Path) -> tuple[Path, ...]:
    candidates = [current_dir]
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "PM3Workflow" / "templates")
    candidates.append(Path.home() / ".pm3-workflow" / "templates")
    result: list[Path] = []
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        result.append(path)
    return tuple(result)


def _template_fingerprint(record: TemplateRecord) -> str:
    pages = ";".join(f"{page}:{_compact(value)}" for page, value in sorted(record.profile.pages.items()))
    return f"{record.technology_id}|{_compact(record.profile.uid)}|{pages}"


def _unique_json_path(directory: Path, title: str, created_at: str) -> Path:
    timestamp = re.sub(r"[^0-9]", "", created_at)[:14] or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    path = directory / f"{timestamp}-{_slug(title)}.json"
    counter = 2
    while path.exists():
        path = directory / f"{timestamp}-{_slug(title)}-{counter}.json"
        counter += 1
    return path


def _field_payload(field: ChipFieldViewModel) -> dict:
    return {"label": field.label, "value": field.value, "note": field.note}


def _value_by_label(fields: tuple[ChipFieldViewModel, ...], labels: tuple[str, ...]) -> str | None:
    wanted = {label.lower() for label in labels}
    for field in fields:
        if field.label.lower() in wanted:
            return field.value
    return None


def _display_datetime(value: str | None) -> str:
    if not value:
        return ""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return value
    return parsed.strftime("%d.%m.%Y · %H:%M")


def _compact(value: str | None) -> str:
    if not value:
        return ""
    return "".join(re.findall(r"[0-9A-Fa-f]{2}", value)).upper() or value


def _memory_range(pages: tuple[int, ...]) -> str:
    if not pages:
        return ""
    ordered = tuple(sorted(pages))
    if ordered == tuple(range(ordered[0], ordered[-1] + 1)):
        return f"Block {ordered[0]}-{ordered[-1]}"
    return ", ".join(f"Block {page}" for page in ordered)


def _write_label(page: int | None) -> str:
    if page == 1:
        return "Konfiguration"
    return f"Block {page}" if page is not None else "Bereich"


def _page_from_region(region_id: str) -> int | None:
    match = re.fullmatch(r"(?:page|block|region)_(\d+)", region_id)
    return int(match.group(1)) if match else None


def _normalize_mode(mode: str) -> str:
    normalized = (mode or "auto").strip().lower()
    return normalized if normalized in {"auto", "lf", "hf"} else "auto"


def _plural(count: int, singular: str, plural: str) -> str:
    return singular if count == 1 else plural


def _slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value).strip().lower()).strip("-") or "item"


def _error(message: str) -> dict:
    return {"ok": False, "message": message, "error": message}
