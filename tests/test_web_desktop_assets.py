from __future__ import annotations

from pathlib import Path


ASSETS = Path(__file__).resolve().parents[1] / "src" / "pm3_workflow_gui" / "web_desktop" / "assets"


def test_app_renderer_uses_screen_key_before_replacing_main_content() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "let renderedScreenKey" in script
    assert "if (nextKey !== renderedScreenKey)" in script
    assert script.count("appView.innerHTML = renderScreen(nextKey);") == 1
    render_body = script.split("function render() {", 1)[1].split("function renderScreen", 1)[0]
    assert "clearPopover()" not in render_body


def test_app_contains_targeted_patch_surfaces_for_live_updates() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    for function_name in (
        "updateConnectionStatus",
        "patchReadScanning",
        "patchWriteView",
        "patchAnalysisView",
        "patchTemplatesView",
        "patchBackupsView",
    ):
        assert f"function {function_name}" in script


def test_index_exposes_analysis_navigation() -> None:
    html = (ASSETS / "index.html").read_text(encoding="utf-8")

    assert 'data-view="analysis"' in html
    assert ">Analyse<" in html


def test_index_exposes_overview_navigation() -> None:
    html = (ASSETS / "index.html").read_text(encoding="utf-8")

    assert 'data-view="overview"' in html
    assert 'data-i18n="nav.overview"' in html


def test_assets_and_locales_do_not_contain_mojibake_sequences() -> None:
    bad_sequences = ("Ã", "â€", "�")
    files = [ASSETS / "app.js", ASSETS / "index.html", ASSETS / "styles.css"]
    files.extend((ASSETS / "locales").glob("*.json"))

    for path in files:
        text = path.read_text(encoding="utf-8")
        assert not any(sequence in text for sequence in bad_sequences), path
