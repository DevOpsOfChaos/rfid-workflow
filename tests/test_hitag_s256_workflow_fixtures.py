from pathlib import Path

from pm3_workflow_gui.pm3.parsers import (
    parse_hf_search,
    parse_hitag_s_rdbl,
    parse_hw_tune,
    parse_hw_version,
    parse_lf_search,
    parse_startup_banner,
)
from pm3_workflow_gui.pm3.session import Pm3LaunchConfig
from pm3_workflow_gui.workflows.discovery import DiscoveryInputs, summarize_discovery
from pm3_workflow_gui.workflows.hitag_s256 import (
    profile_from_hitag_s_read,
    verify_hitag_s256_profile,
)


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"
PROXMARK_ROOT = Path(r"C:\Tools\proxmark3")
CLIENT_DIR = PROXMARK_ROOT / "client"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_hf_no_tag_fixture_is_parsed_as_no_tag_found():
    result = parse_hf_search(fixture("hf_search_no_tag_found.txt"))

    assert result.status == "no_tag_found"


def test_lf_original_fixture_is_hitag_candidate_and_keeps_false_positive_notes():
    result = parse_lf_search(fixture("lf_search_hitag_s256_original.txt"))

    assert result.classification == "hitag_candidate"
    assert result.uid == "A1B2C3D4"
    assert result.tag_type == "PCF 7952"
    assert result.chipset == "Hitag 1/S / 82xx"
    assert result.hint == "Try `lf hitag hts` commands"
    assert any("Indala" in note for note in result.false_positive_notes)
    assert any("false positive" in note.lower() for note in result.false_positive_notes)


def test_lf_blank_fixture_is_hitag_candidate():
    result = parse_lf_search(fixture("lf_search_hitag_s256_blank.txt"))

    assert result.classification == "hitag_candidate"
    assert result.uid == "11223344"
    assert result.tag_type == "PCF 7945"


def test_original_rdbl_fixture_is_hitag_s256_plain_with_pages_0_to_7():
    read = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt"))

    assert read.is_hitag_s256_plain_no_auth
    assert read.memory_type == "Hitag S 256"
    assert read.authentication == "No"
    assert read.uid == "A1B2C3D4"
    assert read.config_page == "C92800AA"
    assert set(read.pages) == set(range(8))
    assert read.pages[4].data == "A410B420"
    assert read.pages[0].permission == "RO"


def test_blank_rdbl_fixture_detects_ttf_disabled_and_page_7_marker():
    read = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt"))

    assert read.is_hitag_s256_plain_no_auth
    assert read.uid == "11223344"
    assert read.ttf_data_rate == "4 kBit"
    assert read.ttf_mode == "TTF Mode disabled (= RTF Mode)"
    assert read.pages[7].data == "52445921"


def test_written_blank_rdbl_fixture_detects_written_config_and_ttf_pages():
    read = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt"))

    assert read.is_hitag_s256_plain_no_auth
    assert read.uid == "11223344"
    assert read.ttf_data_rate == "2 kBit"
    assert read.ttf_mode == "Page 4, Page 5, Page 6, Page 7"
    assert read.config_page == "C92800AA"
    assert read.pages[4].data == "A410B420"


def test_profile_from_original_sets_write_rules():
    original = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt"))
    profile = profile_from_hitag_s_read(original)

    assert profile.uid == "A1 B2 C3 D4"
    assert profile.write_uid is False
    assert profile.write_config_last is True
    assert profile.write_order == (4, 5, 6, 7, 1)
    assert profile.pages[1] == "C9 28 00 AA"


def test_verification_written_blank_vs_original_allows_uid_mismatch():
    original = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt"))
    written_blank = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_written_blank_pages_0_7.txt"))
    profile = profile_from_hitag_s_read(original)

    result = verify_hitag_s256_profile(written_blank, profile)

    assert result.success
    assert result.status == "verified_with_uid_mismatch"
    assert result.uid_matches is False
    assert result.mismatched_pages == ()
    assert result.missing_pages == ()


def test_verification_blank_vs_original_fails_on_config_and_pages_4_to_7():
    original = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt"))
    blank = parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_blank_pages_0_7.txt"))
    profile = profile_from_hitag_s_read(original)

    result = verify_hitag_s256_profile(blank, profile)

    assert not result.success
    assert result.status == "failed"
    assert set(result.mismatched_pages) == {1, 4, 5, 6, 7}


def test_discovery_service_summary_detects_hitag_s256_plain():
    inputs = DiscoveryInputs(
        launch_config=Pm3LaunchConfig(
            mode="client_setup_bash",
            proxmark_root=PROXMARK_ROOT,
            client_dir=CLIENT_DIR,
            com_port="COM16",
        ),
        startup_banner=parse_startup_banner(fixture("startup_banner_com16.txt")),
        hw_version=parse_hw_version(fixture("hw_version_pm3_generic.txt")),
        hw_tune=parse_hw_tune(fixture("hw_tune_ok_no_tag.txt")),
        hf_search=parse_hf_search(fixture("hf_search_no_tag_found.txt")),
        lf_search=parse_lf_search(fixture("lf_search_hitag_s256_original.txt")),
        hitag_read=parse_hitag_s_rdbl(fixture("lf_hitag_hts_rdbl_original_pages_0_7.txt")),
    )

    summary = summarize_discovery(inputs)

    assert summary.device_status == "connected"
    assert summary.pm3_model == "PM3 GENERIC"
    assert summary.lf_antenna_status == "OK"
    assert summary.hf_antenna_status == "OK"
    assert summary.tag_status == "hitag_s256"
    assert summary.summary == "Hitag S256 tag detected"
    assert summary.next_step == "Create template or verify target read-only"
