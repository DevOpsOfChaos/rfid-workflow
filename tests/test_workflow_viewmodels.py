from pathlib import Path

import pytest

from pm3_workflow_gui.pm3.parsers import parse_hitag_s_rdbl, parse_lf_search
from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import load_template_record
from pm3_workflow_gui.services.live_pm3_readonly import HitagS256LiveReadResult, LiveCommandResult, LivePm3ReadonlyService
from pm3_workflow_gui.technologies.registry import detect_technology
from pm3_workflow_gui.ui.viewmodel import (
    build_write_plan_view_model,
    capability_matrix_view_model,
    chip_read_view_model_from_live_result,
    chip_read_view_model_from_hitag_read,
    expert_navigation_items,
    expert_tools_view_model,
    hardware_prep_from_check,
    normal_navigation_items,
    save_confirmed_template,
    startup_view_model_from_check,
    unavailable_write_plan_view_model,
    validate_second_scan,
    write_activation_view_model,
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
    assert model.diagram_available is False
    assert "kein separates PM3-/Qt-Fenster" in model.diagram_message


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
    assert record.uid_reference == "A1 B2 C3 D4"
    assert record.write_uid is False
    assert record.write_config_last is True
    assert record.supported_write_plan == (4, 5, 6, 7, 1)
    assert set(record.relevant_pages) == {1, 2, 3, 4, 5, 6, 7}
    assert record.template_scope == "full_profile"
    assert record.profile.template_scope == "full_profile"
    assert record.template_id.startswith("tmpl_")
    assert record.technology_id == "hitag_s256"
    assert record.technology_name == "Hitag S256"
    assert record.frequency == "lf"
    assert record.identity == {"uid": "A1 B2 C3 D4"}
    assert record.capabilities["can_create_template"] is True
    assert record.capabilities["can_write"] is True
    assert record.write_policy == {
        "write_uid": False,
        "config_last": True,
        "uid_policy": "reference_only",
        "template_scope": "full_profile",
    }
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

    assert model.status == "signal_unstable"
    assert "nicht stabil" in model.message
    assert any(field.label == "Signal" and field.value == "vorhanden" for field in model.fields)


def test_stable_hitag_uid_with_failed_detail_read_is_identity_read_not_unstable():
    lf_search = parse_lf_search(
        "[+] UID....... 927C9C8E\n"
        "[+] TYPE...... n/a\n"
        "[+] Chipset... Hitag 1/S / 82xx\n"
        "[?] Hint: Try `lf hitag hts` commands\n"
    )
    result = HitagS256LiveReadResult(
        "unsupported_hitag",
        "COM16",
        lf_search=lf_search,
        message="Dieser Chiptyp wurde erkannt, liefert aber keinen vollständigen Vorlagen-Read.",
        detected_technology=detect_technology(lf_search=lf_search),
    )

    model = chip_read_view_model_from_live_result(result)
    plan = unavailable_write_plan_view_model(model)

    assert model.status == "identity_read"
    assert model.title == "Chip gelesen"
    assert model.read_status == "identity_read"
    assert model.profile is None
    assert model.is_complete_template_read is False
    assert any(field.label == "UID" and field.value == "927C9C8E" for field in model.fields)
    assert model.memory_sections == ()
    assert "vollständige Vorlage" in " ".join(model.warnings)
    assert plan.disabled_actions == ()


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
    assert "bekannte Zugangsdaten" in model.message
    assert plan.plan_steps == ()
    assert plan.disabled_actions == ()
    assert "bekannte Zugangsdaten" in plan.compatibility_message
    assert not any("lf hitag hts reader -@" in call for call in calls)
    assert not any("lf hitag hts rdbl" in call for call in calls)


def test_indala_false_positive_does_not_start_indala_adapter_and_prompts_retry():
    calls = []
    lf_outputs = [
        "[=] Odd size,  false positive?\n[+] Indala (len 151)  Raw: 800000000000000000000000000000000003ffffc000000000000000\n",
        "[=] Odd size,  false positive?\n[+] Indala (len 200)  Raw: 800000000000000000000000000000000000000000000001ffffe000\n",
    ]

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c hf search"):
            return LiveCommandResult(text, 0, "[!] No known/supported 13.56 MHz tags found\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, lf_outputs.pop(0), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_chip("COM16")
    model = chip_read_view_model_from_live_result(result)
    plan = unavailable_write_plan_view_model(model)

    assert result.status == "signal_unstable"
    assert result.detected_technology is None
    assert result.scan_evidence.state == "signal_detected_but_ambiguous"
    assert model.title == "Chip-Signal gefunden"
    assert model.status == "signal_unstable"
    assert model.profile is None
    assert model.is_complete_template_read is False
    assert any(field.label == "Chipfamilie" and field.value == "nicht stabil bestimmt" for field in model.fields)
    assert model.public_configuration == ()
    combined_text = " ".join([model.message, model.next_step, plan.compatibility_message, *model.warnings])
    assert "Unbekannter LF-Chip" not in combined_text
    assert "Indala" not in combined_text
    assert "Hitag" not in combined_text
    assert plan.plan_steps == ()
    assert plan.disabled_actions == ()
    assert not any("lf indala reader" in call for call in calls)
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


def test_write_activation_ready_when_template_target_differences_and_authorization_present():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    blank = hitag_profile("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    plan = build_write_plan_view_model(blank, original)

    activation = write_activation_view_model(
        template_selected=True,
        target_scanned=True,
        authorized=True,
        plan=plan,
    )

    assert activation.write_ready is True
    assert "Schreibmodus aktiv" in activation.reason
    assert plan.writable_difference_count == 5
    assert all(action.enabled for action in plan.disabled_actions)


def test_write_activation_reports_missing_template_target_authorization_and_differences():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    blank = hitag_profile("lf_hitag_hts_rdbl_blank_pages_0_7.txt")
    changed_plan = build_write_plan_view_model(blank, original)
    matching_values_with_other_uid = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    no_write_plan = build_write_plan_view_model(matching_values_with_other_uid, original)

    no_template = write_activation_view_model(False, True, True, changed_plan)
    no_target = write_activation_view_model(True, False, True, changed_plan)
    no_authorization = write_activation_view_model(True, True, False, changed_plan)
    no_differences = write_activation_view_model(True, True, True, no_write_plan)

    assert no_template.write_ready is False
    assert "Vorlage" in no_template.reason
    assert no_target.write_ready is False
    assert "Zielchip" in no_target.reason
    assert no_authorization.write_ready is False
    assert "Schreibmodus aktivieren" in no_authorization.reason
    assert no_differences.write_ready is False
    assert "Keine schreibbaren Unterschiede" in no_differences.reason


def test_write_plan_comparison_shows_current_template_values_and_uid_reference():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    blank = hitag_profile("lf_hitag_hts_rdbl_blank_pages_0_7.txt")

    plan = build_write_plan_view_model(blank, original)
    rows = {row.label: row for row in plan.rows}

    assert rows["UID"].current_value == "11223344"
    assert rows["UID"].template_value == "A1B2C3D4"
    assert rows["UID"].state == "uid"
    assert "nicht schreibbar" in rows["UID"].note
    assert rows["Block 4"].current_value == "00000000"
    assert rows["Block 4"].template_value == "A410B420"
    assert rows["Block 4"].state == "different"


def test_write_plan_omits_actions_for_already_equal_areas():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    matching_values_with_other_uid = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")

    plan = build_write_plan_view_model(matching_values_with_other_uid, original)

    assert plan.compatible is True
    assert plan.writable_difference_count == 0
    assert plan.disabled_actions == ()
    assert plan.plan_steps == ()


def test_write_plan_only_uid_mismatch_is_compatible():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    written_blank = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")

    plan = build_write_plan_view_model(written_blank, original)

    assert plan.compatible is True
    assert plan.compatibility_message == "Vorlage bereit"
    assert any("Nur UID" in line for line in plan.summary_lines)
    assert plan.disabled_actions == ()


def test_write_plan_reports_incompatible_target_chip():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    incompatible = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 00 00 AA",
            4: "00 00 00 00",
        },
        ttf_pages=(4, 5, 6, 7),
    )

    plan = build_write_plan_view_model(incompatible, original)

    assert plan.compatible is False
    assert any("Erforderliche Page ist nicht schreibbar" in line for line in plan.summary_lines)


def test_write_plan_allows_individual_config_when_full_target_is_incomplete():
    original = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    partial_current = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 00 00 AA",
            4: "00 00 00 00",
        },
        ttf_pages=(4, 5, 6, 7),
    )

    plan = build_write_plan_view_model(partial_current, original)
    actions = {action.page: action for action in plan.disabled_actions}

    assert plan.compatible is False
    assert actions[1].enabled is True
    assert actions[4].enabled is True
    assert actions[5].enabled is False
    assert actions[6].enabled is False
    assert actions[7].enabled is False
    assert plan.writable_difference_count == 2


