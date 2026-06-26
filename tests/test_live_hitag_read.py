from pathlib import Path

from pm3_workflow_gui.services.live_pm3_readonly import LiveCommandResult, LivePm3ReadonlyService


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_live_hitag_read_runs_reader_and_rdbl_only_after_lf_candidate():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, fixture("lf_search_hitag_s256_blank.txt"), "")
        if text.endswith(" -c lf hitag hts reader -@"):
            return LiveCommandResult(text, 0, "[+] UID.................... 11223344\n", "")
        if text.endswith(" -c lf hitag hts rdbl -p 0 -c 8"):
            return LiveCommandResult(text, 0, fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt"), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()

    assert result.success is True
    assert result.hitag_read.uid == "11223344"
    assert any("lf hitag hts reader -@" in call for call in calls)
    assert any("lf hitag hts rdbl -p 0 -c 8" in call for call in calls)


def test_live_hitag_read_requires_stable_lf_candidate_before_detail_read():
    calls = []
    lf_outputs = [
        fixture("lf_search_hitag_s256_blank.txt"),
        "[-] Couldn't identify a chipset\n",
        "[-] Couldn't identify a chipset\n",
    ]

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, lf_outputs.pop(0), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()

    assert result.status == "hitag_candidate_unstable"
    assert "nicht stabil lesbar" in result.message
    assert not any("lf hitag hts reader -@" in call for call in calls)
    assert not any("lf hitag hts rdbl" in call for call in calls)


def test_live_hitag_read_retries_detail_read_after_transient_uid_failure():
    rdbl_attempts = 0

    def runner(args, timeout):
        nonlocal rdbl_attempts
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, fixture("lf_search_hitag_s256_blank.txt"), "")
        if text.endswith(" -c lf hitag hts reader -@"):
            return LiveCommandResult(text, 0, "[+] UID.................... 11223344\n", "")
        if text.endswith(" -c lf hitag hts rdbl -p 0 -c 8"):
            rdbl_attempts += 1
            if rdbl_attempts == 1:
                return LiveCommandResult(text, 0, "[!] UID Request failed!\n", "")
            return LiveCommandResult(text, 0, fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt"), "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()

    assert result.success is True
    assert rdbl_attempts == 2
    assert result.hitag_read.uid == "11223344"


def test_live_hitag_read_does_not_run_hitag_commands_without_candidate():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, "[-] Couldn't identify a chipset\n", "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()

    assert result.status == "basic_detection"
    assert result.detected_technology.technology_id == "unknown_lf"
    assert not any("lf hitag hts reader -@" in call for call in calls)
    assert not any("lf hitag hts rdbl" in call for call in calls)


def test_live_hitag_read_uid_request_failed_stops_cleanly():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM16\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, fixture("lf_search_hitag_s256_blank.txt"), "")
        if text.endswith(" -c lf hitag hts reader -@"):
            return LiveCommandResult(text, 0, "[!] UID Request failed!\n", "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).read_hitag_s256()

    assert result.status == "uid_request_failed"
    assert "Chipposition" in result.message
    assert not any("lf hitag hts rdbl" in call for call in calls)
