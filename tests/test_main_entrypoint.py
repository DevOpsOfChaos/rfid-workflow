from __future__ import annotations

import sys
from types import SimpleNamespace

from pm3_workflow_gui import main as entrypoint


def test_main_entrypoint_launches_web_desktop_app(monkeypatch) -> None:
    calls = []
    fake_webview = SimpleNamespace(
        create_window=lambda *args, **kwargs: calls.append(("create_window", args, kwargs)),
        start=lambda *args, **kwargs: calls.append(("start", args, kwargs)),
    )
    monkeypatch.setitem(sys.modules, "webview", fake_webview)

    exit_code = entrypoint.main()

    assert exit_code == 0
    assert [call[0] for call in calls] == ["create_window", "start"]
    assert calls[1][1][0].__name__ == "_publish_initial_connection"