def test_partial_update_allows_page_1_when_page_2_or_3_is_missing_or_different():
    current = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "00 00 00 01",
            4: "10 10 10 10",
        },
        template_scope="partial_update",
    )
    template = HitagS256Profile(
        uid="AA BB CC DD",
        pages={
            0: "AA BB CC DD",
            1: "00 00 00 02",
            2: "22 22 22 22",
        },
        template_scope="partial_update",
    )

    plan = build_write_plan_view_model(current, template)
    actions = {action.page: action for action in plan.disabled_actions}

    assert actions[1].enabled is True
    assert 2 not in actions
    assert plan.writable_difference_count == 1


def test_managed_template_without_pages_2_and_3_is_valid_and_ignores_target_extras():
    current_pages = {
        0: "11 22 33 44",
        1: "C9 28 00 AA",
        2: "22 22 22 22",
        3: "33 33 33 33",
        4: "A4 10 B4 20",
        5: "C5 30 D5 40",
        6: "E6 50 F6 60",
        7: "00 00 00 00",
    }
    template_pages = {page: current_pages[page] for page in (0, 1, 4, 5, 6, 7)}
    current = HitagS256Profile(uid="11 22 33 44", pages=current_pages, template_scope="full_profile")
    template = HitagS256Profile(uid="11 22 33 44", pages=template_pages, template_scope="full_profile")

    plan = build_write_plan_view_model(current, template)
    rows = {row.page: row for row in plan.page_matrix}

    assert plan.compatible is True
    assert plan.equivalence_status_key == "write.equivalence.verified"
    assert rows[2].included_in_profile is False
    assert rows[3].included_in_profile is False
    assert plan.writable_difference_count == 0


