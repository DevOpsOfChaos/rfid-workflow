from __future__ import annotations

import time
from pathlib import Path

from pm3_workflow_gui.pm3.parsers import HitagSPage, HitagSRead, parse_hitag_s_rdbl
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import TemplateRecord, save_template_record
from pm3_workflow_gui.services.live_pm3_readonly import (
    HitagS256LiveReadResult,
    HitagS256WriteResult,
    LiveCommandResult,
    Pm3HardwareCheck,
    Pm3StartupCheck,
    PositioningCheckResult,
)
from pm3_workflow_gui.technologies.registry import detect_technology
from pm3_workflow_gui.web_desktop.bridge import WebDesktopBridge


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"
TERMINAL = {"succeeded", "failed", "verification_failed", "connection_lost"}


class FakeService:
    def __init__(
        self,
        reads=(),
        connected: bool = True,
        write_result: HitagS256WriteResult | None = None,
        write_results=(),
        position_result: PositioningCheckResult | None = None,
        hardware_result: Pm3HardwareCheck | None = None,
    ) -> None:
        self.reads = list(reads)
        self.connected = connected
        self.write_result = write_result
        self.write_results = list(write_results)
        self.position_result = position_result
        self.hardware_result = hardware_result
        self.read_calls = 0
        self.write_calls = []
        self.position_calls = []
        self.hardware_calls = []

    def startup_check(self):
        if not self.connected:
            return Pm3StartupCheck(False, message="No Proxmark3 port found")
        return Pm3StartupCheck(True, "COM16", "PM3 Generic", "client", "Proxmark erkannt")

    def read_chip(self, port=None):
        self.read_calls += 1
        if not self.reads:
            raise AssertionError("unexpected read_chip call")
        return self.reads.pop(0)

    def write_hitag_s256_page(self, *args):
        self.write_calls.append(args)
        if self.write_results:
            return self.write_results.pop(0)
        if self.write_result is None:
            raise AssertionError("unexpected write call")
        return self.write_result

    def position_chip(self, *args, **kwargs):
        self.position_calls.append((args, kwargs))
        if self.position_result is None:
            raise AssertionError("unexpected position_chip call")
        return self.position_result

    def hardware_check(self, *args):
        self.hardware_calls.append(args)
        if self.hardware_result is None:
            raise AssertionError("unexpected hardware_check call")
        return self.hardware_result


def hitag_result(fixture_name: str) -> HitagS256LiveReadResult:
    read = parse_hitag_s_rdbl((FIXTURES / fixture_name).read_text(encoding="utf-8"))
    return HitagS256LiveReadResult(
        "hitag_s256_plain",
        "COM16",
        hitag_read=read,
        message="Hitag S256 gelesen",
        detected_technology=detect_technology(hitag_read=read),
    )


def device_lost_result() -> HitagS256LiveReadResult:
    return HitagS256LiveReadResult("device_lost", "COM16", message="Device lost")


def profile_from_fixture(fixture_name: str) -> HitagS256Profile:
    return HitagS256Profile.from_hitag_s_read(parse_hitag_s_rdbl((FIXTURES / fixture_name).read_text(encoding="utf-8")))


def hitag_result_from_profile(profile: HitagS256Profile) -> HitagS256LiveReadResult:
    pages = {
        page: HitagSPage(
            page,
            data,
            "RO" if page == 0 else "RW",
            "UID" if page == 0 else "Config" if page == 1 else "Data",
        )
        for page, data in profile.pages.items()
    }
    mode = "Page 4, Page 5, Page 6, Page 7" if profile.ttf_pages else "TTF Mode disabled (= RTF Mode)"
    read = HitagSRead(
        "Hitag S 256",
        "No",
        "Manchester",
        profile.ttf_data_rate,
        mode,
        "No",
        "No",
        pages,
        access_mode="plain",
    )
    return HitagS256LiveReadResult(
        "hitag_s256_plain",
        "COM16",
        hitag_read=read,
        message="Hitag S256 gelesen",
        detected_technology=detect_technology(hitag_read=read),
    )


def profile_with_updates(base: HitagS256Profile, updates: dict[int, str], target: HitagS256Profile) -> HitagS256Profile:
    pages = dict(base.pages)
    pages.update(updates)
    return HitagS256Profile(
        uid=base.uid,
        pages=pages,
        mode=base.mode,
        ttf_pages=target.ttf_pages,
        ttf_data_rate=target.ttf_data_rate,
        write_order=target.write_order,
    )


