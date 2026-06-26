import pytest

from pm3_workflow_gui.profiles.schema import HitagS256Profile
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
