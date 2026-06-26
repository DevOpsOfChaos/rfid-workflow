import json

import pytest

from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.profiles.storage import load_template_record, save_template_record, TemplateRecord
from pm3_workflow_gui.workflows.hitag_s256 import build_hitag_s256_write_plan


KNOWN_PAGES = {
    0: "A1 B2 C3 D4",
    1: "C9 28 00 AA",
    2: "44 45 4D 4F",
    3: "54 45 53 54",
    4: "A4 10 B4 20",
    5: "C5 30 D5 40",
    6: "E6 50 F6 60",
    7: "00 00 00 00",
}


def test_hitag_s256_profile_accepts_known_plain_profile():
    profile = HitagS256Profile(uid="a1 b2 c3 d4", pages=KNOWN_PAGES)
    assert profile.uid == "A1 B2 C3 D4"
    assert profile.writable_data_pages == (4, 5, 6, 7)
    assert profile.is_complete_snapshot is True
    assert profile.can_be_full_profile_template is True


def test_hitag_s256_profile_missing_page_2_or_3_keeps_managed_template_scope():
    pages = dict(KNOWN_PAGES)
    pages.pop(2)
    profile = HitagS256Profile(uid="A1 B2 C3 D4", pages=pages)

    assert profile.is_complete_snapshot is False
    assert profile.can_be_full_profile_template is True
    assert profile.managed_pages == (1, 3, 4, 5, 6, 7)
    assert profile.equivalence_pages == (1, 3, 4, 5, 6, 7)
    assert profile.missing_expected_pages == (2,)


def test_hitag_s256_profile_missing_managed_page_is_partial_snapshot_but_valid_template_source():
    pages = dict(KNOWN_PAGES)
    pages.pop(5)
    profile = HitagS256Profile(uid="A1 B2 C3 D4", pages=pages)

    assert profile.is_complete_snapshot is False
    assert profile.can_be_full_profile_template is True
    assert profile.missing_expected_pages == (5,)


def test_full_profile_template_saves_and_loads_only_managed_pages(tmp_path):
    pages = {page: KNOWN_PAGES[page] for page in (0, 1, 4, 5, 6, 7)}
    profile = HitagS256Profile(uid="A1 B2 C3 D4", pages=pages)
    record = TemplateRecord.from_hitag_s256_profile("Synthetic", "", profile)

    path = save_template_record(record, tmp_path)
    loaded = load_template_record(path)

    assert loaded.template_scope == "full_profile"
    assert loaded.profile.template_scope == "full_profile"
    assert set(loaded.profile.pages) == {0, 1, 4, 5, 6, 7}
    assert set(loaded.relevant_pages) == {1, 4, 5, 6, 7}
    assert 2 not in loaded.profile.pages
    assert 3 not in loaded.profile.pages


def test_legacy_template_without_scope_loads_as_legacy_partial(tmp_path):
    payload = {
        "title": "Legacy",
        "profile": {
            "uid": "A1 B2 C3 D4",
            "pages": {str(page): value for page, value in KNOWN_PAGES.items()},
        },
    }
    path = tmp_path / "legacy.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    loaded = load_template_record(path)

    assert loaded.template_scope == "legacy_partial"
    assert loaded.profile.template_scope == "legacy_partial"
    assert loaded.profile.managed_pages == (1, 2, 3, 4, 5, 6, 7)


def test_hitag_s256_profile_rejects_uid_page_mismatch():
    pages = dict(KNOWN_PAGES)
    pages[0] = "00 00 00 00"
    with pytest.raises(ValueError, match="UID must match"):
        HitagS256Profile(uid="A1 B2 C3 D4", pages=pages)


def test_write_plan_writes_config_last_and_never_uid():
    profile = HitagS256Profile(uid="A1 B2 C3 D4", pages=KNOWN_PAGES)
    plan = build_hitag_s256_write_plan(profile)
    commands = [step.command_template for step in plan if step.command_template]
    write_commands = [command for command in commands if "wrbl" in command]
    assert all("--page 0" not in command for command in write_commands)
    assert write_commands[-1] == "lf hitag hts wrbl --page 1 --data C9 28 00 AA"
