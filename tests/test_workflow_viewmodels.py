from pathlib import Path

import pytest

from pm3_workflow_gui.pm3.parsers import parse_hitag_s_rdbl
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import load_template_record
from pm3_workflow_gui.services.live_pm3_readonly import LiveCommandResult, LivePm3ReadonlyService
from pm3_workflow_gui.ui.viewmodel import (
    build_write_plan_view_model,
    chip_read_view_model_from_live_result,
    chip_read_view_model_from_hitag_read,
    hardware_prep_from_check,
    save_confirmed_template,
    startup_view_model_from_check,
    unavailable_write_plan_view_model,
    validate_second_scan,
)


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def hitag_profile(name: str) -> HitagS256Profile:
    return chip_read_view_model_from_hitag_read(parse_hitag_s_rdbl(fixture(name))).profile


def test_startflow_view_model_pm3_found():
    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c hw version"):
            return LiveCommandResult(text, 0, fixture("hw_version_pm3_generic.txt"), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    check = LivePm3ReadonlyService(runner=runner).startup_check()
    model = startup_view_model_from_check(check)

    assert model.connected is True
    assert model.can_continue is True
    assert model.port == "COM16"
    assert "Proxmark erkannt" in model.message


def test_startflow_view_model_pm3_missing():
    service = LivePm3ReadonlyService(runner=lambda args, timeout: LiveCommandResult(" ".join(args), 1, "", "no port"))

    model = startup_view_model_from_check(service.startup_check())

    assert model.connected is False
    assert model.can_retry is True
    assert "USB" in model.message


def test_startflow_blocks_when_hw_version_fails_after_port_detection():
    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        return LiveCommandResult(text, 0, "", "")

    model = startup_view_model_from_check(LivePm3ReadonlyService(runner=runner).startup_check())

    assert model.connected is False
    assert model.can_continue is False
    assert model.can_retry is True


def test_hardware_check_ok_view_model():
    outputs = {
        "hw tune": fixture("hw_tune_ok_no_tag.txt"),
    }

    def runner(args, timeout):
        text = " ".join(args)
        if text.endswith(" -c hw tune"):
            return LiveCommandResult(text, 0, outputs["hw tune"], "")
        return LiveCommandResult(text, 1, "", "unexpected")

    check = LivePm3ReadonlyService(runner=runner).hardware_check("COM16")
    model = hardware_prep_from_check(check)

    assert model.ready is True
    assert model.lf_antenna_status == "ok"
    assert model.hf_antenna_status == "ok"
    assert model.diagram_available is True
    assert "LF-Positionsdiagramm" in model.diagram_message


def test_template_read_scan_1_scan_2_identical_and_save(tmp_path):
    first = chip_read_view_model_from_hitag_read(parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt")))
    second = chip_read_view_model_from_hitag_read(parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt")))

    validation = validate_second_scan(first, second)
    path = save_confirmed_template(validation, "Garagenchip Rohling", "Interne Vorlage", tmp_path)
    record = load_template_record(path)

    assert validation.can_save is True
    assert record.title == "Garagenchip Rohling"
    assert record.chip_type == "Hitag S256"
    assert record.technology == "LF"
    assert record.uid_reference == "FA F9 91 79"
    assert record.write_uid is False
    assert record.write_config_last is True
    assert record.supported_write_plan == (4, 5, 6, 7, 1)
    assert set(record.relevant_pages) == {4, 5, 6, 7}
    assert record.template_id.startswith("tmpl_")
    assert record.technology_id == "hitag_s256"
    assert record.technology_name == "Hitag S256"
    assert record.frequency == "lf"
    assert record.identity == {"uid": "FA F9 91 79"}
    assert record.capabilities["can_create_template"] is True
    assert record.capabilities["can_write"] is True
    assert record.write_policy == {"write_uid": False, "config_last": True}
    assert record.template_creation_allowed is True


def test_unstable_live_candidate_view_model_prompts_retry():
    lf_outputs = [
        fixture("lf_search_hitag_s256_blank.txt"),
        "[-] Couldn't identify a chipset\n",
        "[-] Couldn't identify a chipset\n",
    ]

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, lf_outputs.pop(0), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()
    model = chip_read_view_model_from_live_result(result)

    assert model.status == "retry"
    assert "nicht stabil" in model.message
    assert any(field.label == "UID" for field in model.fields)


def test_generic_hf_chip_view_model_blocks_template_and_write_plan():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c hf search"):
            return LiveCommandResult(text, 0, "[+] Valid ISO 14443-A tag found\n[+] UID: 04 A1 B2 C3\n[+] MIFARE Classic 1K\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, "[-] Couldn't identify a chipset\n", "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_chip()
    model = chip_read_view_model_from_live_result(result)
    plan = unavailable_write_plan_view_model(model)

    assert result.status == "basic_detection"
    assert result.detected_technology.technology_id == "mifare_classic"
    assert model.status == "read_requires_authorized_credentials"
    assert model.profile is None
    assert model.is_complete_template_read is False
    assert "berechtigte Schlüssel" in model.message
    assert plan.plan_steps == ()
    assert plan.disabled_actions == ()
    assert "noch nicht freigeschaltet" in plan.compatibility_message
    assert not any("lf hitag hts reader -@" in call for call in calls)
    assert not any("lf hitag hts rdbl" in call for call in calls)


def test_template_read_second_scan_mismatch_blocks_save(tmp_path):
    first = chip_read_view_model_from_hitag_read(parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt")))
    second = chip_read_view_model_from_hitag_read(parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt")))

    validation = validate_second_scan(first, second)

    assert validation.can_save is False
    assert validation.status == "mismatch"
    assert any(label == "UID" for label, _, _ in validation.differences)
    with pytest.raises(ValueError):
        save_confirmed_template(validation, "blocked", "", tmp_path)


def test_write_plan_uid_never_writable_and_config_last():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    blank = hitag_profile("lf_hitag_hts_rdbl_blank_pages_0_7.txt")

    plan = build_write_plan_view_model(blank, original)

    assert any(row.label == "UID" and row.state == "uid" for row in plan.rows)
    assert plan.plan_steps == (
        "1. Block 4 schreiben",
        "2. Block 5 schreiben",
        "3. Block 6 schreiben",
        "4. Block 7 schreiben",
        "5. Konfiguration schreiben",
    )
    assert plan.disabled_actions[-1].label == "Konfiguration schreiben"
    assert all(action.enabled for action in plan.disabled_actions)
    assert [action.page for action in plan.disabled_actions] == [4, 5, 6, 7, 1]


def test_write_plan_only_uid_mismatch_is_compatible():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    written_blank = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")

    plan = build_write_plan_view_model(written_blank, original)

    assert plan.compatible is True
    assert "nur UID" in plan.compatibility_message
    assert any("Nur UID" in line for line in plan.summary_lines)


def test_write_plan_reports_incompatible_target_chip():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    incompatible = HitagS256Profile(
        uid="D2 DF E4 94",
        pages={
            0: "D2 DF E4 94",
            1: "C9 00 00 AA",
            4: "00 00 00 00",
        },
        ttf_pages=(4, 5, 6, 7),
    )

    plan = build_write_plan_view_model(incompatible, original)

    assert plan.compatible is False
    assert any("Speicherumfang" in line for line in plan.summary_lines)
