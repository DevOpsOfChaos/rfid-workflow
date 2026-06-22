const appView = document.getElementById("appView");
const statusText = document.getElementById("statusText");
const deviceStatus = document.getElementById("deviceStatus");
const modalRoot = document.getElementById("modalRoot");
const toastRoot = document.getElementById("toastRoot");
const settingsPanel = document.querySelector("[data-settings-panel]");

const TERMINAL_STATES = new Set(["succeeded", "failed", "verification_failed", "connection_lost"]);
const TRANSIENT_STATUS_MS = 2600;
const WRITE_ORDER = ["page_4", "page_5", "page_6", "page_7", "page_1"];
const STARTUP_FLOW_STATES = new Set(["language", "checking", "antenna-ready", "antenna-running", "antenna-result", "antenna-error"]);
const HELP_TOPICS = [
  "notDetected",
  "readFails",
  "signalUnstable",
  "antennaFails",
  "saveFails",
  "writeVerifyFails",
];

const fallbackLocales = {
  de: {
    "action.close": "Schließen",
    "action.continueOverview": "Zur Übersicht",
    "action.retry": "Erneut versuchen",
    "action.runStartupCheck": "Startprüfung ausführen",
    "action.startAntennaCheck": "Antennentest starten",
    "antenna.body": "Entferne alle Transponder von der Antenne.",
    "antenna.error": "Antennentest konnte nicht abgeschlossen werden.",
    "antenna.hf": "HF-Antenne",
    "antenna.lf": "LF-Antenne",
    "antenna.title": "Antennentest",
    "app.ready": "Bereit",
    "compat.clientFirmwareMismatch": "Client-/Firmware-Konflikt",
    "compat.recognizedUntested": "Erkannt, aber nicht verifiziert",
    "compat.unknown": "Unbekannt",
    "compat.verified": "Verifiziert",
    "connection.checking": "Proxmark3-Verbindung wird geprüft ...",
    "connection.deviceConnected": "Gerät verbunden",
    "connection.failed": "Verbindungsprüfung fehlgeschlagen",
    "connection.found": "Proxmark3 gefunden",
    "connection.lost": "Verbindung verloren",
    "connection.noDevice": "Kein kompatibles Gerät gefunden",
    "connection.notAvailable": "nicht verfügbar",
    "language.de": "Deutsch",
    "language.en": "English",
    "language.label": "Sprache",
    "language.title": "Choose your language",
    "nav.analysis": "Analyse",
    "nav.backups": "Backups",
    "nav.overview": "Übersicht",
    "nav.read": "Lesen",
    "nav.templates": "Vorlagen",
    "nav.write": "Schreiben",
    "overview.help": "Hilfe",
    "overview.quickStart": "Quick Start",
    "overview.system": "Systemstatus",
    "overview.title": "Übersicht",
    "settings.showStartup": "Startprüfung beim Programmstart anzeigen",
    "status.antennaIdle": "Noch kein Antennentest in dieser Sitzung.",
    "status.client": "Client",
    "status.compatibility": "Kompatibilität",
    "status.connected": "Verbunden",
    "status.device": "Gerät",
    "status.disconnected": "Getrennt",
    "status.pm3": "Proxmark3",
  },
  en: {},
};

let statusTimer = null;
let toastTimer = null;
let renderedScreenKey = "";

const state = {
  activeView: "overview",
  startupFlow: "checking",
  startupChecked: false,
  startupCompleted: false,
  settings: {
    language: null,
    first_run_completed: false,
    show_startup_check_on_launch: true,
    last_known_pm3_path: null,
  },
  language: "en",
  locales: fallbackLocales,
  readMode: "auto",
  templateSort: "newest",
  templateSearch: "",
  templateTypeFilter: "all",
  backupSort: "newest",
  backupSearch: "",
  bridgeReady: false,
  connection: {
    status: "checking",
    connected: false,
    message: "Verbindung wird geprüft ...",
  },
  templates: [],
  backups: [],
  lastScan: null,
  currentChip: null,
  currentBackup: null,
  target: null,
  comparison: null,
  readOperation: null,
  currentScanOperation: null,
  writeOperations: {},
  autoWriteOperation: null,
  knownActions: {},
  completedActions: {},
  failedRegionId: null,
  positionOperation: null,
  positionResult: null,
  antennaOperation: null,
  antennaResult: null,
  activePopover: null,
};

function bridge() {
  return window.pywebview?.api || null;
}

async function callBridge(method, ...args) {
  const api = bridge();
  if (!api || typeof api[method] !== "function") {
    throw new Error("pywebview Bridge nicht verfügbar.");
  }
  return api[method](...args);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function t(key, fallback = "") {
  return state.locales[state.language]?.[key] || state.locales.en?.[key] || state.locales.de?.[key] || fallback || key;
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language || "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n, element.textContent);
  });
  const languageSelect = document.querySelector("[data-language-select]");
  if (languageSelect) languageSelect.value = state.language;
  const startupToggle = document.querySelector("[data-startup-on-launch]");
  if (startupToggle) startupToggle.checked = Boolean(state.settings.show_startup_check_on_launch);
}

async function loadLocale(language) {
  if (state.locales[language] && Object.keys(state.locales[language]).length > 8) return;
  try {
    const response = await fetch(`locales/${language}.json`, { cache: "no-store" });
    if (response.ok) state.locales[language] = await response.json();
  } catch {
    // Keep the embedded technical fallback when local files are unavailable.
  }
}

async function setLanguage(language, persist = true) {
  state.language = language === "de" ? "de" : "en";
  await loadLocale(state.language);
  state.settings.language = state.language;
  if (persist && state.bridgeReady) {
    const response = await callBridge("update_app_settings", { language: state.language });
    state.settings = response.settings || state.settings;
  }
  applyStaticTranslations();
  renderedScreenKey = "";
  render();
}

function isOperationBusy(operation) {
  return Boolean(operation && !TERMINAL_STATES.has(operation.state));
}

function anyWriteBusy() {
  return isOperationBusy(state.autoWriteOperation) || Object.values(state.writeOperations).some(isOperationBusy);
}

function neutralStatusMessage() {
  if (!state.bridgeReady) return t("app.ready", "Bereit");
  if (state.connection.status === "lost") return t("connection.lost", "Verbindung verloren");
  if (!state.connection.connected && state.connection.message) return state.connection.message;
  return t("app.ready", "Bereit");
}

function setStatus(message, options = {}) {
  window.clearTimeout(statusTimer);
  statusTimer = null;
  statusText.textContent = message || neutralStatusMessage();
  if (options.temporary) {
    statusTimer = window.setTimeout(() => {
      statusText.textContent = neutralStatusMessage();
      statusTimer = null;
    }, options.timeout || TRANSIENT_STATUS_MS);
  }
}

function setTransientStatus(message, timeout) {
  setStatus(message, { temporary: true, timeout });
}

function resetStatusForView() {
  if (isOperationBusy(state.readOperation)) {
    setStatus(state.readOperation.message);
    return;
  }
  if (isOperationBusy(state.currentScanOperation)) {
    setStatus(state.currentScanOperation.message);
    return;
  }
  if (isOperationBusy(state.autoWriteOperation)) {
    setStatus(state.autoWriteOperation.message);
    return;
  }
  const activeWrite = Object.values(state.writeOperations).find(isOperationBusy);
  if (activeWrite) {
    setStatus(activeWrite.message);
    return;
  }
  if (isOperationBusy(state.positionOperation)) {
    setStatus(state.positionOperation.message);
    return;
  }
  if (isOperationBusy(state.antennaOperation)) {
    setStatus(state.antennaOperation.message);
    return;
  }
  setStatus(neutralStatusMessage());
}