def test_managed_template_blocks_when_required_page_is_missing_on_target():
    template = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 28 00 AA",
            4: "A4 10 B4 20",
            5: "C5 30 D5 40",
        },
        template_scope="full_profile",
    )
    current = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 28 00 AA",
            4: "A4 10 B4 20",
        },
        template_scope="full_profile",
    )

    plan = build_write_plan_view_model(current, template)
    page5 = next(row for row in plan.page_matrix if row.page == 5)

    assert plan.compatible is False
    assert page5.included_in_profile is True
    assert page5.present_on_target is False
    assert plan.equivalence_status_key == "write.equivalence.requiredPageNotWritable"


def test_managed_template_plans_writable_difference_without_pages_2_and_3():
    template = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 28 00 AA",
            4: "A4 10 B4 20",
            5: "C5 30 D5 40",
        },
        template_scope="full_profile",
    )
    current = HitagS256Profile(
        uid="11 22 33 44",
        pages={
            0: "11 22 33 44",
            1: "C9 28 00 AA",
            4: "00 00 00 00",
            5: "C5 30 D5 40",
        },
        template_scope="full_profile",
    )

    plan = build_write_plan_view_model(current, template)
    actions = {action.page: action for action in plan.disabled_actions}

    assert plan.compatible is True
    assert actions[4].enabled is True
    assert 2 not in actions
    assert 3 not in actions


