from pathlib import Path
import subprocess
import sys

from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
    DiscoveryTextInputs,
    default_launch_config,
    load_scenario,
)


SCENARIOS = Path(__file__).parent / "fixtures" / "scenarios"
PM3_FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def facade() -> DiscoveryFacade:
    return DiscoveryFacade(default_launch_config())


def test_facade_original_scenario_builds_ui_summary():
    summary = facade().summarize_scenario(load_scenario(SCENARIOS / "hitag_s256_original_discovery.json"))

    assert summary.connected != "false"
    assert summary.session_status == "ok"
    assert summary.device_reconnect_required is False
    assert summary.com_port == "COM16"
    assert summary.target == "PM3 GENERIC"
    assert summary.firmware == "PM3 GENERIC"
    assert summary.lf_antenna_status == "ok"
    assert summary.hf_antenna_status == "ok"
    assert summary.discovery_data_status == "captured"
    assert summary.tag_frequency_guess == "lf"
    assert summary.tag_type_guess == "hitag_s256"
    assert "vorlage" in summary.recommended_next_step.lower()
    assert "vergleichen" in summary.recommended_next_step.lower()


def test_default_launch_config_prefers_auto_port_but_facade_reads_banner_port():
    config = default_launch_config()
    summary = DiscoveryFacade(config).summarize_scenario(
        load_scenario(SCENARIOS / "hitag_s256_original_discovery.json")
    )

    assert config.com_port is None
    assert config.planned_command() == [
        "cmd.exe",
        "/k",
        r"cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3",
    ]
    assert summary.launch_mode == "client_setup_bash"
    assert summary.com_port == "COM16"


def test_facade_blank_before_write_reports_write_plan_required():
    summary = facade().summarize_scenario(load_scenario(SCENARIOS / "hitag_s256_blank_before_write.json"))

    assert summary.tag_type_guess == "hitag_s256"
    assert summary.verification_status == "failed"
    assert "compatible-written" not in " ".join(summary.risk_notes).lower()
    assert any("Config/TTF differ from profile" in note for note in summary.risk_notes)
    assert "write plan required" in summary.recommended_next_step.lower()


def test_facade_blank_after_write_verifies_with_uid_mismatch():
    summary = facade().summarize_scenario(load_scenario(SCENARIOS / "hitag_s256_blank_after_write.json"))

    assert summary.tag_type_guess == "hitag_s256"
    assert summary.verification_status == "verified_with_uid_mismatch"
    assert any("UID mismatch" in note for note in summary.risk_notes)


def test_facade_reports_generic_hf_chip_with_basic_support():
    summary = facade().summarize_texts(
        DiscoveryTextInputs(
            hf_search="[+] Valid ISO 14443-A tag found\n[+] UID: 04 A1 B2 C3\n[+] MIFARE Classic 1K\n",
            lf_search="[-] Couldn't identify a chipset\n",
        )
    )

    assert summary.tag_frequency_guess == "hf"
    assert summary.tag_type_guess == "mifare_classic"
    assert summary.support_level == "basic_detection"
    assert "noch nicht verfügbar" in summary.recommended_next_step


def test_facade_reports_unknown_lf_chip_with_basic_support():
    summary = facade().summarize_texts(
        DiscoveryTextInputs(
            hf_search="[!] No known/supported 13.56 MHz tags found\n",
            lf_search="[-] Couldn't identify a chipset\n",
        )
    )

    assert summary.tag_frequency_guess == "lf"
    assert summary.tag_type_guess == "unknown_lf"
    assert summary.detected_technology.technology_name == "Unbekannter LF-Chip"
    assert summary.support_level == "basic_detection"


def test_cli_fixture_summary_outputs_compact_diagnostics():
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pm3_workflow_gui.cli",
            "fixture-summary",
            "--fixture-dir",
            str(PM3_FIXTURES),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "COM16" in completed.stdout
    assert "PM3 GENERIC" in completed.stdout
    assert "LF antenna: ok" in completed.stdout
    assert "HF antenna: ok" in completed.stdout
    assert "Hitag S256" in completed.stdout
