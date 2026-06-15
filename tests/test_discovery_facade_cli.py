from pathlib import Path
import subprocess
import sys

from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
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
    assert summary.com_port == "COM16"
    assert summary.target == "PM3 GENERIC"
    assert summary.firmware == "PM3 GENERIC"
    assert summary.lf_antenna_status == "ok"
    assert summary.hf_antenna_status == "ok"
    assert summary.tag_frequency_guess == "lf"
    assert summary.tag_type_guess == "hitag_s256_plain"
    assert "profile" in summary.recommended_next_step.lower()
    assert "verify" in summary.recommended_next_step.lower()


def test_facade_blank_before_write_reports_write_plan_required():
    summary = facade().summarize_scenario(load_scenario(SCENARIOS / "hitag_s256_blank_before_write.json"))

    assert summary.tag_type_guess == "hitag_s256_plain"
    assert summary.verification_status == "failed"
    assert "compatible-written" not in " ".join(summary.risk_notes).lower()
    assert any("Config/TTF differ from profile" in note for note in summary.risk_notes)
    assert "write plan required" in summary.recommended_next_step.lower()


def test_facade_blank_after_write_verifies_with_uid_mismatch():
    summary = facade().summarize_scenario(load_scenario(SCENARIOS / "hitag_s256_blank_after_write.json"))

    assert summary.tag_type_guess == "hitag_s256_plain"
    assert summary.verification_status == "verified_with_uid_mismatch"
    assert any("UID mismatch" in note for note in summary.risk_notes)


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
