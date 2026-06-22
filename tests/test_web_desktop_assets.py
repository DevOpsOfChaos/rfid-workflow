from __future__ import annotations

import json
from pathlib import Path
import re


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
    assert 'data-i18n="nav.analysis"' in html


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


def test_locale_keys_match_between_german_and_english() -> None:
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))

    assert set(de) == set(en)


def test_locale_files_do_not_accumulate_many_unused_keys() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    html = (ASSETS / "index.html").read_text(encoding="utf-8")
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    dynamic_prefixes = (
        "help.",
        "overview.step",
    )
    used = set(re.findall(r't\("([^"]+)"', script))
    used.update(re.findall(r'data-i18n="([^"]+)"', html))
    used.update(re.findall(r'\["[^"]+",\s*"([^"]+)"\]', script.split("const LEGACY_MESSAGE_KEYS", 1)[1].split("];", 1)[0]))
    used.update(key for key in en if key.startswith(dynamic_prefixes))
    unused = set(en) - used

    assert len(unused) < 40, sorted(unused)


def test_no_visible_hardcoded_ui_sentences_in_app_renderer() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    legacy_mapping = script.split("const LEGACY_MESSAGE_KEYS", 1)[1].split("];", 1)[0]
    visible_old_terms = ("Übernehmen", "Änderungen", "Verbindung", "Speichern", "Vorlage", "Bereit")
    renderer = script.replace(legacy_mapping, "")

    for term in visible_old_terms:
        assert term not in renderer


def test_language_switch_rerenders_localized_surfaces_without_resetting_state() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    for key in (
        "read.title",
        "write.currentChip",
        "templates.title",
        "backups.title",
        "settings.showStartup",
    ):
        assert key in script or key in (ASSETS / "index.html").read_text(encoding="utf-8")
    set_language_body = script.split("async function setLanguage", 1)[1].split("function isOperationBusy", 1)[0]
    assert "renderedScreenKey = \"\";" in set_language_body
    assert "render();" in set_language_body
    assert "rerenderActiveModal();" in set_language_body
    assert "state.lastScan = null" not in set_language_body
    assert "state.target = null" not in set_language_body
