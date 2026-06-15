from pathlib import Path
import os
import subprocess
import sys
import time

from pm3_workflow_gui.services.capture import (
    InteractivePm3Provider,
    Pm3LogCaptureProvider,
    latest_log_file,
    split_pm3_log_commands,
)
from pm3_workflow_gui.services.discovery_facade import DiscoveryFacade, default_launch_config


PM3_FIXTURES = Path(__file__).parent / "fixtures" / "pm3"
SCENARIOS = Path(__file__).parent / "fixtures" / "scenarios"
SAMPLE_LOG = PM3_FIXTURES / "session_log_discovery_sample.txt"
HELP_ONLY_LOG = PM3_FIXTURES / "session_log_help_only_real.txt"


def test_log_splitting_recognizes_commands_and_keeps_latest_outputs():
    outputs = split_pm3_log_commands(SAMPLE_LOG.read_text(encoding="utf-8"))

    assert "hw version" in outputs
    assert "hw tune" in outputs
    assert "hf search -h" in outputs
    assert "lf search -h" in outputs
    assert "lf hitag hts rdbl -p 0 -c 8" in outputs
    assert outputs["hf search -h"][0].command_context == "help_capability"
    assert outputs["lf search"][0].command_context == "discovery"
    assert outputs["lf hitag hts rdbl -p 0 -c 8"][0].command_context == "read"
    assert outputs["hw version"][0].command == "hw version"
    assert "[usb] pm3 -->" not in outputs["hw version"][0].output


def test_pm3_log_capture_provider_feeds_discovery_facade():
    capture = Pm3LogCaptureProvider(SAMPLE_LOG).capture()
    summary = capture.summarize(DiscoveryFacade(default_launch_config()))

    assert capture.source.startswith("log:")
    assert capture.inputs.startup_banner is not None
    assert capture.inputs.hw_version is not None
    assert capture.inputs.hw_tune is not None
    assert capture.inputs.lf_search is not None
    assert capture.inputs.hitag_rdbl is not None
    assert summary.com_port == "COM16"
    assert summary.tag_type_guess == "hitag_s256_plain"
    assert summary.lf_antenna_status == "ok"


def test_help_only_log_does_not_infer_lf_tag_or_hitag_candidate():
    capture = Pm3LogCaptureProvider(HELP_ONLY_LOG).capture()
    summary = capture.summarize(DiscoveryFacade(default_launch_config()))

    assert capture.inputs.startup_banner is not None
    assert capture.inputs.hw_version is not None
    assert capture.inputs.hw_tune is not None
    assert capture.inputs.hf_search is None
    assert capture.inputs.lf_search is None
    assert capture.inputs.hitag_rdbl is None
    assert summary.com_port == "COM16"
    assert summary.lf_antenna_status == "ok"
    assert summary.hf_antenna_status == "ok"
    assert summary.discovery_data_status == "not captured"
    assert summary.tag_frequency_guess != "lf"
    assert summary.tag_frequency_guess == "unknown"
    assert summary.tag_type_guess != "hitag_candidate"
    assert summary.tag_type_guess == "unknown"
    assert summary.recommended_next_step == "Run hf search and lf search with the tag present"


def test_incomplete_log_does_not_crash(tmp_path):
    log = tmp_path / "incomplete.txt"
    log.write_text("[usb] pm3 --> hw version\npartial output only\n", encoding="utf-8")

    capture = Pm3LogCaptureProvider(log).capture()
    summary = capture.summarize()

    assert capture.inputs.hw_version == "partial output only"
    assert "hw_tune" in capture.missing_fields
    assert summary.connected == "unknown"
    assert summary.com_port is None
    assert summary.lines()[1] == "COM port: unknown/auto"
    assert summary.recommended_next_step == "Start Proxmark with auto-detect"


def test_latest_log_file_selects_newest_file(tmp_path):
    older = tmp_path / "log_old.txt"
    newer = tmp_path / "log_new.txt"
    older.write_text("old", encoding="utf-8")
    newer.write_text("new", encoding="utf-8")
    old_time = time.time() - 60
    new_time = time.time()
    os.utime(older, (old_time, old_time))
    os.utime(newer, (new_time, new_time))

    assert latest_log_file(tmp_path) == newer


def test_interactive_provider_is_stub_only():
    provider = InteractivePm3Provider()

    try:
        provider.capture()
    except NotImplementedError as exc:
        assert "not implemented" in str(exc).lower()
    else:
        raise AssertionError("Interactive provider must not run hardware automation")


def test_cli_scenario_summary_runs():
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pm3_workflow_gui.cli",
            "scenario-summary",
            "--scenario",
            str(SCENARIOS / "hitag_s256_original_discovery.json"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "PM3 scenario summary" in completed.stdout
    assert "COM16" in completed.stdout
    assert "Hitag S256" in completed.stdout


def test_cli_log_summary_runs_on_sample_log():
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pm3_workflow_gui.cli",
            "log-summary",
            "--log",
            str(SAMPLE_LOG),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "PM3 log summary" in completed.stdout
    assert "Recognized commands:" in completed.stdout
    assert "lf hitag hts rdbl -p 0 -c 8" in completed.stdout
    assert "Hitag S256" in completed.stdout


def test_cli_log_summary_reports_help_only_discovery_gap():
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pm3_workflow_gui.cli",
            "log-summary",
            "--log",
            str(HELP_ONLY_LOG),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert "Discovery data: not captured" in completed.stdout
    assert "Tag frequency: unknown" in completed.stdout
    assert "Tag type: unknown" in completed.stdout
    assert "Next step: Run hf search and lf search with the tag present" in completed.stdout
    assert "lf search -h" in completed.stdout
    assert "lf hitag hts rdbl -p 0 -c 8" not in completed.stdout


def test_cli_latest_log_summary_selects_newest_log(tmp_path):
    old_log = tmp_path / "log_1.txt"
    new_log = tmp_path / "log_2.txt"
    old_log.write_text("[usb] pm3 --> hw version\nold\n", encoding="utf-8")
    new_log.write_text(SAMPLE_LOG.read_text(encoding="utf-8"), encoding="utf-8")
    os.utime(old_log, (time.time() - 60, time.time() - 60))
    os.utime(new_log, (time.time(), time.time()))

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pm3_workflow_gui.cli",
            "latest-log-summary",
            "--log-dir",
            str(tmp_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0
    assert str(new_log) in completed.stdout
    assert "Hitag S256" in completed.stdout
