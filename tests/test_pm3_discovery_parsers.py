from pathlib import Path

from pm3_workflow_gui.pm3.commands import get_command
from pm3_workflow_gui.pm3.parsers import (
    parse_command_help,
    parse_hw_tune,
    parse_hw_version,
    parse_startup_banner,
)
from pm3_workflow_gui.pm3.risk import RiskLevel, classify_command


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parse_startup_banner_from_com16_fixture():
    banner = parse_startup_banner(fixture("startup_banner_com16.txt"))

    assert banner.com_port == "COM16"
    assert banner.target == "PM3 GENERIC"
    assert banner.client_version == "Iceman/master/v4.21611-321-gc7b95a94e 2026-05-31 00:48:46"
    assert banner.bootrom_version.endswith("9cb15bd3b")
    assert banner.os_version.endswith("9cb15bd3b")


def test_parse_hw_version_from_pm3_generic_fixture():
    version = parse_hw_version(fixture("hw_version_pm3_generic.txt"))

    assert version.client_version == "Iceman/master/v4.21611-321-gc7b95a94e-suspect 2026-05-31 00:48:46 9cb15bd3b"
    assert version.compiler == "MinGW-w64 16.1.0"
    assert version.platform == "Windows (64b) / x86_64"
    assert version.firmware == "PM3 GENERIC"
    assert version.bootrom.endswith("9cb15bd3b")
    assert version.os.endswith("9cb15bd3b")
    assert version.arm_compiler == "GCC 13.3.0"
    assert version.flash_usage_percent == 73
    assert version.lua_script_support == "present"
    assert version.python_script_support == "absent"


def test_parse_hw_tune_from_ok_no_tag_fixture():
    tune = parse_hw_tune(fixture("hw_tune_ok_no_tag.txt"))

    assert tune.lf_125khz_voltage == 20.21
    assert tune.lf_134_83khz_voltage == 13.34
    assert tune.lf_optimal_frequency_khz == 115.38
    assert tune.lf_optimal_voltage == 25.70
    assert tune.lf_frequency_bandwidth == 6.2
    assert tune.lf_peak_voltage == 7.5
    assert tune.lf_antenna_status == "ok"
    assert tune.hf_13_56mhz_voltage == 36.28
    assert tune.hf_peak_voltage == 10.5
    assert tune.hf_antenna_status == "ok"
    assert tune.rating == "OK"


def test_parse_command_help_reads_usage_options_and_registry_risk():
    hf_help = parse_command_help("hf search", fixture("hf_search_help.txt"))
    rdbl_help = parse_command_help("lf hitag hts rdbl", fixture("lf_hitag_hts_rdbl_help.txt"))
    dump_help = parse_command_help("lf hitag hts dump", fixture("lf_hitag_hts_dump_help.txt"))

    assert hf_help.usage == "hf search [-hv]"
    assert "-v, --verbose                  verbose output" in hf_help.options
    assert hf_help.risk == RiskLevel.READ_ONLY
    assert rdbl_help.usage.startswith("lf hitag hts rdbl")
    assert "-p, --page <dec>               page address to read from" in rdbl_help.options
    assert rdbl_help.risk == RiskLevel.READ_ONLY
    assert dump_help.usage.startswith("lf hitag hts dump")
    assert dump_help.risk == RiskLevel.READ_ONLY_WITH_FILE_OUTPUT


def test_parse_hitag_family_help_without_usage_keeps_registry_risk():
    help_text = parse_command_help("lf hitag hts", fixture("lf_hitag_hts_help.txt"))

    assert help_text.usage is None
    assert help_text.options == ()
    assert help_text.risk == RiskLevel.READ_ONLY


def test_hitag_command_registry_risk_levels_are_hardened():
    assert get_command("hitag_s256_write_block").risk == RiskLevel.WRITE
    assert get_command("hitag_s256_read_block").risk == RiskLevel.READ_ONLY
    assert get_command("hitag_s256_dump").risk == RiskLevel.READ_ONLY_WITH_FILE_OUTPUT
    assert get_command("hitag_s256_restore").risk == RiskLevel.HIGH_RISK_WRITE
    assert get_command("hitag_s256_sim").risk == RiskLevel.EMULATION


def test_advanced_auth_flags_are_not_auto_released_as_basic_read_only():
    assert classify_command("lf hitag hts rdbl --crypto") == RiskLevel.ADVANCED_AUTH
    assert classify_command("lf hitag hts rdbl -k 4F4E4D494B52") == RiskLevel.ADVANCED_AUTH
    assert classify_command("lf hitag hts rdbl --82xx") == RiskLevel.ADVANCED_AUTH
    assert classify_command("lf hitag hts rdbl --nrar 0011223344556677") == RiskLevel.ADVANCED_AUTH