def test_full_profile_detects_page_2_difference_and_blocks_full_equivalence_when_not_writable():
    current = hitag_profile("lf_hitag_hts_rdbl_original_pages_0_7.txt")
    template_pages = dict(current.pages)
    template_pages[2] = "22 22 22 22"
    template = HitagS256Profile(
        uid=current.uid,
        pages=template_pages,
        template_scope="full_profile",
        uid_policy="reference_only",
        ttf_pages=current.ttf_pages,
    )

    plan = build_write_plan_view_model(current, template)
    page2 = next(row for row in plan.page_matrix if row.page == 2)

    assert page2.different is True
    assert page2.write_supported is False
    assert plan.compatible is False
    assert plan.equivalence_status_key == "write.equivalence.requiredPageNotWritable"


def test_page_0_is_never_part_of_a_write_plan():
    current = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    template_pages = dict(current.pages)
    template_pages[0] = "AA BB CC DD"
    template = HitagS256Profile(
        uid="AA BB CC DD",
        pages=template_pages,
        template_scope="full_profile",
        uid_policy="must_match",
        ttf_pages=current.ttf_pages,
    )

    plan = build_write_plan_view_model(current, template)

    assert all(action.page != 0 for action in plan.disabled_actions)
    assert next(row for row in plan.page_matrix if row.page == 0).write_allowed_for_this_plan is False


def test_uid_policy_reference_only_allows_payload_equivalence_with_uid_difference():
    current = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    template_pages = dict(current.pages)
    template_pages[0] = "AA BB CC DD"
    template = HitagS256Profile(
        uid="AA BB CC DD",
        pages=template_pages,
        template_scope="full_profile",
        uid_policy="reference_only",
        ttf_pages=current.ttf_pages,
    )

    plan = build_write_plan_view_model(current, template)

    assert plan.compatible is True
    assert plan.equivalence_status_key == "write.equivalence.verifiedUidReference"
    assert plan.writable_difference_count == 0


def test_uid_policy_must_match_blocks_full_equivalence_with_uid_difference():
    current = hitag_profile("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt")
    template_pages = dict(current.pages)
    template_pages[0] = "AA BB CC DD"
    template = HitagS256Profile(
        uid="AA BB CC DD",
        pages=template_pages,
        template_scope="full_profile",
        uid_policy="must_match",
        ttf_pages=current.ttf_pages,
    )

    plan = build_write_plan_view_model(current, template)

    assert plan.compatible is False
    assert plan.equivalence_status_key == "write.equivalence.uidMismatch"


def test_mode_navigation_separates_normal_and_expert_workflows():
    assert normal_navigation_items() == ("Vorlage", "Schreiben", "Analyse")
    assert expert_navigation_items() == ("Technologien", "Werkzeuge", "Vorlagen & Dumps", "Analyse", "Protokoll")


def test_capability_matrix_is_generated_from_adapters():
    rows = {row.technology_id: row for row in capability_matrix_view_model()}

    assert rows["hitag_s256"].write.state == "available"
    assert rows["mifare_classic"].detail_read.state == "requires_known_credentials"
    assert rows["em410x"].write.state == "unavailable"
    assert rows["t5577"].detail_read.state == "available"
    assert rows["unknown_lf_hf"].detail_read.state == "not_implemented_yet"


def test_hitag_s256_expert_tools_show_full_structured_functions():
    tools = {tool.action: tool for tool in expert_tools_view_model("hitag_s256")}

    assert tools["detect"].state == "available"
    assert tools["read_memory"].label == "Details lesen"
    assert tools["write_memory"].state == "available"
    assert tools["restore_memory"].label == "Speicher wiederherstellen"
    assert tools["emulate"].label == "Emulation vorbereiten"
    assert tools["analyse_signal"].state == "available"


def test_generic_unknown_adapter_explains_missing_detail_adapter_with_technical_state():
    tools = {tool.action: tool for tool in expert_tools_view_model("unknown_lf_hf")}
    text = " ".join(tool.explanation for tool in tools.values())

    assert tools["read_memory"].state == "not_implemented_yet"
    assert "noch kein Adapter implementiert" in tools["read_memory"].explanation
    assert "noch kein Adapter implementiert" in text
    assert "nicht implementiert" in tools["read_memory"].state_label
