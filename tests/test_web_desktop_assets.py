from __future__ import annotations

import json
import re
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
        ("overview", "nav.overview"),
        ("read", "nav.read"),
        ("write", "nav.write"),
        ("templates", "nav.templates"),
        ("backups", "nav.backups"),
    ):
        assert f'data-view="{view}"' in html
        assert f'data-i18n="{key}"' in html


def test_index_cache_busts_connection_boot_script() -> None:
    html = (ASSETS / "index.html").read_text(encoding="utf-8")

    assert 'app.js?v=20260627-text-overview2' in html
    assert 'styles.css?v=20260627-text-overview2' in html


def test_app_waits_for_pywebview_bridge_before_booting() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "let bootPromise = null" in script
    assert "async function waitForBridge" in script
    assert "async function bootWhenBridgeReady" in script
    assert 'window.addEventListener("pywebviewready", bootWhenBridgeReady' in script
    assert "window.setTimeout(bootWhenBridgeReady, 50)" in script


def test_app_refreshes_connection_even_when_startup_screen_is_disabled() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    boot_body = script.split("async function boot()", 1)[1].split("async function waitForBridge", 1)[0]

    assert "if (state.settings.show_startup_check_on_launch !== false)" in boot_body
    assert "await refreshConnection();" in boot_body
    assert 'state.startupFlow = "done";' in boot_body


def test_bridge_missing_state_updates_visible_status_surfaces() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))

    assert 't("bridgeMissing.short", "Desktop-Bridge fehlt")' in script
    assert 'if (!state.bridgeReady) {' in script
    assert "devicePort.textContent = t(\"bridgeMissing.short\"" in script
    assert "statusDot.className = \"status-dot is-err\"" in script
    assert "bridgeMissing.short" in en
    assert "bridgeMissing.short" in de


def test_startup_ready_screen_shows_connection_details() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "function startupConnectionDetail()" in script
    assert 't("connection.pm3Connected", "PM3 verbunden")' in script
    assert "state.connection.port" in script
    assert "state.connection.target" in script
    assert "compatibilityLabel(state.connection.compatibility)" in script


def test_frontend_exposes_initial_connection_injection_hook() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "applyInitialConnection(connection)" in script
    assert "state.connection = connection || state.connection" in script
    assert 'state.startupFlow = "antenna-ready"' in script
    assert 'state.startupFlow = "antenna-error"' in script


def test_read_scan_title_uses_active_progress_step() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "data-read-progress-title" in script
    assert "data-read-progress-percent" in script
    assert "data-read-progress-bar" in script
    assert "function operationPercent" in script
    assert "const title = progress[progress.length - 1]" in script
    assert "titleNode.textContent = title" in script


def test_overview_is_real_screen_not_implicit_read_start() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert 'if (state.activeView === "overview") return "overview";' in script
    assert "function renderOverview()" in script
    assert "data-overview-page" in script
    assert "overview.heroTitle" in script
    assert "overview.logoPlaceholder" in script
    assert "https://github.com/DevOpsOfChaos" in script
    assert 'if (key === "overview") return renderOverview();' in script
    assert 'actionCard("write"' not in script
    assert 'data-overview-storage' not in script


def test_read_result_exposes_save_template_action_container() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "data-read-result-actions" in script
    assert "data-open-save-template" in script
    assert 'scan.canSave ? "" : "disabled"' in script


def test_startup_antenna_result_shows_summary_before_auto_continue() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    css = (ASSETS / "styles.css").read_text(encoding="utf-8")

    assert "const STARTUP_ANTENNA_RESULT_MS = 5000" in script
    assert "function renderAntennaStatusSummary" in script
    assert "state.antennaResult || {}" in script
    assert 't("antenna.lf", "LF-Antenne")' in script
    assert 't("antenna.hf", "HF-Antenne")' in script
    assert 't("antenna.summaryTitle", "Antennenprüfung abgeschlossen")' in script
    assert "voltage_125khz" not in script.split("function renderStartupAntennaResult", 1)[1].split("function statusPill", 1)[0]
    assert 't("antenna.autoContinue"' in script
    assert "STARTUP_ANTENNA_RESULT_MS" in script
    assert "@keyframes summaryCountdown" in css
    assert "TRANSIENT_STATUS_MS);" not in script.split('state.startupFlow = "antenna-result"', 1)[1].split("}", 1)[0]


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


def test_literal_frontend_translation_keys_exist_in_locales() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")
    used_keys = set(re.findall(r"(?<![A-Za-z0-9_$])t\(\s*[\"']([^\"']+)[\"']", script))
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))

    assert used_keys - set(de) == set()
    assert used_keys - set(en) == set()


def test_scan_progress_locale_keys_are_translated() -> None:
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))
    required = (
        "operation.pm3ConnectionChecking",
        "operation.scanSearchAuto",
        "operation.scanSearchHf",
        "operation.scanSearchLf",
        "operation.firstReadRunning",
        "operation.secondReadRunning",
        "operation.scanCompare",
        "operation.currentChipFullRead",
        "operation.backupSaving",
    )

    for key in required:
        assert key in en
        assert key in de


def test_write_target_switch_resets_comparison_and_discards_stale_results() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "let comparisonRequestSeq = 0" in script
    assert "let targetSelectionSeq = 0" in script
    assert "function resetComparisonForTargetChange" in script
    assert "state.comparison = null" in script
    assert "state.comparisonLoading = loading" in script
    assert "requestId !== comparisonRequestSeq || requestTargetKey !== targetStateKey()" in script
    assert 'await refreshComparison({ renderLoading: true, renderResult: true })' in script


def test_write_compare_rerenders_when_target_identity_changes() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "function targetStateKey" in script
    assert "function writeCompareRenderKey" in script
    assert 'data-write-compare data-target-key="${escapeHtml(targetStateKey())}" data-render-key="${escapeHtml(writeCompareRenderKey())}"' in script
    assert "compareNode?.dataset.targetKey !== targetStateKey()" in script
    assert "compareNode?.dataset.renderKey !== writeCompareRenderKey()" in script
    assert "function templateTargetPreview" in script
    assert "function backupTargetPreview" in script


def test_write_scan_keeps_backup_progress_step_visible() -> None:
    script = (ASSETS / "app.js").read_text(encoding="utf-8")

    assert "const WRITE_SCAN_BACKUP_STEP_MIN_MS = 650" in script
    assert "function isWriteScanProgressVisible" in script
    assert 'operationHasProgressKey(operation, "operation.backupSaving")' in script
    assert "function keepCurrentScanBackupStepVisible" in script
    assert "await delay(WRITE_SCAN_BACKUP_STEP_MIN_MS)" in script
    assert "await keepCurrentScanBackupStepVisible(operation)" in script


def test_antenna_summary_locale_key_is_translated() -> None:
    en = json.loads((ASSETS / "locales" / "en.json").read_text(encoding="utf-8"))
    de = json.loads((ASSETS / "locales" / "de.json").read_text(encoding="utf-8"))

    for key in (
        "antenna.summaryTitle",
        "antenna.summaryBody",
        "antenna.autoContinue",
        "antenna.statusOk",
        "antenna.statusPerfect",
        "antenna.statusProblem",
        "antenna.problemHint",
    ):
        assert key in en
        assert key in de


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
    assert "function rerenderActiveModal()" in script
    assert "state.lastScan = null" not in set_language_body
    assert "state.target = null" not in set_language_body
