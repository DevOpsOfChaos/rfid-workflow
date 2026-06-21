from pm3_workflow_gui.services.live_pm3_readonly import (
    COMMAND_EXECUTION_FAILED,
    LiveCommandResult,
    LivePm3ReadonlyService,
    SAFE_INDALA_READ_COMMANDS,
    SAFE_LIVE_COMMANDS,
)
from pm3_workflow_gui.services.pm3_graph_viewer import Pm3GraphWorkflow
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


def test_live_command_allowlist_allows_only_targeted_indala_reader():
    calls = []

    def runner(args, timeout):
        calls.append(" ".join(args))
        return LiveCommandResult(" ".join(args), 0, "[+] Indala (len 64)  Raw: 8000000000000000\n", "")

    service = LivePm3ReadonlyService(runner=runner)
    result = service.run_safe_command(SAFE_INDALA_READ_COMMANDS[0], port="COM16")

    assert result.returncode == 0
    assert "lf indala reader" in calls[0]
    try:
        service.run_safe_command("lf indala clone -r 8000000000000000", port="COM16")
    except ValueError as exc:
        assert "outside read-only allowlist" in str(exc)
    else:
        raise AssertionError("Indala clone command must be blocked")


def test_frequency_diagram_is_disabled_without_confirmed_local_qt_window():
    service = LivePm3ReadonlyService(runner=lambda args, timeout: LiveCommandResult("", 0, "", ""))

    assert service.graph_viewer_available() is False
    try:
        service.open_frequency_diagram("COM16")
    except RuntimeError as exc:
        assert "deaktiviert" in str(exc)
    else:
        raise AssertionError("unconfirmed PM3 graph workflow must stay disabled")


def test_frequency_diagram_starts_external_process_only_for_confirmed_allowlist(monkeypatch):
    launched = {}

    class FakeProcess:
        pid = 4242

    def fake_popen(args, **kwargs):
        launched["args"] = args
        launched["kwargs"] = kwargs
        return FakeProcess()

    workflow = Pm3GraphWorkflow(
        "lf_read_data_plot",
        "lf read",
        "data plot",
        'proxmark3.exe <port> -c "lf read;data plot"',
        opens_separate_window=True,
        locally_confirmed=True,
    )
    monkeypatch.setattr("pm3_workflow_gui.services.pm3_graph_viewer.subprocess.Popen", fake_popen)
    service = LivePm3ReadonlyService(
        runner=lambda args, timeout: LiveCommandResult("", 0, "", ""),
        graph_workflow=workflow,
    )

    launch = service.open_frequency_diagram("COM16")

    assert launch.pid == 4242
    assert launch.port == "COM16"
    assert launched["args"][-2:] == ["-c", "lf read;data plot"]
    assert "wrbl" not in " ".join(launched["args"]).lower()
    assert launched["kwargs"]["cwd"] == service.client_dir


def test_positioning_mode_no_signal_stops_after_hf_and_single_lf_probe():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if text.endswith(" -c hf search"):
            return LiveCommandResult(text, 0, "[!] No known/supported 13.56 MHz tags found\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, "[!] No known/supported 125/134 kHz tags found\n", "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).position_chip("COM16", pause_seconds=0)

    assert result.status == "no_signal"
    assert sum(call.endswith(" -c lf search") for call in calls) == 1