def write_result(page: int, old_value: str, new_value: str, verify_profile: HitagS256Profile, success: bool = True) -> HitagS256WriteResult:
    verification_value = verify_profile.pages.get(page)
    return HitagS256WriteResult(
        success,
        page,
        old_value,
        new_value,
        verification_value,
        "Schreiben verifiziert." if success else "Schreiben nicht verifiziert; Workflow gestoppt.",
        LiveCommandResult(f"lf hitag hts wrbl -p {page}", 0, "[+] done", ""),
        hitag_result_from_profile(verify_profile),
    )


def compact(value: str | None) -> str:
    return "".join((value or "").split()).upper()


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
    assert operation["result"]["chip"]["details"]["Status zweiter Scan"] == "confirmed"
    assert save_result["ok"] is True
    assert save_result["message"] == "Vorlage gespeichert"
    assert len(templates) == 1
    assert templates[0]["name"] == "Garage"
    assert len(list((tmp_path / "templates").glob("*.json"))) == 1


def test_scan_after_template_save_starts_fresh_operation_and_replaces_result(tmp_path):
    service = FakeService(
        reads=(
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
        )
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")

    first_operation_id = bridge.start_scan("auto")["operation_id"]
    first_operation = wait_for_operation(bridge, first_operation_id)
    save_result = bridge.save_template("Chip A", "", "")
    second_operation_id = bridge.start_scan("auto")["operation_id"]
    second_operation = wait_for_operation(bridge, second_operation_id)
    last_scan = bridge.get_last_scan()
    chip_b = profile_from_fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")

    assert first_operation_id != second_operation_id
    assert first_operation["state"] == "succeeded"
    assert second_operation["state"] == "succeeded"
    assert save_result["ok"] is True
    assert service.read_calls == 4
    assert last_scan["confirmed"] is True
    assert last_scan["chip"]["uid"] == compact(chip_b.uid)
    assert last_scan["chip"]["memoryRegions"][0]["value"] == compact(chip_b.pages[4])


def test_failed_second_scan_after_previous_success_does_not_reconfirm_old_chip(tmp_path):
    service = FakeService(
        reads=(
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
        )
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")

    wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])
    operation = wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])
    last_scan = bridge.get_last_scan()
    chip_b = profile_from_fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")

    assert operation["state"] == "succeeded"
    assert operation["result"]["canSave"] is False
    assert operation["result"]["second_scan_status"] == "mismatch"
    assert last_scan["confirmed"] is False
    assert last_scan["canSave"] is False
    assert last_scan["chip"]["uid"] == compact(chip_b.uid)
    assert last_scan["chip"]["memoryRegions"][0]["value"] == compact(chip_b.pages[4])


def test_scan_after_connection_lost_requires_successful_reconnection(tmp_path):
    service = FakeService(connected=False)
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")

    lost_operation = wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])
    disconnected = bridge.get_connection_state()
    stale_scan = bridge.get_last_scan()

    service.connected = True
    service.reads = [
        hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
        hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
    ]
    reconnected = bridge.refresh_connection()
    recovered_operation = wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])

    assert lost_operation["state"] == "connection_lost"
    assert disconnected["connected"] is False
    assert stale_scan["chip"] is None
    assert reconnected["connected"] is True
    assert recovered_operation["state"] == "succeeded"
    assert recovered_operation["result"]["confirmed"] is True


def test_template_save_does_not_block_followup_scan(tmp_path):
    service = FakeService(
        reads=(
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_original_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
            hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
        )
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")

    wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])
    save_result = bridge.save_template("Stored", "", "")
    operation = wait_for_operation(bridge, bridge.start_scan("auto")["operation_id"])

    assert save_result["ok"] is True
    assert operation["state"] == "succeeded"
    assert operation["result"]["confirmed"] is True
    assert service.read_calls == 4


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


def test_device_lost_invalidates_current_chip_and_backup(tmp_path):
    bridge = WebDesktopBridge(
        FakeService(
            reads=(
                hitag_result("lf_hitag_hts_rdbl_blank_pages_0_7.txt"),
                device_lost_result(),
            )
        ),
        template_dir=tmp_path / "templates",
        backup_dir=tmp_path / "backups",
    )

    wait_for_operation(bridge, bridge.start_current_chip_scan()["operation_id"])
    lost_operation = wait_for_operation(bridge, bridge.start_current_chip_scan()["operation_id"])
    current = bridge.get_current_chip()
    connection = bridge.get_connection_state()

    assert lost_operation["state"] == "connection_lost"
    assert connection["connected"] is False
    assert current["chip"] is None
    assert current["backup"] is None


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


