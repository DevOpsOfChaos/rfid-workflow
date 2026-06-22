from __future__ import annotations

from pathlib import Path

from pm3_workflow_gui.profiles.settings import load_settings
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService
from pm3_workflow_gui.web_desktop.bridge import WebDesktopBridge


def main() -> None:
    try:
        import webview
    except ImportError as exc:  # pragma: no cover - exercised by real launcher.
        raise SystemExit(
            "pywebview ist nicht installiert. Bitte die Projekt-GUI-Venv verwenden: "
            r".\.venv-gui\Scripts\python.exe -m pip install pywebview"
        ) from exc

    assets_dir = Path(__file__).resolve().parent / "assets"
    index_path = assets_dir / "index.html"
    settings = load_settings()
    service = LivePm3ReadonlyService(client_dir=settings.last_known_pm3_path)
    bridge = WebDesktopBridge(service=service)
    webview.create_window(
        "RFID Workflow",
        index_path.as_uri(),
        js_api=bridge,
        width=1120,
        height=720,
        min_size=(960, 620),
    )
    webview.start(gui="edgechromium", debug=False)


if __name__ == "__main__":
    main()
