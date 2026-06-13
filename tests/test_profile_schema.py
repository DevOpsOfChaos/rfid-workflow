import pytest

from pm3_workflow_gui.profiles.schema import HitagS256Profile
from pm3_workflow_gui.workflows.hitag_s256 import build_safe_write_plan


KNOWN_PAGES = {
    0: "FA F9 91 79",
    1: "C9 28 00 AA",
    2: "48 54 4F 4E",
    3: "4D 49 4B 52",
    4: "FF F8 06 97",
    5: "8C 66 C1 80",
    6: "03 6E F7 00",
    7: "00 00 00 00",
}


def test_hitag_s256_profile_accepts_known_plain_profile():
    profile = HitagS256Profile(uid="fa f9 91 79", pages=KNOWN_PAGES)
    assert profile.uid == "FA F9 91 79"
    assert profile.writable_data_pages == (4, 5, 6, 7)


def test_hitag_s256_profile_rejects_uid_page_mismatch():
    pages = dict(KNOWN_PAGES)
    pages[0] = "00 00 00 00"
    with pytest.raises(ValueError, match="UID must match"):
        HitagS256Profile(uid="FA F9 91 79", pages=pages)


def test_write_plan_writes_config_last_and_never_uid():
    profile = HitagS256Profile(uid="FA F9 91 79", pages=KNOWN_PAGES)
    plan = build_safe_write_plan(profile)
    commands = [step.command_template for step in plan if step.command_template]
    write_commands = [command for command in commands if "wrbl" in command]
    assert all("--page 0" not in command for command in write_commands)
    assert write_commands[-1] == "lf hitag hts wrbl --page 1 --data C9 28 00 AA"