function updateConnectionStatus() {
  const connection = state.connection;
  deviceStatus.classList.toggle("is-checking", connection.status === "checking");
  deviceStatus.classList.toggle("is-offline", !connection.connected && connection.status !== "checking");
  deviceStatus.classList.toggle("is-lost", connection.status === "lost");
  const label = connection.connected
    ? `${t("connection.found", "Proxmark3 gefunden")} · ${connection.port || "auto"} · ${connection.target || "PM3"}`
    : connection.status === "lost"
      ? t("connection.lost", "Verbindung verloren")
      : connection.status === "checking"
        ? t("connection.checking", "Verbindung wird geprüft ...")
        : t("connection.noDevice", "Kein kompatibles Gerät gefunden");
  if (deviceStatus.dataset.label !== label) {
    deviceStatus.dataset.label = label;
    deviceStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${escapeHtml(label)}`;
  }
}

function updateNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });
}

function readSurface() {
  if (state.readOperation && !TERMINAL_STATES.has(state.readOperation.state)) return "scanning";
  if (state.lastScan?.status === "signal_unstable") return "unstable";
  if (state.lastScan?.chip) return "result";
  return "start";
}

function screenKey() {
  if (!state.bridgeReady) return "bridge-missing";
  if (STARTUP_FLOW_STATES.has(state.startupFlow)) return `startup:${state.startupFlow}`;
  if (state.activeView === "overview") return "overview";
  if (state.activeView === "read") return `read:${readSurface()}`;
  return state.activeView;
}

function render() {
  updateConnectionStatus();
  updateNavigation();
  const nextKey = screenKey();
  if (nextKey !== renderedScreenKey) {
    appView.innerHTML = renderScreen(nextKey);
    renderedScreenKey = nextKey;
  }
  patchScreen(nextKey);
}

function renderScreen(key) {
  if (key === "bridge-missing") return renderBridgeMissing();
  if (key === "startup:language") return renderLanguageChoice();
  if (key === "startup:checking") return renderStartupChecking();
  if (key === "startup:antenna-ready") return renderStartupAntennaReady();
  if (key === "startup:antenna-running") return renderStartupAntennaRunning();
  if (key === "startup:antenna-result") return renderStartupAntennaResult();
  if (key === "startup:antenna-error") return renderStartupAntennaError();
  if (key === "overview") return renderOverview();
  if (key === "read:start") return renderReadStart();
  if (key === "read:scanning") return renderReadScanning();
  if (key === "read:unstable") return renderReadUnstable();
  if (key === "read:result") return renderReadResult();
  if (key === "write") return renderWriteView();
  if (key === "analysis") return renderAnalysisView();
  if (key === "templates") return renderTemplatesView();
  if (key === "backups") return renderBackupsView();
  return renderReadStart();
}

function patchScreen(key) {
  if (key === "overview") patchOverview();
  if (key === "read:start") patchReadStart();
  if (key === "read:scanning") patchReadScanning();
  if (key === "read:result") patchReadResult();
  if (key === "write") patchWriteView();
  if (key === "analysis") patchAnalysisView();
  if (key === "templates") patchTemplatesView();
  if (key === "backups") patchBackupsView();
}

function replaceHtml(selector, html) {
  const element = appView.querySelector(selector);
  if (element && element.dataset.html !== html) {
    element.dataset.html = html;
    element.innerHTML = html;
  }
}

function renderBridgeMissing() {
  return `
    <section class="screen">
      <div class="empty-start">
        <div class="scan-card">
          <div class="scan-icon" aria-hidden="true"></div>
          <h1>Desktop-Bridge nicht verfügbar</h1>
          <p>Diese Oberfläche muss im pywebview-Fenster gestartet werden. Ohne Python-Bridge werden keine PM3-Zustände angezeigt.</p>
        </div>
      </div>
    </section>
  `;
}

function renderLanguageChoice() {
  return `
    <section class="screen startup-screen" aria-labelledby="languageTitle">
      <div class="startup-card startup-card-small">
        <h1 id="languageTitle">${escapeHtml(t("language.title", "Choose your language"))}</h1>
        <div class="language-actions">
          <button class="button" type="button" data-choose-language="de">${escapeHtml(t("language.de", "Deutsch"))}</button>
          <button class="button button-secondary" type="button" data-choose-language="en">${escapeHtml(t("language.en", "English"))}</button>
        </div>
      </div>
    </section>
  `;
}

function renderStartupChecking() {
  return `
    <section class="screen startup-screen" aria-labelledby="startupCheckTitle">
      <div class="startup-card">
        <div class="startup-spinner" aria-hidden="true"></div>
        <h1 id="startupCheckTitle">${escapeHtml(t("connection.checking", "Checking Proxmark3 connection ..."))}</h1>
        <p>${escapeHtml(state.connection.message || "")}</p>
      </div>
    </section>
  `;
}

function renderStartupAntennaReady() {
  return `
    <section class="screen startup-screen" aria-labelledby="startupAntennaTitle">
      <div class="startup-card">
        <div class="startup-status is-ok">${escapeHtml(t("connection.found", "Proxmark3 found"))}</div>
        <h1 id="startupAntennaTitle">${escapeHtml(t("antenna.title", "Antenna check"))}</h1>
        <p>${escapeHtml(t("antenna.body", "Remove all transponders from the antenna."))}</p>
        <div class="startup-actions">
          <button class="button" type="button" data-startup-antenna>${escapeHtml(t("action.startAntennaCheck", "Start antenna check"))}</button>
          <button class="button button-secondary" type="button" data-continue-overview>${escapeHtml(t("action.continueOverview", "Continue to overview"))}</button>
        </div>
      </div>
    </section>
  `;
}

function renderStartupAntennaRunning() {
  return `
    <section class="screen startup-screen" aria-labelledby="startupAntennaRunningTitle">
      <div class="startup-card">
        <div class="startup-spinner" aria-hidden="true"></div>
        <h1 id="startupAntennaRunningTitle">${escapeHtml(t("antenna.title", "Antenna check"))}</h1>
        <p>${escapeHtml(state.antennaOperation?.message || "Antennenprüfung läuft ...")}</p>
      </div>
    </section>
  `;
}

function renderStartupAntennaResult() {
  return `
    <section class="screen startup-screen" aria-labelledby="startupAntennaResultTitle">
      <div class="startup-card">
        <div class="startup-status is-ok">${escapeHtml(t("connection.deviceConnected", "Device connected"))}</div>
        <h1 id="startupAntennaResultTitle">${escapeHtml(t("antenna.title", "Antenna check"))}</h1>
        ${renderAntennaResult(state.antennaResult)}
      </div>
    </section>
  `;
}

function renderStartupAntennaError() {
  return `
    <section class="screen startup-screen" aria-labelledby="startupAntennaErrorTitle">
      <div class="startup-card">
        <div class="startup-status is-warn">${escapeHtml(t("connection.failed", "Connection check failed"))}</div>
        <h1 id="startupAntennaErrorTitle">${escapeHtml(t("antenna.error", "Antenna check could not be completed."))}</h1>
        <p>${escapeHtml(state.antennaOperation?.message || state.connection.message || "")}</p>
        <div class="startup-actions">
          <button class="button" type="button" data-startup-antenna>${escapeHtml(t("action.retry", "Retry"))}</button>
          <button class="button button-secondary" type="button" data-continue-overview>${escapeHtml(t("action.continueOverview", "Continue to overview"))}</button>
        </div>
      </div>
    </section>
  `;
}

function renderOverview() {
  return `
    <section class="screen" aria-labelledby="overviewTitle">
      <div class="overview-header">
        <div>
          <h1 id="overviewTitle" class="screen-title">${escapeHtml(t("overview.title", "Overview"))}</h1>
        </div>
        <button class="button button-secondary" type="button" data-run-startup-check>${escapeHtml(t("action.runStartupCheck", "Run startup check"))}</button>
      </div>
      <div class="overview-grid">
        <div class="panel">
          <div class="panel-header"><h2>${escapeHtml(t("overview.quickStart", "Quick Start"))}</h2></div>
          <div class="quick-steps">
            ${[1, 2, 3, 4, 5, 6].map((step) => renderQuickStep(step)).join("")}
          </div>
        </div>
        <div class="panel" data-overview-status></div>
        <div class="panel overview-help">
          <div class="panel-header"><h2>${escapeHtml(t("overview.help", "Help"))}</h2></div>
          <div class="help-list">
            ${HELP_TOPICS.map((topic) => `<button type="button" class="help-item" data-help-topic="${topic}">${escapeHtml(t(`help.${topic}.title`, topic))}</button>`).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function patchOverview() {
  replaceHtml("[data-overview-status]", renderSystemStatus());
}

function renderQuickStep(step) {
  const targets = {
    1: "read",
    2: "read",
    3: "templates",
    4: "write",
    5: "write",
    6: "write",
  };
  return `
    <button class="quick-step" type="button" data-view="${targets[step]}">
      <span>${step}</span>
      <strong>${escapeHtml(t(`overview.step${step}`, `Step ${step}`))}</strong>
    </button>
  `;
}

function renderSystemStatus() {
  const connection = state.connection;
  const compatibility = compatibilityLabel(connection.compatibility);
  const antenna = state.antennaResult
    ? `${t("antenna.lf", "LF antenna")}: ${connectionReadyLabel(state.antennaResult.lf?.status)} · ${t("antenna.hf", "HF antenna")}: ${connectionReadyLabel(state.antennaResult.hf?.status)}`
    : t("status.antennaIdle", "No antenna check in this session.");
  return `
    <div class="panel-header"><h2>${escapeHtml(t("overview.system", "System status"))}</h2></div>
    <div class="detail-list">
      <div class="detail-row"><span>${escapeHtml(t("status.pm3", "Proxmark3"))}</span><span>${escapeHtml(connection.connected ? t("status.connected", "Connected") : t("status.disconnected", "Disconnected"))}</span></div>
      <div class="detail-row"><span>${escapeHtml(t("status.device", "Device"))}</span><span>${escapeHtml(connection.target || t("connection.notAvailable", "not available"))}</span></div>
      <div class="detail-row"><span>${escapeHtml(t("status.client", "Client"))}</span><span>${escapeHtml(connection.client_version || t("connection.notAvailable", "not available"))}</span></div>
      <div class="detail-row"><span>${escapeHtml(t("status.compatibility", "Compatibility"))}</span><span>${escapeHtml(compatibility)}</span></div>
      <div class="detail-row"><span>${escapeHtml(t("antenna.title", "Antenna"))}</span><span>${escapeHtml(antenna)}</span></div>
    </div>
  `;
}

function compatibilityLabel(status) {
  if (status === "verified") return t("compat.verified", "Verified");
  if (status === "recognized_untested") return t("compat.recognizedUntested", "Recognized but untested");
  if (status === "client_firmware_mismatch") return t("compat.clientFirmwareMismatch", "Client / firmware mismatch");
  return t("compat.unknown", "Unknown");
}

function connectionReadyLabel(status) {
  return status === "ok" ? t("antenna.ready", "ready") : (status || t("compat.unknown", "Unknown"));
}

function renderReadStart() {
  return `
    <section class="screen" aria-labelledby="readTitle">
      <div class="empty-start">
        <div class="scan-card">
          <div class="scan-icon" aria-hidden="true"></div>
          <h1 id="readTitle">Chip lesen</h1>
          <p>Erstelle eine geprüfte Vorlage aus einem RFID- oder NFC-Chip.</p>
          <div class="segmented" role="tablist" aria-label="Scan-Frequenz" data-read-mode-tabs></div>
          <div class="scan-actions" data-read-actions></div>
          <p class="connection-note" data-read-connection-note></p>
        </div>
      </div>
    </section>
  `;
}

function patchReadStart() {
  const connected = state.connection.connected;
  replaceHtml("[data-read-mode-tabs]", ["auto", "lf", "hf"].map((mode) => `
    <button class="segment ${state.readMode === mode ? "is-active" : ""}" type="button" data-read-mode="${mode}">
      ${mode.toUpperCase()}
    </button>
  `).join(""));
  replaceHtml("[data-read-actions]", `
    <button class="button" type="button" data-read-scan ${connected ? "" : "disabled"}>Chip scannen</button>
    ${connected ? "" : `<button class="button button-secondary" type="button" data-refresh-connection>Verbindung erneut prüfen</button>`}
  `);
  const note = appView.querySelector("[data-read-connection-note]");
  if (note) {
    note.hidden = connected;
    note.textContent = connected ? "" : state.connection.message || "Bitte PM3 verbinden und erneut prüfen.";
  }
}

function renderReadScanning() {
  return `
    <section class="screen" aria-labelledby="scanTitle">
      <div class="scan-state">
        <div class="scan-visual" aria-hidden="true">
          <div class="antenna"><div class="chip-mini"></div></div>
        </div>
        <div>
          <h1 id="scanTitle">Chip wird gelesen</h1>
          <p class="screen-subtitle">Statuswechsel kommen aus dem Python-OperationManager.</p>
          <div class="scan-step-list" data-read-progress></div>
        </div>
      </div>
    </section>
  `;
}

function patchReadScanning() {
  const operation = state.readOperation;
  const progress = operation?.progress?.length ? operation.progress : [operation?.message || "Operation läuft ..."];
  replaceHtml("[data-read-progress]", progress.map((step, index) => `
    <div class="scan-step ${index < progress.length - 1 ? "is-done" : "is-active"}">
      <span class="step-bullet">${index < progress.length - 1 ? "✓" : index + 1}</span>
      <span>${escapeHtml(step)}</span>
    </div>
  `).join(""));
}

function renderReadUnstable() {
  return `
    <section class="screen" aria-labelledby="unstableTitle">
      <div class="scan-state">
        <div class="scan-visual" aria-hidden="true">
          <div class="antenna"><div class="chip-mini"></div></div>
        </div>
        <div>
          <h1 id="unstableTitle">Signal gefunden</h1>
          <div class="signal-banner">
            <strong>Chip leicht verschieben oder drehen</strong>
            <span>${escapeHtml(state.lastScan?.message || "Das Signal reicht noch nicht für eine sichere Vorlage.")}</span>
          </div>
          <div class="scan-actions">
            <button class="button" type="button" data-read-scan ${state.connection.connected ? "" : "disabled"}>Weiter messen</button>
            <button class="button button-secondary" type="button" data-read-scan ${state.connection.connected ? "" : "disabled"}>Erneut scannen</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderReadResult() {
  return `
    <section class="screen" aria-labelledby="resultTitle">
      <div class="result-summary">
        <div>
          <h1 id="resultTitle" class="screen-title">Chip gelesen</h1>
          <p class="screen-subtitle" data-read-result-subtitle></p>
        </div>
        <div class="result-actions" data-read-result-actions></div>
      </div>
      <div class="result-grid">
        <div class="panel panel-fit" data-read-chip-card></div>
        <div class="panel panel-fit">
          <div class="panel-header">
            <div>
              <h2>Speicherbereiche</h2>
              <div class="meta-line">nur tatsächlich gelesene Bereiche</div>
            </div>
          </div>
          <div class="data-overview" data-read-memory></div>
        </div>
      </div>
    </section>
  `;
}

function patchReadResult() {
  const scan = state.lastScan;
  if (!scan?.chip) return;
  const chip = scan.chip;
  const subtitle = scan.confirmed
    ? `${chip.technology || scan.title || "Chip"} · ${chip.frequency || ""} · zweiter Scan bestätigt`
    : `${chip.frequency || ""} · ${scan.message || "nicht als Vorlage bestätigt"}`;
  const subtitleNode = appView.querySelector("[data-read-result-subtitle]");
  if (subtitleNode) subtitleNode.textContent = subtitle;
  const scanBusy = isOperationBusy(state.readOperation);
  replaceHtml("[data-read-result-actions]", `
    <button class="info-button" type="button" data-info-chip="lastScan" aria-label="Details anzeigen">i</button>
    <button class="button" type="button" data-read-scan ${state.connection.connected && !scanBusy ? "" : "disabled"}>Neuen Chip scannen</button>
    <button class="button" type="button" data-open-save-template ${scan.canSave ? "" : "disabled"}>Als Vorlage speichern</button>
  `);
  replaceHtml("[data-read-chip-card]", renderChipCard(chip, { infoKey: "lastScan" }));
  replaceHtml("[data-read-memory]", renderDataRows(chip.memoryRegions));
}

function renderWriteView() {
  return `
    <section class="screen" data-screen="write">
      <div class="write-layout">
        <div data-compat-container></div>
        <div class="write-columns">
          <div class="panel write-column">
            <div class="panel-header"><h2>Aktueller Chip</h2></div>
            <div data-current-chip-slot></div>
            <button class="button button-secondary current-scan-button" type="button" data-write-scan></button>
            <div class="backup-line" data-current-backup-line></div>
          </div>
          <div class="panel write-column changes-column">
            <div class="panel-header"><h2>Änderungen</h2></div>
            <div data-change-list></div>
          </div>
          <div class="panel write-column">
            <div class="panel-header"><h2>Zielzustand</h2></div>
            <div data-target-control></div>
            <div data-target-chip-slot></div>
            <div class="backup-line" data-target-source-line></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function patchWriteView() {
  replaceHtml("[data-compat-container]", renderCompatibilityBar());
  replaceHtml("[data-current-chip-slot]", state.currentChip ? renderChipCard(state.currentChip, { infoKey: "currentChip" }) : renderEmptyChip("Noch kein Chip gelesen"));
  const scanButton = appView.querySelector("[data-write-scan]");
  const busy = isOperationBusy(state.currentScanOperation);
  if (scanButton) {
    scanButton.disabled = !state.connection.connected || busy;
    scanButton.textContent = busy ? "Scan läuft ..." : "Aktuellen Chip scannen";
  }
  const backupLine = appView.querySelector("[data-current-backup-line]");
  if (backupLine) {
    backupLine.hidden = !state.currentBackup;
    backupLine.textContent = state.currentBackup ? `Backup · ${state.currentBackup.created_display}` : "";
  }
  patchTargetControl();
  replaceHtml("[data-target-chip-slot]", state.target?.chip ? renderChipCard(state.target.chip, { infoKey: "target" }) : renderEmptyChip("Zielzustand auswählen"));
  const targetLine = appView.querySelector("[data-target-source-line]");
  if (targetLine) targetLine.textContent = state.target ? `Quelle: ${state.target.source}` : "Quelle: nicht ausgewählt";
  replaceHtml("[data-change-list]", renderChangeList());
}

function patchTargetControl() {
  const container = appView.querySelector("[data-target-control]");
  if (!container) return;
  const selectedTemplate = state.target?.kind === "template" ? state.target.id : "";
  const options = getSortedTemplates().map((template) => `
    <option value="${escapeHtml(template.id)}" ${selectedTemplate === template.id ? "selected" : ""}>${escapeHtml(template.name)}</option>
  `).join("");
  const html = `
    <div class="target-control">
      <select class="target-select" id="targetSelect" data-target-select aria-label="Zielvorlage">
        <option value="">Vorlage auswählen</option>
        ${options}
      </select>
      <button class="link-action" type="button" data-open-backup-targets>↶ Backup als Zielzustand verwenden</button>
    </div>
  `;
  if (container.dataset.html !== html && document.activeElement?.dataset?.targetSelect === undefined) {
    container.dataset.html = html;
    container.innerHTML = html;
  }
}

function renderCompatibilityBar() {
  if (state.comparison) {
    return `<div class="compat-bar is-${state.comparison.status === "danger" ? "danger" : "success"}">${escapeHtml(state.comparison.message)}</div>`;
  }
  if (!state.currentChip) return `<div class="compat-bar is-neutral">Aktuellen Chip scannen</div>`;
  if (!state.target) return `<div class="compat-bar is-neutral">Zielzustand auswählen</div>`;
  return `<div class="compat-bar is-neutral">Vergleich nicht verfügbar</div>`;
}

function renderChangeList() {
  if (!state.currentChip) return `<div class="no-actions">Scanne zuerst den aktuellen Chip. Danach wird automatisch ein Backup erstellt, falls der Adapter den Chip vollständig lesen kann.</div>`;
  if (!state.target) return `<div class="no-actions">Wähle rechts eine Vorlage oder ein Backup als Zielzustand.</div>`;
  if (!state.comparison) return `<div class="no-actions">Vergleich konnte für diese Kombination nicht berechnet werden.</div>`;
  if (state.comparison.status === "danger") return `<div class="no-actions">Dieser Zielzustand passt nicht zum aktuellen Chip.</div>`;

  const actions = state.comparison.actions || [];
  actions.forEach((action) => {
    state.knownActions[action.region_id] = action;
  });
  const rows = orderedActionRows(actions);
  if (!rows.length) return `<div class="no-actions no-actions-success">✓ Aktueller Chip entspricht dem Zielzustand.</div>`;
  const openCount = actions.filter((action) => action.enabled).length;
  const autoBusy = isOperationBusy(state.autoWriteOperation);
  return `
    <div>
      <div class="change-toolbar">
        <div>
          <div class="difference-count">${escapeHtml(formatOpenCount(openCount))}</div>
          ${autoBusy ? `<div class="change-status">${escapeHtml(autoProgressText())}</div>` : ""}
        </div>
        ${openCount ? `<button class="button button-small" type="button" data-write-all ${state.connection.connected && !anyWriteBusy() ? "" : "disabled"}>Alle Unterschiede übernehmen</button>` : ""}
      </div>
      <div class="change-list">
        ${rows.map(renderChangeRow).join("")}
      </div>
    </div>
  `;
}

function orderedActionRows(actions) {
  const open = new Map(actions.map((action) => [action.region_id, action]));
  const rows = [];
  for (const regionId of WRITE_ORDER) {
    if (state.completedActions[regionId] && open.has(regionId)) {
      rows.push({ ...open.get(regionId), uiState: "done" });
      continue;
    }
    if (state.completedActions[regionId]) rows.push({ ...state.completedActions[regionId], uiState: "done" });
    else if (open.has(regionId)) rows.push(open.get(regionId));
  }
  actions.forEach((action) => {
    if (!WRITE_ORDER.includes(action.region_id)) rows.push(action);
  });
  return rows;
}

function renderChangeRow(action) {
  const operation = state.writeOperations[action.region_id];
  const autoDetails = state.autoWriteOperation?.details || {};
  const running = Boolean(
    (operation && !TERMINAL_STATES.has(operation.state))
    || (isOperationBusy(state.autoWriteOperation) && autoDetails.active_region === action.region_id)
  );
  const done = action.uiState === "done" || operation?.state === "succeeded" || (autoDetails.completed_regions || []).includes(action.region_id);
  const failed = state.failedRegionId === action.region_id || (operation && TERMINAL_STATES.has(operation.state) && operation.state !== "succeeded");
  const status = running
    ? (operation?.message || state.autoWriteOperation?.message || `${action.label} wird übernommen ...`)
    : done
      ? `✓ ${action.label} übernommen`
      : failed
        ? (operation?.message || state.autoWriteOperation?.message || `${action.label} konnte nicht verifiziert werden`)
        : action.reason || "";
  return `
    <div class="change-row ${running ? "is-working" : ""} ${done ? "is-done" : ""} ${failed ? "is-failed" : ""}">
      <div class="change-label">${escapeHtml(action.label)}</div>
      <div>
        <div class="change-values">
          <span>${escapeHtml(action.fromValue)}</span>
          <span aria-hidden="true">→</span>
          <span>${escapeHtml(action.toValue)}</span>
        </div>
        ${status ? `<div class="change-status">${escapeHtml(status)}</div>` : ""}
      </div>
      ${action.enabled && !done ? `
        <button class="button button-secondary button-small" type="button" data-write-action="${escapeHtml(action.region_id)}" ${state.connection.connected && !anyWriteBusy() ? "" : "disabled"}>Übernehmen</button>
      ` : done ? `<span class="done-label">Verifiziert</span>` : `<span class="blocked-label">Gesperrt</span>`}
    </div>
  `;
}

function autoProgressText() {
  const details = state.autoWriteOperation?.details || {};
  const total = details.total_steps || state.comparison?.writable_difference_count || 0;
  const done = details.completed_steps || 0;
  return `${done} / ${total} Bereiche übernommen`;
}

function renderAnalysisView() {
  return `
    <section class="screen" aria-labelledby="analysisTitle">
      <div class="screen-head">
        <div>
          <h1 id="analysisTitle" class="screen-title">Analyse</h1>
          <p class="screen-subtitle">Nur echte PM3-Read-only-Pfade und zuletzt real gelesene Chipdaten.</p>
        </div>
      </div>
      <div class="analysis-grid">
        <div class="panel analysis-panel" data-position-panel></div>
        <div class="panel analysis-panel" data-antenna-panel></div>
        <div class="panel analysis-panel" data-technical-panel></div>
      </div>
    </section>
  `;
}

function patchAnalysisView() {
  replaceHtml("[data-position-panel]", renderPositionPanel());
  replaceHtml("[data-antenna-panel]", renderAntennaPanel());
  replaceHtml("[data-technical-panel]", renderTechnicalPanel());
}

function renderPositionPanel() {
  const busy = isOperationBusy(state.positionOperation);
  const result = state.positionResult;
  return `
    <div class="panel-header">
      <div>
        <h2>Position optimieren</h2>
        <div class="meta-line">begrenzte Read-only-Messserie</div>
      </div>
      <button class="button button-small" type="button" data-start-position ${state.connection.connected && !busy ? "" : "disabled"}>${busy ? "Messung läuft ..." : "Starten"}</button>
    </div>
    <p class="analysis-copy">Lege den Chip mittig auf und bewege ihn langsam wenige Millimeter.</p>
    ${busy ? `<div class="no-actions">${escapeHtml(state.positionOperation.message || "Messung läuft ...")}</div>` : ""}
    ${result ? renderPositionResult(result) : ""}
  `;
}

function renderPositionResult(result) {
  const history = result.history || [];
  return `
    <div class="analysis-result">
      <strong>${escapeHtml(result.title || result.status)}</strong>
      <span>${escapeHtml(result.message || "")}</span>
    </div>
    ${history.length ? `
      <div class="measurement-list">
        ${history.map((item) => `
          <div class="measurement-row">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.status)}</strong>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${result.next_step ? `<div class="meta-line">${escapeHtml(result.next_step)}</div>` : ""}
  `;
}

function renderAntennaPanel() {
  const busy = isOperationBusy(state.antennaOperation);
  return `
    <div class="panel-header">
      <div>
        <h2>Antenne prüfen</h2>
        <div class="meta-line">nutzt echten hw tune-Pfad</div>
      </div>
      <button class="button button-small" type="button" data-start-antenna ${state.connection.connected && !busy ? "" : "disabled"}>${busy ? "Prüfung läuft ..." : "Prüfen"}</button>
    </div>
    ${busy ? `<div class="no-actions">${escapeHtml(state.antennaOperation.message || "Antennenprüfung läuft ...")}</div>` : ""}
    ${state.antennaResult ? renderAntennaResult(state.antennaResult) : `<div class="no-actions">Noch keine Antennenprüfung in dieser Sitzung.</div>`}
  `;
}

function renderAntennaResult(result) {
  const lf = result.lf || {};
  const hf = result.hf || {};
  return `
    <div class="detail-list">
      <div class="detail-row"><span>${escapeHtml(t("antenna.lf", "LF antenna"))}</span><span>${escapeHtml(lf.status || t("compat.unknown", "Unknown"))}</span></div>
      ${lf.voltage_125khz ? `<div class="detail-row"><span>125 kHz</span><span>${escapeHtml(lf.voltage_125khz)}</span></div>` : ""}
      ${lf.optimal_frequency || lf.optimal_voltage ? `<div class="detail-row"><span>Optimalbereich</span><span>${escapeHtml([lf.optimal_frequency, lf.optimal_voltage].filter(Boolean).join(" · "))}</span></div>` : ""}
      <div class="detail-row"><span>${escapeHtml(t("antenna.hf", "HF antenna"))}</span><span>${escapeHtml(hf.status || t("compat.unknown", "Unknown"))}</span></div>
      ${hf.voltage_13_56mhz ? `<div class="detail-row"><span>13.56 MHz</span><span>${escapeHtml(hf.voltage_13_56mhz)}</span></div>` : ""}
    </div>
  `;
}

function renderTechnicalPanel() {
  const chip = state.currentChip || state.lastScan?.chip;
  const details = chip?.details || {};
  const rows = Object.entries(details).filter(([, value]) => value);
  return `
    <div class="panel-header">
      <div>
        <h2>Technische Details</h2>
        <div class="meta-line">zuletzt real gelesener Chip</div>
      </div>
    </div>
    ${rows.length ? `
      <div class="detail-list">
        ${rows.map(([label, value]) => `
          <div class="detail-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>
        `).join("")}
      </div>
    ` : `<div class="no-actions">Noch kein real gelesener Chip in dieser Sitzung.</div>`}
  `;
}

function renderTemplatesView() {
  return `
    <section class="screen" aria-labelledby="templatesTitle">
      <div class="screen-head">
        <div>
          <h1 id="templatesTitle" class="screen-title">Vorlagen</h1>
          <p class="screen-subtitle">Vorlagen kommen aus dem echten Storage.</p>
        </div>
        <div class="template-toolbar">
          <input class="search-input" type="search" placeholder="Vorlagen durchsuchen ..." value="${escapeHtml(state.templateSearch)}" data-template-search />
          <select class="compact-select" data-template-type-filter aria-label="Chiptyp filtern"></select>
          <select class="compact-select" data-template-sort aria-label="Vorlagen sortieren">
            ${templateSortOptions().map(([value, label]) => `<option value="${value}" ${state.templateSort === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="button button-secondary" type="button" data-import-templates>Importieren</button>
        </div>
      </div>
      <div class="management-list" data-template-list></div>
    </section>
  `;
}

function patchTemplatesView() {
  const typeFilter = appView.querySelector("[data-template-type-filter]");
  if (typeFilter) {
    const options = [["all", "Alle Chiptypen"], ...templateTypes().map((type) => [type, type])];
    const html = options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${state.templateTypeFilter === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    if (typeFilter.dataset.html !== html) {
      typeFilter.dataset.html = html;
      typeFilter.innerHTML = html;
    }
  }
  replaceHtml("[data-template-list]", renderTemplateList());
}

function renderTemplateList() {
  const templates = getVisibleTemplates();
  return templates.length
    ? templates.map(renderTemplateItem).join("")
    : `<div class="no-actions">Keine passenden Vorlagen im Storage gefunden.</div>`;
}

function renderTemplateItem(template) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(template.name)}</h2>
        <div class="item-meta">${escapeHtml(template.technology)} · ${escapeHtml(template.frequency)} · UID ${escapeHtml(template.uid || "")}</div>
        <div class="item-meta">Erstellt: ${escapeHtml(template.created_display || "")}</div>
        ${template.description ? `<p>${escapeHtml(template.description)}</p>` : ""}
        ${template.category ? `<p>Kategorie / Notiz: ${escapeHtml(template.category)}</p>` : ""}
      </div>
      <div class="item-actions">
        <button class="button button-small" type="button" data-use-template-target="${escapeHtml(template.id)}">Als Zielzustand verwenden</button>
        <button class="kebab-button" type="button" data-template-menu="${escapeHtml(template.id)}" aria-label="Weitere Aktionen">⋯</button>
      </div>
    </article>
  `;
}

function renderBackupsView() {
  return `
    <section class="screen" aria-labelledby="backupsTitle">
      <div class="screen-head">
        <div>
          <h1 id="backupsTitle" class="screen-title">Backups</h1>
          <p class="screen-subtitle">Backups werden erst nach einem tatsächlichen Chip-Read gespeichert.</p>
        </div>
        <div class="template-toolbar">
          <input class="search-input" type="search" placeholder="Backups durchsuchen ..." value="${escapeHtml(state.backupSearch)}" data-backup-search />
          <select class="compact-select" data-backup-sort aria-label="Backups sortieren">
            ${backupSortOptions().map(([value, label]) => `<option value="${value}" ${state.backupSort === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="management-list" data-backup-list></div>
    </section>
  `;
}

function patchBackupsView() {
  replaceHtml("[data-backup-list]", renderBackupList());
}

function renderBackupList() {
  const backups = getVisibleBackups();
  return backups.length
    ? backups.map(renderBackupItem).join("")
    : `<div class="no-actions">Keine passenden Backups im Storage gefunden.</div>`;
}

function renderBackupItem(backup) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(backup.technology)}</h2>
        <div class="item-meta">UID: ${escapeHtml(backup.uid || "")}</div>
        <div class="item-meta">Erstellt: ${escapeHtml(backup.created_display || "")}</div>
        <p>Quelle: ${escapeHtml(backup.source || "Backup")}</p>
      </div>
      <div class="item-actions">
        <button class="button button-small" type="button" data-use-backup-target="${escapeHtml(backup.id)}">Als Zielzustand verwenden</button>
        <button class="kebab-button" type="button" data-backup-menu="${escapeHtml(backup.id)}" aria-label="Weitere Aktionen">⋯</button>
      </div>
    </article>
  `;
}

function templateSortOptions() {
  return [
    ["newest", "Neueste zuerst"],
    ["oldest", "Älteste zuerst"],
    ["name_asc", "Name A-Z"],
    ["name_desc", "Name Z-A"],
    ["technology", "Chiptyp"],
  ];
}

function backupSortOptions() {
  return [
    ["newest", "Neueste zuerst"],
    ["oldest", "Älteste zuerst"],
    ["technology", "Chiptyp"],
    ["uid", "UID"],
  ];
}

function templateTypes() {
  return [...new Set(state.templates.map((template) => template.technology).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
}

function getSortedTemplates() {
  const templates = [...state.templates];
  const byDate = (template) => {
    const timestamp = Date.parse(template.created_at || "");
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" });
  if (state.templateSort === "oldest") return templates.sort((a, b) => byDate(a) - byDate(b) || byName(a, b));
  if (state.templateSort === "name_asc") return templates.sort(byName);
  if (state.templateSort === "name_desc") return templates.sort((a, b) => byName(b, a));
  if (state.templateSort === "technology") {
    return templates.sort((a, b) => (
      String(a.technology || "").localeCompare(String(b.technology || ""), "de", { sensitivity: "base" })
      || byName(a, b)
    ));
  }
  return templates.sort((a, b) => byDate(b) - byDate(a) || byName(a, b));
}

function getVisibleTemplates() {
  const query = state.templateSearch.trim().toLowerCase();
  return getSortedTemplates().filter((template) => {
    const typeMatches = state.templateTypeFilter === "all" || template.technology === state.templateTypeFilter;
    const haystack = [template.name, template.description, template.technology, template.category].join(" ").toLowerCase();
    return typeMatches && (!query || haystack.includes(query));
  });
}

function getVisibleBackups() {
  const query = state.backupSearch.trim().toLowerCase();
  const backups = [...state.backups];
  const byDate = (backup) => {
    const timestamp = Date.parse(backup.created_at || "");
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };
  const byTechnology = (a, b) => String(a.technology || "").localeCompare(String(b.technology || ""), "de", { sensitivity: "base" });
  const byUid = (a, b) => String(a.uid || "").localeCompare(String(b.uid || ""), "de", { sensitivity: "base" });
  if (state.backupSort === "oldest") backups.sort((a, b) => byDate(a) - byDate(b));
  else if (state.backupSort === "technology") backups.sort((a, b) => byTechnology(a, b) || byDate(b) - byDate(a));
  else if (state.backupSort === "uid") backups.sort((a, b) => byUid(a, b) || byDate(b) - byDate(a));
  else backups.sort((a, b) => byDate(b) - byDate(a));
  return backups.filter((backup) => {
    const haystack = [backup.technology, backup.uid, backup.created_display, backup.source].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });
}

function renderChipCard(chip, options = {}) {
  const regions = Array.isArray(chip.memoryRegions) ? chip.memoryRegions : [];
  const facts = chipFacts(chip);
  return `
    <article class="chip-card">
      <div class="chip-card-head">
        <div>
          <strong>${escapeHtml(chip.technology || "Chip")}</strong>
          <span>${escapeHtml(chip.frequency || "")}</span>
        </div>
        <span class="chip-status-badge">${escapeHtml(statusLabel(chip))}</span>
        ${options.infoKey ? `<button class="info-button" type="button" data-info-chip="${escapeHtml(options.infoKey)}" aria-label="Details anzeigen">i</button>` : ""}
      </div>
      <div class="chip-facts">
        ${facts.map((field) => `
          <div class="fact">
            <span class="fact-label">${escapeHtml(field.label)}</span>
            <span class="fact-value">${escapeHtml(field.value || "")}</span>
          </div>
        `).join("")}
      </div>
      ${regions.length ? `
        <div class="segment-block">
          <div class="chip-core" aria-hidden="true"><div class="chip-core-inner"></div></div>
          <div class="memory-segments" aria-label="Speichersegmente">
            ${regions.map((region) => `<div class="memory-segment is-${memorySegmentState(region)}">${escapeHtml(memorySegmentLabel(region))}</div>`).join("")}
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function chipFacts(chip) {
  return [
    { label: "UID", value: chip.uid },
    { label: "Config", value: chip.config },
    { label: "Frequenz", value: chip.frequency },
    { label: "Speicher", value: chip.memoryRange },
  ].filter((field) => field.value);
}

function statusLabel(chip) {
  if (chip.read_status === "identity_read") return "ID gelesen";
  if (chip.support_level === "detected_only") return "erkannt";
  return chip.config ? "Details gelesen" : "bereit";
}

function memorySegmentState(region) {
  const regionId = region.id;
  const autoDetails = state.autoWriteOperation?.details || {};
  if (state.failedRegionId === regionId || autoDetails.failed_region === regionId) return "failed";
  if (isOperationBusy(state.autoWriteOperation) && autoDetails.active_region === regionId) return "working";
  if ((autoDetails.completed_regions || []).includes(regionId) || state.completedActions[regionId]) return "verified";
  if ((state.comparison?.actions || []).some((action) => action.region_id === regionId)) return "different";
  if (!region.value) return "unavailable";
  return "neutral";
}

function memorySegmentLabel(region) {
  const source = `${region?.label || ""} ${region?.id || ""}`;
  const match = source.match(/\d+/);
  return match ? match[0] : "•";
}

function renderDataRows(regions) {
  if (!Array.isArray(regions) || !regions.length) {
    return `<div class="no-actions">Keine Speicherbereiche gelesen.</div>`;
  }
  return regions.map((region) => `
    <div class="data-row">
      <strong>${escapeHtml(region.label)}</strong>
      <span>${escapeHtml(region.value)}</span>
    </div>
  `).join("");
}

function renderEmptyChip(label) {
  return `
    <div class="empty-state">
      <div class="empty-chip" aria-hidden="true"></div>
      <strong>${escapeHtml(label)}</strong>
    </div>
  `;
}

function formatOpenCount(count) {
  return count === 1 ? "1 offene Änderung" : `${count || 0} offene Änderungen`;
}

async function boot() {
  state.bridgeReady = Boolean(bridge());
  render();
  if (!state.bridgeReady) return;
  const settingsResponse = await callBridge("get_app_settings");
  state.settings = settingsResponse.settings || state.settings;
  await setLanguage(state.settings.language || "en", false);
  if (!state.settings.language) {
    state.startupFlow = "language";
    render();
    return;
  }
  if (state.settings.show_startup_check_on_launch !== false) {
    await runStartupCheck();
  } else {
    state.startupFlow = "done";
  }
  await loadCollections();
  await loadTarget();
  render();
}

async function refreshConnection() {
  state.connection = { status: "checking", connected: false, message: t("connection.checking", "Verbindung wird geprüft ...") };
  setStatus(t("connection.checking", "Verbindung wird geprüft ..."));
  render();
  try {
    state.connection = await callBridge("refresh_connection");
    setStatus(state.connection.connected ? t("app.ready", "Bereit") : state.connection.message);
  } catch (error) {
    state.connection = { status: "disconnected", connected: false, message: error.message };
    setStatus(error.message);
  }
  render();
}

async function runStartupCheck() {
  state.startupFlow = "checking";
  state.startupChecked = false;
  state.antennaOperation = null;
  setStatus(t("connection.checking", "Checking Proxmark3 connection ..."));
  render();
  await refreshConnection();
  state.startupChecked = true;
  if (state.connection.connected) {
    state.startupFlow = "antenna-ready";
    setStatus(t("connection.deviceConnected", "Device connected"));
  } else {
    state.startupFlow = "antenna-error";
    setStatus(state.connection.message || t("connection.noDevice", "No compatible device found"));
  }
  render();
}

async function continueToOverview() {
  state.startupFlow = "done";
  state.startupCompleted = true;
  state.activeView = "overview";
  if (state.bridgeReady && !state.settings.first_run_completed) {
    const response = await callBridge("complete_first_run");
    state.settings = response.settings || state.settings;
  }
  renderedScreenKey = "";
  setStatus(neutralStatusMessage());
  render();
}

async function loadCollections() {
  const [templates, backups] = await Promise.all([
    callBridge("list_templates"),
    callBridge("list_backups"),
  ]);
  state.templates = templates.templates || [];
  state.backups = backups.backups || [];
}

async function loadTarget() {
  const response = await callBridge("get_target_state");
  state.target = response.target || null;
}

async function refreshComparison() {
  if (!state.currentChip || !state.target) {
    state.comparison = null;
    return;
  }
  const response = await callBridge("compare_current_to_target");
  state.comparison = response.ok ? response.comparison : null;
}

async function syncCurrentAndComparison(trackCompleted = false) {
  const previousActions = new Map((state.comparison?.actions || []).map((action) => [action.region_id, action]));
  const current = await callBridge("get_current_chip");
  state.currentChip = current.chip;
  state.currentBackup = current.backup;
  await refreshComparison();
  if (trackCompleted) {
    const nextIds = new Set((state.comparison?.actions || []).map((action) => action.region_id));
    previousActions.forEach((action, regionId) => {
      if (!nextIds.has(regionId)) state.completedActions[regionId] = state.knownActions[regionId] || action;
    });
  }
}

async function startReadScan() {
  if (!state.connection.connected) return;
  if (isOperationBusy(state.readOperation)) return;
  state.lastScan = null;
  state.readOperation = { operation_id: "pending", state: "queued", message: "Scan wird gestartet ...", progress: ["Scan wird gestartet ..."] };
  setStatus("Chip wird gelesen ...");
  render();
  const response = await callBridge("start_scan", state.readMode);
  state.readOperation = { operation_id: response.operation_id, state: "queued", message: "Scan wird gestartet ...", progress: [] };
  pollOperation(response.operation_id, "readOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.lastScan = operation.result;
      setTransientStatus(operation.result?.message || operation.message);
    } else {
      setStatus(operation.message);
      if (operation.state === "connection_lost") {
        state.connection = { status: "lost", connected: false, message: operation.message };
      }
    }
  });
}

async function startCurrentChipScan() {
  if (!state.connection.connected) return;
  if (isOperationBusy(state.currentScanOperation)) return;
  state.currentChip = null;
  state.currentBackup = null;
  state.comparison = null;
  state.completedActions = {};
  state.failedRegionId = null;
  state.currentScanOperation = { operation_id: "pending", state: "queued", message: "Aktueller Chip wird gelesen ...", progress: ["Scan wird gestartet ..."] };
  setStatus("Aktueller Chip wird gelesen ...");
  render();
  const response = await callBridge("start_current_chip_scan");
  state.currentScanOperation = { operation_id: response.operation_id, state: "queued", message: "Aktueller Chip wird gelesen ...", progress: [] };
  pollOperation(response.operation_id, "currentScanOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.currentChip = operation.result.chip;
      state.currentBackup = operation.result.backup;
      await loadCollections();
      await refreshComparison();
      setTransientStatus(operation.result.message);
    } else {
      setStatus(operation.message);
      if (operation.state === "connection_lost") {
        state.connection = { status: "lost", connected: false, message: operation.message };
      }
    }
  });
}

async function startWriteAction(regionId) {
  if (isOperationBusy(state.writeOperations[regionId]) || anyWriteBusy()) return;
  const response = await callBridge("start_write_region", regionId);
  state.writeOperations[regionId] = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus("Schreibaktion gestartet");
  render();
  pollWriteOperation(response.operation_id, regionId);
}

async function startWriteAll() {
  if (anyWriteBusy()) return;
  state.completedActions = {};
  state.failedRegionId = null;
  const response = await callBridge("start_write_all");
  state.autoWriteOperation = { operation_id: response.operation_id, state: "queued", progress: [], details: {} };
  setStatus("Alle Unterschiede werden übernommen");
  render();
  pollAutoWriteOperation(response.operation_id);
}

async function pollOperation(operationId, stateKey, done) {
  const operation = await callBridge("get_operation_state", operationId);
  state[stateKey] = operation;
  setStatus(operation.message);
  render();
  if (!TERMINAL_STATES.has(operation.state)) {
    window.setTimeout(() => pollOperation(operationId, stateKey, done), 500);
    return;
  }
  await done(operation);
  render();
}

async function pollWriteOperation(operationId, regionId) {
  const operation = await callBridge("get_write_operation_state", operationId);
  state.writeOperations[regionId] = operation;
  setStatus(operation.message);
  render();
  if (!TERMINAL_STATES.has(operation.state)) {
    window.setTimeout(() => pollWriteOperation(operationId, regionId), 500);
    return;
  }
  if (operation.state === "succeeded") {
    state.completedActions[regionId] = state.knownActions[regionId] || { region_id: regionId, label: regionId };
    await syncCurrentAndComparison();
    showToast(operation.result?.message || "Schreibaktion verifiziert");
    setTransientStatus(operation.result?.message || operation.message);
  } else {
    state.failedRegionId = regionId;
    setStatus(operation.message);
  }
  if (operation.state === "connection_lost") {
    state.connection = { status: "lost", connected: false, message: operation.message };
    state.currentChip = null;
    state.currentBackup = null;
    state.comparison = null;
  }
  render();
}

async function pollAutoWriteOperation(operationId) {
  const operation = await callBridge("get_write_operation_state", operationId);
  const previousCompleted = new Set(state.autoWriteOperation?.details?.completed_regions || []);
  state.autoWriteOperation = operation;
  const details = operation.details || {};
  (details.completed_regions || []).forEach((regionId) => {
    if (state.knownActions[regionId]) state.completedActions[regionId] = state.knownActions[regionId];
  });
  if (details.failed_region) state.failedRegionId = details.failed_region;
  const completedChanged = (details.completed_regions || []).some((regionId) => !previousCompleted.has(regionId));
  if (completedChanged || TERMINAL_STATES.has(operation.state)) {
    await syncCurrentAndComparison(true);
  }
  setStatus(operation.message);
  render();
  if (!TERMINAL_STATES.has(operation.state)) {
    window.setTimeout(() => pollAutoWriteOperation(operationId), 500);
    return;
  }
  if (operation.state === "succeeded") {
    showToast(operation.result?.message || "Alle Unterschiede verifiziert");
    setTransientStatus(operation.result?.message || operation.message);
  } else if (operation.state === "connection_lost") {
    state.connection = { status: "lost", connected: false, message: operation.message };
    state.currentChip = null;
    state.currentBackup = null;
    state.comparison = null;
  } else {
    setStatus(operation.message);
  }
  render();
}

async function startPositionCheck() {
  if (isOperationBusy(state.positionOperation)) return;
  const response = await callBridge("start_position_check");
  state.positionOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus("Position wird geprüft ...");
  render();
  pollOperation(response.operation_id, "positionOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.positionResult = operation.result.position;
      setTransientStatus(operation.result.message);
    } else if (operation.state === "connection_lost") {
      state.connection = { status: "lost", connected: false, message: operation.message };
      setStatus(operation.message);
    } else {
      setStatus(operation.message);
    }
  });
}

async function startAntennaCheck(options = {}) {
  if (isOperationBusy(state.antennaOperation)) return;
  const response = await callBridge("start_antenna_check");
  state.antennaOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  if (options.startup) state.startupFlow = "antenna-running";
  setStatus("Antennenprüfung läuft ...");
  render();
  pollOperation(response.operation_id, "antennaOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.antennaResult = operation.result.antenna;
      setTransientStatus(operation.result.message);
      if (options.startup) {
        state.startupFlow = "antenna-result";
        window.setTimeout(() => {
          continueToOverview();
        }, TRANSIENT_STATUS_MS);
      }
    } else if (operation.state === "connection_lost") {
      state.connection = { status: "lost", connected: false, message: operation.message };
      if (options.startup) state.startupFlow = "antenna-error";
      setStatus(operation.message);
    } else {
      if (options.startup) state.startupFlow = "antenna-error";
      setStatus(operation.message);
    }
  });
}

async function saveTemplate(form) {
  const formData = new FormData(form);
  const response = await callBridge(
    "save_template",
    String(formData.get("name") || ""),
    String(formData.get("description") || ""),
    String(formData.get("category") || ""),
  );
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  closeModal();
  await loadCollections();
  showToast("Vorlage gespeichert");
  setTransientStatus("Vorlage gespeichert");
  render();
}

async function updateTemplate(form) {
  const formData = new FormData(form);
  const response = await callBridge("update_template", form.dataset.templateId, {
    name: String(formData.get("name") || ""),
    description: String(formData.get("description") || ""),
    category: String(formData.get("category") || ""),
  });
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  closeModal();
  await loadCollections();
  setTransientStatus("Vorlage aktualisiert");
  render();
}

async function useTemplateTarget(templateId) {
  const response = await callBridge("set_target_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  state.target = response.target;
  state.completedActions = {};
  state.failedRegionId = null;
  await refreshComparison();
  setActiveView("write");
  setTransientStatus("Vorlage als Zielzustand verwendet");
}

async function useBackupTarget(backupId) {
  const response = await callBridge("use_backup_as_target", backupId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  state.target = response.target;
  state.completedActions = {};
  state.failedRegionId = null;
  await refreshComparison();
  setActiveView("write");
  setTransientStatus("Backup als Zielzustand verwendet");
}

async function deleteTemplate(templateId) {
  const response = await callBridge("delete_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  closeModal();
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setTransientStatus("Vorlage gelöscht");
  render();
}

async function duplicateTemplate(templateId) {
  const response = await callBridge("duplicate_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  clearPopover();
  await loadCollections();
  setTransientStatus("Vorlage dupliziert");
  render();
}

async function deleteBackup(backupId) {
  const response = await callBridge("delete_backup", backupId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  closeModal();
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setTransientStatus("Backup gelöscht");
  render();
}

async function importTemplates() {
  const response = await callBridge("import_existing_templates");
  await loadCollections();
  showToast(response.message || "Import abgeschlossen");
  setTransientStatus(response.message || "Import abgeschlossen");
  render();
}

function setActiveView(view) {
  clearPopover();
  state.startupFlow = "done";
  state.activeView = view;
  appView.scrollTop = 0;
  appView.scrollLeft = 0;
  render();
  resetStatusForView();
  appView.focus({ preventScroll: true });
}

function openSaveTemplateModal() {
  if (!state.lastScan?.canSave) return;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="saveTitle">
      <h2 id="saveTitle">Vorlage speichern</h2>
      <form class="form-grid" data-save-template-form>
        <div class="form-field">
          <label for="templateName">Name</label>
          <input id="templateName" name="name" autocomplete="off" required />
        </div>
        <div class="form-field">
          <label for="templateDescription">Beschreibung</label>
          <textarea id="templateDescription" name="description"></textarea>
        </div>
        <div class="form-field">
          <label for="templateCategory">Kategorie / Notiz</label>
          <input id="templateCategory" name="category" autocomplete="off" />
        </div>
        <div class="modal-actions">
          <button class="button button-secondary" type="button" data-close-modal>Abbrechen</button>
          <button class="button" type="submit">Speichern</button>
        </div>
      </form>
    </div>
  `;
  modalRoot.querySelector("input")?.focus();
}

function openEditTemplateModal(templateId) {
  clearPopover();
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="editTitle">
      <h2 id="editTitle">Vorlage bearbeiten</h2>
      <form class="form-grid" data-edit-template-form data-template-id="${escapeHtml(template.id)}">
        <div class="form-field">
          <label for="editName">Name</label>
          <input id="editName" name="name" value="${escapeHtml(template.name)}" autocomplete="off" required />
        </div>
        <div class="form-field">
          <label for="editDescription">Beschreibung</label>
          <textarea id="editDescription" name="description">${escapeHtml(template.description || "")}</textarea>
        </div>
        <div class="form-field">
          <label for="editCategory">Kategorie / Notiz</label>
          <input id="editCategory" name="category" value="${escapeHtml(template.category || "")}" autocomplete="off" />
        </div>
        <div class="modal-actions">
          <button class="button button-secondary" type="button" data-close-modal>Abbrechen</button>
          <button class="button" type="submit">Speichern</button>
        </div>
      </form>
    </div>
  `;
  modalRoot.querySelector("input")?.focus();
}

function openConfirmDeleteTemplate(templateId) {
  clearPopover();
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="deleteTemplateTitle">
      <h2 id="deleteTemplateTitle">Vorlage wirklich löschen?</h2>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>Abbrechen</button>
        <button class="button button-danger" type="button" data-confirm-delete-template="${escapeHtml(templateId)}">Löschen</button>
      </div>
    </div>
  `;
}

function openConfirmDeleteBackup(backupId) {
  clearPopover();
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="deleteBackupTitle">
      <h2 id="deleteBackupTitle">Backup wirklich löschen?</h2>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>Abbrechen</button>
        <button class="button button-danger" type="button" data-confirm-delete-backup="${escapeHtml(backupId)}">Löschen</button>
      </div>
    </div>
  `;
}

function openBackupDetails(backupId) {
  clearPopover();
  const backup = state.backups.find((item) => item.id === backupId);
  if (!backup) return;
  const chip = backup.chip || {};
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="backupDetailsTitle">
      <h2 id="backupDetailsTitle">Backupdetails</h2>
      <div class="detail-list">
        <div class="detail-row"><span>Chiptyp</span><span>${escapeHtml(backup.technology || "")}</span></div>
        <div class="detail-row"><span>UID</span><span>${escapeHtml(backup.uid || "")}</span></div>
        <div class="detail-row"><span>Config</span><span>${escapeHtml(chip.config || "")}</span></div>
        <div class="detail-row"><span>Zeitpunkt</span><span>${escapeHtml(backup.created_display || "")}</span></div>
        <div class="detail-row"><span>Quelle</span><span>${escapeHtml(backup.source || "")}</span></div>
      </div>
      <div class="data-overview modal-data">
        ${renderDataRows(chip.memoryRegions)}
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>Schließen</button>
      </div>
    </div>
  `;
}

function closeModal() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
}

function openBackupTargetPopover(trigger) {
  clearPopover();
  const items = state.backups.length ? state.backups.map((backup) => `
    <button class="popover-option" type="button" data-use-backup-target="${escapeHtml(backup.id)}">
      <strong>${escapeHtml(backup.technology)}</strong>
      <span>${escapeHtml(backup.created_display || "")} · UID ${escapeHtml(backup.uid || "")}</span>
    </button>
  `).join("") : `<div class="no-actions">Keine Backups vorhanden.</div>`;
  openPopover(trigger, `<h3>Backup wählen</h3><div class="popover-list">${items}</div>`);
}

function openTemplateMenu(trigger, templateId) {
  openPopover(trigger, `
    <div class="popover-list">
      <button class="popover-option" type="button" data-edit-template="${escapeHtml(templateId)}">Bearbeiten</button>
      <button class="popover-option" type="button" data-duplicate-template="${escapeHtml(templateId)}">Duplizieren</button>
      <button class="popover-option is-danger" type="button" data-delete-template="${escapeHtml(templateId)}">Löschen</button>
    </div>
  `);
}

function openBackupMenu(trigger, backupId) {
  openPopover(trigger, `
    <div class="popover-list">
      <button class="popover-option" type="button" data-backup-details="${escapeHtml(backupId)}">Details anzeigen</button>
      <button class="popover-option is-danger" type="button" data-delete-backup="${escapeHtml(backupId)}">Löschen</button>
    </div>
  `);
}

function openInfoPopover(trigger) {
  const details = detailsForKey(trigger.dataset.infoChip);
  if (!details) return;
  openPopover(trigger, `
    <h3>Details</h3>
    <div class="detail-list">
      ${Object.entries(details).map(([label, value]) => `
        <div class="detail-row">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(value)}</span>
        </div>
      `).join("")}
    </div>
  `);
}

function openPopover(trigger, html) {
  clearPopover();
  const rect = trigger.getBoundingClientRect();
  const shellRect = document.querySelector("[data-app-shell]").getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover";
  popover.setAttribute("role", "dialog");
  popover.style.top = `${Math.min(rect.bottom + 8, shellRect.bottom - 292)}px`;
  popover.style.left = `${Math.max(shellRect.left + 12, Math.min(rect.left, shellRect.right - 334))}px`;
  popover.innerHTML = html;
  document.body.appendChild(popover);
  state.activePopover = popover;
}

function detailsForKey(key) {
  if (key === "lastScan") return state.lastScan?.chip?.details;
  if (key === "currentChip") return state.currentChip?.details;
  if (key === "target") return state.target?.chip?.details;
  return null;
}

function openHelpModal(topic) {
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
      <h2 id="helpTitle">${escapeHtml(t(`help.${topic}.title`, topic))}</h2>
      <p class="screen-subtitle">${escapeHtml(t(`help.${topic}.body`, ""))}</p>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
      </div>
    </div>
  `;
}

function showStatusModal() {
  const connection = state.connection;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pm3StatusTitle">
      <h2 id="pm3StatusTitle">PM3-Status</h2>
      <div class="detail-list">
        <div class="detail-row"><span>Status</span><span>${escapeHtml(connection.connected ? t("status.connected", "Connected") : connection.status)}</span></div>
        <div class="detail-row"><span>Port</span><span>${escapeHtml(connection.port || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.device", "Device"))}</span><span>${escapeHtml(connection.target || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.client", "Client"))}</span><span>${escapeHtml(connection.client_version || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.compatibility", "Compatibility"))}</span><span>${escapeHtml(compatibilityLabel(connection.compatibility))}</span></div>
        <div class="detail-row"><span>Meldung</span><span>${escapeHtml(connection.message || "")}</span></div>
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
      </div>
    </div>
  `;
}

function showAboutModal() {
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
      <h2 id="aboutTitle">${escapeHtml(t("about.title", "RFID Workflow"))}</h2>
      <p class="screen-subtitle">${escapeHtml(t("about.body", "Local pywebview app through the real Python PM3 bridge."))}</p>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
      </div>
    </div>
  `;
}

function clearPopover() {
  if (state.activePopover) {
    state.activePopover.remove();
    state.activePopover = null;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastRoot.hidden = false;
  toastRoot.innerHTML = `<div class="toast" role="status"><span>${escapeHtml(message)}</span></div>`;
  toastTimer = setTimeout(() => {
    toastRoot.hidden = true;
    toastRoot.innerHTML = "";
  }, 3200);
}

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;

  const languageChoice = target.closest("[data-choose-language]");
  if (languageChoice) {
    await setLanguage(languageChoice.dataset.chooseLanguage || "en", true);
    await runStartupCheck();
    await loadCollections();
    await loadTarget();
    return;
  }

  if (target.closest("[data-continue-overview]")) {
    await continueToOverview();
    return;
  }

  if (target.closest("[data-startup-antenna]")) {
    await startAntennaCheck({ startup: true });
    return;
  }

  const helpTopic = target.closest("[data-help-topic]");
  if (helpTopic) {
    openHelpModal(helpTopic.dataset.helpTopic);
    return;
  }

  const navButton = target.closest("[data-view]");
  if (navButton) {
    setActiveView(navButton.dataset.view);
    return;
  }

  if (target.closest("[data-settings-toggle]")) {
    settingsPanel.hidden = !settingsPanel.hidden;
    return;
  }
  if (!target.closest("[data-settings-panel]") && !target.closest("[data-settings-toggle]")) {
    settingsPanel.hidden = true;
  }

  if (target.closest("[data-refresh-connection]")) {
    await refreshConnection();
    return;
  }
  if (target.closest("[data-run-startup-check]")) {
    settingsPanel.hidden = true;
    await runStartupCheck();
    return;
  }
  if (target.closest("[data-show-pm3-status]")) {
    showStatusModal();
    return;
  }
  if (target.closest("[data-import-templates]")) {
    await importTemplates();
    return;
  }
  if (target.closest("[data-advanced-tools]")) {
    showToast("Erweiterte Werkzeuge sind in dieser echten App nicht freigeschaltet.");
    return;
  }
  if (target.closest("[data-about]")) {
    showAboutModal();
    return;
  }

  const readMode = target.closest("[data-read-mode]");
  if (readMode) {
    state.readMode = readMode.dataset.readMode;
    setTransientStatus(`Scanmodus ${state.readMode.toUpperCase()}`);
    render();
    return;
  }
  if (target.closest("[data-read-scan]")) {
    await startReadScan();
    return;
  }
  if (target.closest("[data-open-save-template]")) {
    openSaveTemplateModal();
    return;
  }
  if (target.closest("[data-write-scan]")) {
    await startCurrentChipScan();
    return;
  }

  if (target.closest("[data-write-all]")) {
    await startWriteAll();
    return;
  }
  const writeAction = target.closest("[data-write-action]");
  if (writeAction) {
    await startWriteAction(writeAction.dataset.writeAction);
    return;
  }
  const info = target.closest("[data-info-chip]");
  if (info) {
    openInfoPopover(info);
    return;
  }
  if (target.closest("[data-open-backup-targets]")) {
    openBackupTargetPopover(target.closest("[data-open-backup-targets]"));
    return;
  }
  const useBackup = target.closest("[data-use-backup-target]");
  if (useBackup) {
    await useBackupTarget(useBackup.dataset.useBackupTarget);
    return;
  }
  const useTemplate = target.closest("[data-use-template-target]");
  if (useTemplate) {
    await useTemplateTarget(useTemplate.dataset.useTemplateTarget);
    return;
  }
  const templateMenu = target.closest("[data-template-menu]");
  if (templateMenu) {
    openTemplateMenu(templateMenu, templateMenu.dataset.templateMenu);
    return;
  }
  const backupMenu = target.closest("[data-backup-menu]");
  if (backupMenu) {
    openBackupMenu(backupMenu, backupMenu.dataset.backupMenu);
    return;
  }
  const editTemplate = target.closest("[data-edit-template]");
  if (editTemplate) {
    openEditTemplateModal(editTemplate.dataset.editTemplate);
    return;
  }
  const duplicate = target.closest("[data-duplicate-template]");
  if (duplicate) {
    await duplicateTemplate(duplicate.dataset.duplicateTemplate);
    return;
  }
  const deleteTemplateButton = target.closest("[data-delete-template]");
  if (deleteTemplateButton) {
    openConfirmDeleteTemplate(deleteTemplateButton.dataset.deleteTemplate);
    return;
  }
  const confirmDeleteTemplate = target.closest("[data-confirm-delete-template]");
  if (confirmDeleteTemplate) {
    await deleteTemplate(confirmDeleteTemplate.dataset.confirmDeleteTemplate);
    return;
  }
  const backupDetails = target.closest("[data-backup-details]");
  if (backupDetails) {
    openBackupDetails(backupDetails.dataset.backupDetails);
    return;
  }
  const deleteBackupButton = target.closest("[data-delete-backup]");
  if (deleteBackupButton) {
    openConfirmDeleteBackup(deleteBackupButton.dataset.deleteBackup);
    return;
  }
  const confirmDeleteBackup = target.closest("[data-confirm-delete-backup]");
  if (confirmDeleteBackup) {
    await deleteBackup(confirmDeleteBackup.dataset.confirmDeleteBackup);
    return;
  }
  if (target.closest("[data-start-position]")) {
    await startPositionCheck();
    return;
  }
  if (target.closest("[data-start-antenna]")) {
    await startAntennaCheck();
    return;
  }
  if (target.closest("[data-close-modal]")) {
    closeModal();
    return;
  }
  if (!target.closest(".popover")) clearPopover();
});

document.addEventListener("change", async (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.matches("[data-language-select]")) {
    await setLanguage(event.target.value || "en", true);
    return;
  }
  if (event.target.matches("[data-startup-on-launch]")) {
    const response = await callBridge("update_app_settings", {
      show_startup_check_on_launch: event.target.checked,
    });
    state.settings = response.settings || state.settings;
    applyStaticTranslations();
    return;
  }
  if (event.target.matches("[data-template-sort]")) {
    state.templateSort = event.target.value || "newest";
    render();
    return;
  }
  if (event.target.matches("[data-template-type-filter]")) {
    state.templateTypeFilter = event.target.value || "all";
    render();
    return;
  }
  if (event.target.matches("[data-backup-sort]")) {
    state.backupSort = event.target.value || "newest";
    render();
    return;
  }
  if (event.target.matches("[data-target-select]")) {
    const templateId = event.target.value;
    if (templateId) {
      await useTemplateTarget(templateId);
    } else {
      state.target = null;
      state.comparison = null;
      render();
    }
  }
});

document.addEventListener("input", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.matches("[data-template-search]")) {
    state.templateSearch = event.target.value || "";
    patchTemplatesView();
  }
  if (event.target.matches("[data-backup-search]")) {
    state.backupSearch = event.target.value || "";
    patchBackupsView();
  }
});

document.addEventListener("submit", async (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  if (event.target.matches("[data-save-template-form]")) {
    event.preventDefault();
    await saveTemplate(event.target);
  }
  if (event.target.matches("[data-edit-template-form]")) {
    event.preventDefault();
    await updateTemplate(event.target);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    clearPopover();
    settingsPanel.hidden = true;
  }
});

window.__rfidGuiApp = {
  state,
  render,
  screenKey,
  patchScreen,
};

window.addEventListener("pywebviewready", boot, { once: true });
window.setTimeout(() => {
  if (!state.bridgeReady) boot();
}, 800);

render();