def test_positioning_mode_weak_signal_retries_until_maximum():
    calls = []

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if text.endswith(" -c hf search"):
            return LiveCommandResult(text, 0, "[!] No known/supported 13.56 MHz tags found\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, "[-] Couldn't identify a chipset\n[?] Hint: try `hf search` - since tag might not be LF\n", "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).position_chip("COM16", max_lf_attempts=3, pause_seconds=0)

    assert result.status == "signal_present"
    assert result.scan_evidence.state == "signal_detected_but_ambiguous"
    assert sum(call.endswith(" -c lf search") for call in calls) == 3


def test_positioning_mode_repeated_stable_candidate_does_not_run_detail_reader():
    calls = []
    lf_output = "[+] UID.................... D2 DF E4 94\n[+] TYPE................... PCF 7945\n[+] Chipset................ Hitag 1/S / 82xx\n"

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if text.endswith(" -c hf search"):
            return LiveCommandResult(text, 0, "[!] No known/supported 13.56 MHz tags found\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, lf_output, "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).position_chip("COM16", pause_seconds=0)

    assert result.status == "stable_detected"
    assert result.stable_candidate.uid_or_raw_value == "D2DFE494"
    assert sum(call.endswith(" -c lf search") for call in calls) == 2
    assert not any("lf hitag hts" in call for call in calls)


def test_hitag_write_refuses_uid_page():
    service = LivePm3ReadonlyService(runner=lambda args, timeout: LiveCommandResult("", 0, "", ""))

    try:
        service.write_hitag_s256_page(0, "AA BB CC DD", "11 22 33 44", "tmpl", "AA BB CC DD")
    except ValueError as exc:
        assert "outside approved pages" in str(exc)
    else:
        raise AssertionError("UID page write must be blocked")


def test_hitag_write_runs_verify_read_and_audit(tmp_path):
    calls = []
    verify_read = (
        "[=] Access Hitag S in Plain mode\n"
        "[+] Memory type............ Hitag S 256\n"
        "[+] Authentication......... No\n"
        "[+] TTF data rate.......... 2 kBit\n"
        "[+] TTF mode............... Page 4, Page 5, Page 6, Page 7\n"
        "[+]  0 | D2 DF E4 94 | . | r | UID\n"
        "[+]  1 | C9 28 00 AA | . | rw | Config\n"
        "[+]  4 | FF F8 06 97 | . | rw | Data\n"
        "[+]  5 | 8C 66 C1 80 | . | rw | Data\n"
        "[+]  6 | 03 6E F7 00 | . | rw | Data\n"
        "[+]  7 | 00 00 00 00 | . | rw | Data\n"
    )

    def runner(args, timeout):
        text = " ".join(args)
        calls.append(text)
        if "wrbl -p 4 -d FFF80697" in text:
            return LiveCommandResult(text, 0, "[+] done\n", "")
        if text.endswith(" -c lf search"):
            return LiveCommandResult(text, 0, "[+] UID.................... D2 DF E4 94\n[+] TYPE................... PCF 7945\n[+] Chipset................ Hitag 1/S / 82xx\n", "")
        if text.endswith(" -c lf hitag hts reader -@"):
            return LiveCommandResult(text, 0, "[+] UID.................... D2DFE494\n", "")
        if text.endswith(" -c lf hitag hts rdbl -p 0 -c 8"):
            return LiveCommandResult(text, 0, verify_read, "")
        return LiveCommandResult(text, 1, "", "unexpected")

    result = LivePm3ReadonlyService(runner=runner).write_hitag_s256_page(
        4,
        "00 00 00 00",
        "FF F8 06 97",
        "tmpl_123",
        "D2 DF E4 94",
        "COM16",
        tmp_path,
    )

    assert result.success is True
    assert result.verification_value == "FF F8 06 97"
    assert any("wrbl -p 4 -d FFF80697" in call for call in calls)
    assert any("lf hitag hts rdbl -p 0 -c 8" in call for call in calls)
    audit = (tmp_path / "hitag_s256_write_audit.jsonl").read_text(encoding="utf-8")
    assert '"template_id": "tmpl_123"' in audit
    assert '"verification_success": true' in audit


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
    assert summary.tag_type_guess == "hitag_s_candidate"


def test_live_capture_can_include_targeted_hitag_read_for_debug_summary():
    fixture_outputs = {
        "hw version": " [ Proxmark3 ]\n [ Client ]\n  Iceman/master/v4.20469\n [ Model ]\n  Firmware................ PM3 GENERIC\n",
        "hw tune": "[+] LF antenna............. ok\n[+] HF antenna ( ok )\n",
        "hf search": "[!] No known/supported 13.56 MHz tags found\n",
        "lf search": "[+] UID.................... D2 DF E4 94\n[+] TYPE................... PCF 7945\n[+] Chipset................ Hitag 1/S / 82xx\n[?] Hint: Try `lf hitag hts` commands\n",
        "lf hitag hts reader -@": "[+] UID.................... D2DFE494\n",
        "lf hitag hts rdbl -p 0 -c 8": (
            "[=] Access Hitag S in Plain mode\n"
            "[+] Memory type............ Hitag S 256\n"
            "[+] Authentication......... No\n"
            "[+] TTF data rate.......... 2 kBit\n"
            "[+] TTF mode............... Page 4, Page 5, Page 6, Page 7\n"
            "[+]  0 | D2 DF E4 94 | . | r | UID\n"
            "[+]  1 | C9 28 00 AA | . | rw | Config\n"
            "[+]  4 | FF F8 06 97 | . | rw | Data\n"
            "[+]  5 | 8C 66 C1 80 | . | rw | Data\n"
            "[+]  6 | 03 6E F7 00 | . | rw | Data\n"
            "[+]  7 | 00 00 00 00 | . | rw | Data\n"
        ),
    }

    def runner(args, timeout):
        text = " ".join(args)
        if "--list" in text:
            return LiveCommandResult(text, 0, "1: COM11\n", "")
        for command, output in fixture_outputs.items():
            if text.endswith(f" -c {command}"):
                return LiveCommandResult(text, 0, output, "")
        return LiveCommandResult(text, 1, "", "unexpected command")

    capture = LivePm3ReadonlyService(runner=runner).capture(include_hitag_read=True)
    summary = capture.summarize()

    assert summary.tag_type_guess == "hitag_s256"
    assert capture.hitag_read_result.success is True
    assert "lf hitag hts rdbl -p 0 -c 8" in capture.command_outputs


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
