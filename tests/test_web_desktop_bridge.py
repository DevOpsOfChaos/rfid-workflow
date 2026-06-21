from __future__ import annotations

import time
from pathlib import Path

from pm3_workflow_gui.pm3.parsers import parse_hitag_s_rdbl
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import TemplateRecord, save_template_record
from pm3_workflow_gui.services.live_pm3_readonly import (
    HitagS256LiveReadResult,
    HitagS256WriteResult,
    LiveCommandResult,
    Pm3StartupCheck,
)
from pm3_workflow_gui.technologies.registry import detect_technology
from pm3_workflow_gui.web_desktop.bridge import WebDesktopBridge


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"
TERMINAL = {"succeeded", "failed", "verification_failed", "connection_lost"}


class FakeService:
    def __init__(self, reads=(), connected: bool = True, write_result: HitagS256WriteResult | None = None) -> None:
        self.reads = list(reads)
        self.connected = connected
        self.write_result = write_result
        self.write_calls = []

    def startup_check(self):
        if not self.connected:
            return Pm3StartupCheck(False, message="No Proxmark3 port found")
        return Pm3StartupCheck(True, "COM16", "PM3 Generic", "client", "Proxmark erkannt")

    def read_chip(self, port=None):
        if not self.reads:
            raise AssertionError("unexpected read_chip call")
        return self.reads.pop(0)

    def write_hitag_s256_page(self, *args):
        self.write_calls.append(args)
        if self.write_result is None:
            raise AssertionError("unexpected write call")
        return self.write_result


def hitag_result(fixture_name: str) -> HitagS256LiveReadResult:
    read = parse_hitag_s_rdbl((FIXTURES / fixture_name).read_text(encoding="utf-8"))
    return HitagS256LiveReadResult(
        "hitag_s256_plain",
        "COM16",
        hitag_read=read,
        message="Hitag S256 gelesen",
        detected_technology=detect_technology(hitag_read=read),
    )


def profile_from_fixture(fixture_name: str) -> HitagS256Profile:
    return HitagS256Profile.from_hitag_s_read(parse_hitag_s_rdbl((FIXTURES / fixture_name).read_text(encoding="utf-8")))


def wait_for_operation(bridge: WebDesktopBridge, operation_id: str) -> dict:
    for _ in range(100):
        operation = bridge.get_operation_state(operation_id)
        if operation["state"] in TERMINAL:
            return operation
        time.sleep(0.01)
    raise AssertionError(f"operation did not finish: {operation_id}")


def test_refresh_connection_without_pm3_never_reports_connected(tmp_path):
    bridge = WebDesktopBridge(FakeService(connected=False), template_dir=tmp_path, backup_dir=tmp_path)

    state = bridge.refresh_connection()

    assert state["connected"] is False
    assert state["can_read"] is False
    assert state["can_write"] is False
    assert state["port"] is None


def test_scan_requires_matching_second_read_before_template_save(tmp_path):
    bridge = WebDesktopBridge(
        FakeService(
            reads=(
                hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
                hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
            )
        ),
        template_dir=tmp_path / "templates",
        backup_dir=tmp_path / "backups",
    )

    operation_id = bridge.start_scan("auto")["operation_id"]
    operation = wait_for_operation(bridge, operation_id)
    save_result = bridge.save_template("Should not save", "", "")

    assert operation["state"] == "succeeded"
    assert operation["result"]["canSave"] is False
    assert operation["result"]["second_scan_status"] == "mismatch"
    assert save_result["ok"] is False
    assert not (tmp_path / "templates").exists()


def test_confirmed_scan_saves_template_after_storage_write(tmp_path):
    bridge = WebDesktopBridge(
        FakeService(
            reads=(
                hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
                hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            )
        ),
        template_dir=tmp_path / "templates",
        backup_dir=tmp_path / "backups",
    )

    operation_id = bridge.start_scan("auto")["operation_id"]
    operation = wait_for_operation(bridge, operation_id)
    save_result = bridge.save_template("Garage", "Master", "Zugang")
    templates = bridge.list_templates()["templates"]

    assert operation["result"]["canSave"] is True
    assert save_result["ok"] is True
    assert save_result["message"] == "Vorlage gespeichert"
    assert len(templates) == 1
    assert templates[0]["name"] == "Garage"
    assert len(list((tmp_path / "templates").glob("*.json"))) == 1


def test_current_chip_scan_creates_real_backup_after_complete_read(tmp_path):
    bridge = WebDesktopBridge(
        FakeService(reads=(hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),)),
        template_dir=tmp_path / "templates",
        backup_dir=tmp_path / "backups",
    )

    operation_id = bridge.start_current_chip_scan()["operation_id"]
    operation = wait_for_operation(bridge, operation_id)
    backups = bridge.list_backups()["backups"]

    assert operation["state"] == "succeeded"
    assert operation["result"]["backup"] is not None
    assert operation["result"]["message"] == "Backup erstellt"
    assert len(backups) == 1
    assert len(list((tmp_path / "backups").glob("*.json"))) == 1


def test_write_success_requires_reread_verification_and_uid_is_not_action(tmp_path):
    current = hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    target_profile = profile_from_fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    current_profile = profile_from_fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    verify_result = hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    write_result = HitagS256WriteResult(
        False,
        4,
        current_profile.pages[4],
        target_profile.pages[4],
        current_profile.pages[4],
        "Schreiben nicht verifiziert; Workflow gestoppt.",
        LiveCommandResult("lf hitag hts wrbl -p 4 -d FFF80697", 0, "[+] done", ""),
        verify_result,
    )
    service = FakeService(reads=(current,), write_result=write_result)
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")
    template = TemplateRecord.from_hitag_s256_profile("Target", "", target_profile)
    save_template_record(template, tmp_path / "templates")

    wait_for_operation(bridge, bridge.start_current_chip_scan()["operation_id"])
    bridge.set_target_template(template.template_id)
    comparison = bridge.compare_current_to_target()["comparison"]
    operation = wait_for_operation(bridge, bridge.start_write_region("page_4")["operation_id"])

    assert "page_0" not in {action["region_id"] for action in comparison["actions"]}
    assert operation["state"] == "verification_failed"
    assert service.write_calls
