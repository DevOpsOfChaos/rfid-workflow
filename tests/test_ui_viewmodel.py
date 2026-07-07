from pathlib import Path

import pytest

from pm3_workflow_gui.services.capture import Pm3LogCaptureProvider
from pm3_workflow_gui.ui.viewmodel import (
    demo_sources,
    load_demo_view_model,
    view_model_from_capture,
)


PM3_FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def test_success_blank_read_view_model_reports_detected_hitag():
    model = view_model_from_capture(
        Pm3LogCaptureProvider(PM3_FIXTURES / "session_log_hitag_s256_blank_read_success_real.txt").capture(),
        source_label="Success blank read",
    )

    assert model.status_severity == "ok"
    assert "Chip erkannt" in model.title
    assert "Hitag S256" in model.title
    assert model.tag_type == "Hitag S256"
    assert model.next_step == "Vorlage erstellen oder Zielchip read-only vergleichen"
    assert model.ignored_host_commands
    assert any(command == "cd <project_root>" for command in model.ignored_host_commands)


def test_lost_device_view_model_requests_reconnect():
    model = view_model_from_capture(
        Pm3LogCaptureProvider(PM3_FIXTURES / "session_log_device_lost_after_failed_discovery.txt").capture()
    )

    assert model.status_severity == "error"
    assert model.title == "Device lost"
    assert model.reconnect_required is True
    assert model.primary_action_hint == "Reconnect USB and restart PM3 session"


def test_help_only_view_model_keeps_discovery_uncaptured():
    model = view_model_from_capture(
        Pm3LogCaptureProvider(PM3_FIXTURES / "session_log_help_only_real.txt").capture()
    )

    assert model.status_severity == "warning"
    assert model.title == "Discovery not captured"
    assert model.discovery_data_status == "not captured"
    assert model.tag_frequency == "unknown"
    assert model.tag_type == "unknown"


def test_demo_sources_include_required_mvp_options():
    labels = {source.label for source in demo_sources()}

    assert "Original Hitag scenario" in labels
    assert "Blank before write" in labels
    assert "Blank after write" in labels
    assert "Help-only" in labels
    assert "Lost device" in labels
    assert "Success blank read" in labels


def test_load_demo_view_model_uses_services():
    model = load_demo_view_model("Success blank read")

    assert model.source == "Success blank read"
    assert model.tag_type == "Hitag S256"


def test_web_desktop_app_can_be_imported_when_pywebview_is_available():
    pytest.importorskip("webview")
    __import__("pm3_workflow_gui.web_desktop.app")
