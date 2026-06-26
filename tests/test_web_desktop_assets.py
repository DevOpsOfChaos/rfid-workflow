from __future__ import annotations

import json
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
    assert 'data-i18n="nav.analysis"' in html


def test_index_exposes_primary_navigation() -> None:
    html = (ASSETS / "index.html").read_text(encoding="utf-8")

    for view, key in (
        ("read", "nav.read"),
        ("write", "nav.write"),
        ("templates", "nav.templates"),
        ("backups", "nav.backups"),
    ):
        assert f'data-view="{view}"' in html
        assert f'data-i18n="{key}"' in html


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


def test_page_table_locale_keys_are_used_and_translated() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))
    required = (
        "write.pageTable.title",
        "write.table.templateValue",
        "write.table.targetValue",
        "write.table.status",
        "write.table.profilePart",
        "write.table.writable",
        "write.table.action",
        "write.table.reread",
        "write.scope.fullProfile",
        "write.uidPolicy.mustMatch",
        "write.showTechnicalDetails",
        "action.hideDetails",
    )
    dynamic_required = ("write.pageStatus.differentNotWritable",)

    for key in required:
        assert key in script
        assert key in en
        assert key in de
    for key in dynamic_required:
        assert key in en
        assert key in de


def test_page_table_is_hidden_behind_technical_details_by_default() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "writeShowDetails: false" in script
    assert "data-write-details" in script
    assert "if (!state.writeShowDetails)" in script


def test_new_page_table_labels_are_not_hardcoded_in_app_renderer() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    page_table_terms = ("Vorlagenwert", "Zielwert", "Teil des Profils", "Nachprüfung", "Page-Vergleich")

    for term in page_table_terms:
        assert term not in script


def test_language_switch_rerenders_localized_surfaces_without_resetting_state() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    for key in (
        "read.title",
        "write.currentChip",
        "templates.searchPlaceholder",
        "backups.searchPlaceholder",
        "settings.showStartup",
    ):
        assert key in script or key in (ASSETS / "index.html").read_text(encoding="utf-8")
    set_language_body = script.split("async function setLanguage", 1)[1].split("function isOperationBusy", 1)[0]
    assert "renderedScreenKey = \"\";" in set_language_body
    assert "render();" in set_language_body
    assert "rerenderActiveModal();" in set_language_body
    assert "state.lastScan = null" not in set_language_body
    assert "state.target = null" not in set_language_body
