from pm3_workflow_gui.services.live_pm3_readonly import (
    COMMAND_EXECUTION_FAILED,
    LiveCommandResult,
    LivePm3ReadonlyService,
    SAFE_LIVE_COMMANDS,
)
from pm3_workflow_gui.ui.viewmodel import load_live_scan_view_model


def test_connection_status_uses_pm3_wrapper_list_without_forced_com_port():
    calls = []

    def runner(args, timeout):
        calls.append(args)
        return LiveCommandResult(" ".join(args), 0, "1: COM11\n", "")

    service = LivePm3ReadonlyService(runner=runner)
    status = service.connection_status()

    assert status.connected is True
    assert status.ports == ("COM11",)
    assert "bash pm3 --list" in " ".join(calls[0])
    assert "-p COM16" not in " ".join(calls[0])


def test_live_command_allowlist_blocks_write_like_commands():
    service = LivePm3ReadonlyService(runner=lambda args, timeout: LiveCommandResult("", 0, "", ""))

    try:
        service.run_safe_command("lf hitag hts wrbl -p 0 -d 00000000")
    except ValueError as exc:
        assert "outside read-only allowlist" in str(exc)
    else:
        raise AssertionError("write command must be blocked")


def test_missing_pm3_returns_device_lost_capture_for_facade():
    def runner(args, timeout):
        return LiveCommandResult(" ".join(args), 1, "", "[!!] No port found\n")

    service = LivePm3ReadonlyService(runner=runner)
    summary = service.capture().summarize()

    assert summary.session_status == "device_lost"
    assert summary.device_reconnect_required is True
    assert summary.recommended_next_step == "Reconnect USB and restart PM3 session"


def test_live_capture_runs_only_safe_readonly_commands_and_feeds_facade():
    fixture_outputs = {
        "hw version": " [ Proxmark3 ]\n [ Client ]\n  Iceman/master/v4.20469\n [ Model ]\n  Firmware................ PM3 GENERIC\n",
        "hw tune": "[+] LF antenna............. ok\n[+] HF antenna ( ok )\n",
        "hf search": "[!] No known/supported 13.56 MHz tags found\n",
        "lf search": "[+] UID.................... 83 F5 E4 94\n[+] TYPE................... Hitag S\n",
    }
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        for command, output in fixture_outputs.items():
            if text.endswith(f" -c {command}"):
                return LiveCommandResult(text, 0, output, "")
        return LiveCommandResult(text, 1, "", "unexpected command")

    service = LivePm3ReadonlyService(runner=runner)
    capture = service.capture()
    summary = capture.summarize()

    assert tuple(capture.command_outputs) == SAFE_LIVE_COMMANDS
    assert all("-p COM16" not in call for call in calls)
    assert summary.session_status == "ok"
    assert summary.tag_type_guess == "hitag_candidate"


def test_port_detected_alone_does_not_create_ok_session():
    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        return LiveCommandResult(text, 0, "", "")

    summary = LivePm3ReadonlyService(runner=runner).capture().summarize()

    assert summary.session_status == "command_failed"
    assert summary.discovery_data_status == "unknown"
    assert summary.last_error == COMMAND_EXECUTION_FAILED


def test_empty_hw_version_output_is_not_success():
    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        if text.endswith(" -c hw version"):
            return LiveCommandResult(text, 0, "", "")
        return LiveCommandResult(text, 0, "ignored", "")

    capture = LivePm3ReadonlyService(runner=runner).capture()
    summary = capture.summarize()

    assert capture.inputs.hw_version is None
    assert summary.session_status == "command_failed"
    assert summary.last_error == COMMAND_EXECUTION_FAILED


def test_real_hw_version_output_sets_target_client_and_firmware():
    hw_version = (
        "[+] Using UART port COM11\n"
        " [ Proxmark3 ]\n"
        " [ Client ]\n"
        "  Iceman/master/v4.21611\n"
        " [ Model ]\n"
        "  Firmware.................. PM3 GENERIC\n"
    )

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        if text.endswith(" -c hw version"):
            return LiveCommandResult(text, 0, hw_version, "")
        return LiveCommandResult(text, 0, "", "")

    summary = LivePm3ReadonlyService(runner=runner).capture().summarize()

    assert summary.session_status == "ok"
    assert summary.target == "PM3 GENERIC"
    assert summary.client_version == "Iceman/master/v4.21611"
    assert summary.firmware == "PM3 GENERIC"


def test_real_hw_tune_output_sets_antenna_status():
    outputs = {
        "hw version": " [ Proxmark3 ]\n [ Client ]\n  Iceman/master/v4.21611\n [ Model ]\n  Firmware.................. PM3 GENERIC\n",
        "hw tune": "[+] LF antenna............. ok\n[+] HF antenna ( ok )\n",
    }

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        for command, output in outputs.items():
            if text.endswith(f" -c {command}"):
                return LiveCommandResult(text, 0, output, "")
        return LiveCommandResult(text, 0, "", "")

    summary = LivePm3ReadonlyService(runner=runner).capture().summarize()

    assert summary.lf_antenna_status == "ok"
    assert summary.hf_antenna_status == "ok"
    assert summary.discovery_data_status == "not captured"


def test_hf_search_output_is_forwarded_to_facade():
    outputs = {
        "hw version": " [ Proxmark3 ]\n [ Client ]\n  Iceman/master/v4.21611\n [ Model ]\n  Firmware.................. PM3 GENERIC\n",
        "hf search": "[!] No known/supported 13.56 MHz tags found\n",
    }

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        for command, output in outputs.items():
            if text.endswith(f" -c {command}"):
                return LiveCommandResult(text, 0, output, "")
        return LiveCommandResult(text, 0, "", "")

    capture = LivePm3ReadonlyService(runner=runner).capture()
    summary = capture.summarize()

    assert capture.inputs.hf_search == outputs["hf search"].strip()
    assert summary.discovery_data_status == "captured"
    assert summary.tag_frequency_guess == "none"


def test_timeout_stderr_and_exitcode_are_command_failed():
    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        if text.endswith(" -c hw version"):
            return LiveCommandResult(text, 124, "", "timed out", timed_out=True)
        return LiveCommandResult(text, 1, "", "failed")

    summary = LivePm3ReadonlyService(runner=runner).capture().summarize()

    assert summary.session_status == "command_failed"
    assert summary.last_error == COMMAND_EXECUTION_FAILED
    assert "hw version" in summary.failed_commands


def test_live_view_model_reports_reconnect_overlay_condition():
    service = LivePm3ReadonlyService(
        runner=lambda args, timeout: LiveCommandResult(" ".join(args), 1, "", "[!!] No port found\n")
    )

    model = load_live_scan_view_model(service)

    assert model.source == "Live scan"
    assert model.reconnect_required is True
    assert model.title == "Device lost"