def test_write_all_plans_open_hitag_regions_in_order_with_config_last(tmp_path):
    current_profile = profile_from_fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    target_profile = profile_from_fixture("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    page4 = profile_with_updates(current_profile, {4: target_profile.pages[4]}, target_profile)
    page45 = profile_with_updates(page4, {5: target_profile.pages[5]}, target_profile)
    page456 = profile_with_updates(page45, {6: target_profile.pages[6]}, target_profile)
    page4567 = profile_with_updates(page456, {7: target_profile.pages[7]}, target_profile)
    final = profile_with_updates(page4567, {1: target_profile.pages[1]}, target_profile)
    service = FakeService(
        reads=(hitag_result_from_profile(current_profile),),
        write_results=(
            write_result(4, current_profile.pages[4], target_profile.pages[4], page4),
            write_result(5, current_profile.pages[5], target_profile.pages[5], page45),
            write_result(6, current_profile.pages[6], target_profile.pages[6], page456),
            write_result(7, current_profile.pages[7], target_profile.pages[7], page4567),
            write_result(1, current_profile.pages[1], target_profile.pages[1], final),
        ),
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")
    template = TemplateRecord.from_hitag_s256_profile("Target", "", target_profile)
    save_template_record(template, tmp_path / "templates")

    wait_for_operation(bridge, bridge.start_current_chip_scan()["operation_id"])
    bridge.set_target_template(template.template_id)
    operation = wait_for_operation(bridge, bridge.start_write_all()["operation_id"])
    comparison = bridge.compare_current_to_target()["comparison"]

    assert operation["state"] == "succeeded"
    assert [args[0] for args in service.write_calls] == [4, 5, 6, 7, 1]
    assert operation["details"]["completed_regions"] == ["page_4", "page_5", "page_6", "page_7", "page_1"]
    assert comparison["actions"] == []


def test_write_all_stops_on_verification_failure_and_keeps_successful_steps(tmp_path):
    current_profile = profile_from_fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    target_profile = profile_from_fixture("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    page4 = profile_with_updates(current_profile, {4: target_profile.pages[4]}, target_profile)
    service = FakeService(
        reads=(hitag_result_from_profile(current_profile),),
        write_results=(
            write_result(4, current_profile.pages[4], target_profile.pages[4], page4),
            write_result(5, current_profile.pages[5], target_profile.pages[5], page4, success=False),
        ),
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")
    template = TemplateRecord.from_hitag_s256_profile("Target", "", target_profile)
    save_template_record(template, tmp_path / "templates")

    wait_for_operation(bridge, bridge.start_current_chip_scan()["operation_id"])
    bridge.set_target_template(template.template_id)
    operation = wait_for_operation(bridge, bridge.start_write_all()["operation_id"])
    comparison = bridge.compare_current_to_target()["comparison"]

    assert operation["state"] == "verification_failed"
    assert [args[0] for args in service.write_calls] == [4, 5]
    assert operation["details"]["completed_regions"] == ["page_4"]
    assert operation["details"]["failed_region"] == "page_5"
    assert "page_4" not in {action["region_id"] for action in comparison["actions"]}
    assert "page_5" in {action["region_id"] for action in comparison["actions"]}


def test_analysis_operations_return_real_position_and_hw_tune_payloads(tmp_path):
    hw_tune_output = (FIXTURES / "hw_tune_ok_no_tag.txt").read_text(encoding="utf-8")
    service = FakeService(
        position_result=PositioningCheckResult("no_signal", "COM16", "Kein Signal", next_step="Chip langsam bewegen."),
        hardware_result=Pm3HardwareCheck(
            True,
            "COM16",
            "ok",
            "ok",
            "LF/HF geprüft",
            LiveCommandResult("hw tune", 0, hw_tune_output, ""),
        ),
    )
    bridge = WebDesktopBridge(service, template_dir=tmp_path / "templates", backup_dir=tmp_path / "backups")

    position = wait_for_operation(bridge, bridge.start_position_check()["operation_id"])
    antenna = wait_for_operation(bridge, bridge.start_antenna_check()["operation_id"])

    assert position["state"] == "succeeded"
    assert position["result"]["position"]["status"] == "no_signal"
    assert service.position_calls
    assert antenna["state"] == "succeeded"
    assert antenna["result"]["antenna"]["lf"]["status"] == "ok"
    assert antenna["result"]["antenna"]["hf"]["voltage_13_56mhz"]
    assert service.hardware_calls
