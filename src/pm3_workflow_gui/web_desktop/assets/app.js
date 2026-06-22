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
const LEGACY_MESSAGE_KEYS = new Map([
  ["Verbindung wird geprüft ...", "connection.checking"],
  ["Verbindung verloren", "connection.lost"],
  ["Verbindung verloren · Bitte PM3 neu verbinden.", "connection.reconnect"],
  ["Operation läuft ...", "operation.running"],
  ["Operation abgeschlossen", "operation.completed"],
  ["Operation fehlgeschlagen.", "operation.failed"],
  ["Scan wird gestartet ...", "operation.scanStarting"],
  ["Chip wird gelesen ...", "operation.chipReading"],
  ["Aktueller Chip wird gelesen ...", "operation.currentChipReading"],
  ["Backup wird gespeichert ...", "operation.backupSaving"],
  ["Backup erstellt", "operation.backupCreated"],
  ["Antennenprüfung läuft ...", "operation.antennaRunning"],
  ["Antennenpruefung laeuft ...", "operation.antennaRunning"],
  ["Antennenpruefung abgeschlossen", "operation.antennaCompleted"],
  ["Position wird geprüft ...", "operation.positionRunning"],
  ["Position wird mit echten Read-only-Messungen geprueft ...", "operation.positionRunning"],
  ["PM3 wird geprueft ...", "operation.pm3Checking"],
  ["PM3 verbunden", "connection.pm3Connected"],
  ["Kein kompatibles Gerät gefunden", "connection.noDevice"],
  ["Kein Proxmark erkannt. Bitte PM3 verbinden und erneut pruefen.", "connection.noDeviceReconnect"],
  ["Noch kein Scan vorhanden.", "read.noScan"],
  ["nicht ausgefuehrt", "read.secondScanNotRun"],
  ["nicht bestaetigt", "read.secondScanUnconfirmed"],
  ["Vorlage gespeichert", "template.saved"],
  ["Vorlage aktualisiert", "template.updated"],
  ["Vorlage dupliziert", "template.duplicated"],
  ["Vorlage geloescht", "template.deleted"],
  ["Backup geloescht", "backup.deleted"],
  ["Vorlage als Zielzustand verwendet", "template.usedAsTarget"],
  ["Backup als Zielzustand verwendet", "backup.usedAsTarget"],
  ["Import abgeschlossen", "template.importCompleted"],
  ["Schreibaktion gestartet", "write.actionStarted"],
  ["Schreibaktion verifiziert", "write.actionVerified"],
  ["Alle Unterschiede werden übernommen", "write.allStarting"],
  ["Alle Unterschiede uebernommen und verifiziert", "write.allVerified"],
  ["Alle Unterschiede verifiziert", "write.allVerified"],
  ["Keine offenen Unterschiede", "write.noOpenDifferences"],
]);

const fallbackLocales = { en: {} };

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
    message_key: "connection.checking",
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
  activeModal: null,
};

function bridge() {
  return window.pywebview?.api || null;
}

async function callBridge(method, ...args) {
  const api = bridge();
  if (!api || typeof api[method] !== "function") {
    throw new Error("pywebview bridge unavailable.");
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

function uiMessage(source, fallbackKey = "", fallback = "") {
  if (!source) return fallbackKey ? t(fallbackKey, fallback) : fallback;
  const payload = typeof source === "string" ? { message: source } : source;
  const message = String(payload.message || payload.error || fallback || "");
  const key = payload.message_key || payload.messageKey || payload.status_key || LEGACY_MESSAGE_KEYS.get(message);
  if (!key) return message;
  return formatTemplate(t(key, message), payload.message_args || payload.messageArgs || {});
}

function formatTemplate(template, args) {
  return Object.entries(args || {}).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function operationProgress(operation, fallbackKey = "operation.running") {
  const progress = operation?.progress?.length ? operation.progress : [operation?.message || ""];
  return progress.map((step, index) => uiMessage({ message: step, message_key: operation?.progress_keys?.[index] }, fallbackKey));
}

function setConnectionLost(operation) {
  state.connection = {
    status: "lost",
    connected: false,
    message: operation?.message,
    message_key: operation?.message_key || LEGACY_MESSAGE_KEYS.get(operation?.message || "") || "connection.lost",
  };
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
  rerenderActiveModal();
  resetStatusForView();
}

function isOperationBusy(operation) {
  return Boolean(operation && !TERMINAL_STATES.has(operation.state));
}

function anyWriteBusy() {
  return isOperationBusy(state.autoWriteOperation) || Object.values(state.writeOperations).some(isOperationBusy);
}

function neutralStatusMessage() {
  if (!state.bridgeReady) return t("app.ready", "Ready");
  if (state.connection.status === "lost") return t("connection.lost", "Connection lost");
  if (!state.connection.connected && (state.connection.message || state.connection.message_key)) return uiMessage(state.connection, "connection.noDevice");
  return t("app.ready", "Ready");
}

function setStatus(message, options = {}) {
  window.clearTimeout(statusTimer);
  statusTimer = null;
  statusText.textContent = message ? uiMessage(message) : neutralStatusMessage();
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
    setStatus(state.readOperation);
    return;
  }
  if (isOperationBusy(state.currentScanOperation)) {
    setStatus(state.currentScanOperation);
    return;
  }
  if (isOperationBusy(state.autoWriteOperation)) {
    setStatus(state.autoWriteOperation);
    return;
  }
  const activeWrite = Object.values(state.writeOperations).find(isOperationBusy);
  if (activeWrite) {
    setStatus(activeWrite);
    return;
  }
  if (isOperationBusy(state.positionOperation)) {
    setStatus(state.positionOperation);
    return;
  }
  if (isOperationBusy(state.antennaOperation)) {
    setStatus(state.antennaOperation);
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
    ? `${t("connection.found", "Proxmark3 found")} · ${connection.port || "auto"} · ${connection.target || "PM3"}`
    : connection.status === "lost"
      ? t("connection.lost", "Connection lost")
      : connection.status === "checking"
        ? t("connection.checking", "Checking Proxmark3 connection ...")
        : t("connection.noDevice", "No compatible device found");
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
          <h1>${escapeHtml(t("bridgeMissing.title", "Desktop bridge unavailable"))}</h1>
          <p>${escapeHtml(t("bridgeMissing.body", "Start this interface in the pywebview window. Without the Python bridge no PM3 states are shown."))}</p>
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
        <p>${escapeHtml(uiMessage(state.antennaOperation, "operation.antennaRunning"))}</p>
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
        <p>${escapeHtml(uiMessage(state.antennaOperation || state.connection, "antenna.error"))}</p>
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
          <h1 id="readTitle">${escapeHtml(t("read.title", "Read chip"))}</h1>
          <p>${escapeHtml(t("read.body", "Create a verified template from a supported RFID or NFC chip."))}</p>
          <div class="segmented" role="tablist" aria-label="${escapeHtml(t("read.modeLabel", "Scan frequency"))}" data-read-mode-tabs></div>
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
    <button class="button" type="button" data-read-scan ${connected ? "" : "disabled"}>${escapeHtml(t("read.scanChip", "Scan chip"))}</button>
    ${connected ? "" : `<button class="button button-secondary" type="button" data-refresh-connection>${escapeHtml(t("connection.retryCheck", "Check connection again"))}</button>`}
  `);
  const note = appView.querySelector("[data-read-connection-note]");
  if (note) {
    note.hidden = connected;
    note.textContent = connected ? "" : uiMessage(state.connection, "connection.noDeviceReconnect");
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
          <h1 id="scanTitle">${escapeHtml(t("read.scanningTitle", "Reading chip"))}</h1>
          <p class="screen-subtitle">${escapeHtml(t("read.scanningSubtitle", "Status updates come from the Python operation manager."))}</p>
          <div class="scan-step-list" data-read-progress></div>
        </div>
      </div>
    </section>
  `;
}

function patchReadScanning() {
  const operation = state.readOperation;
  const progress = operationProgress(operation, "operation.running");
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
          <h1 id="unstableTitle">${escapeHtml(t("read.unstableTitle", "Signal found"))}</h1>
          <div class="signal-banner">
            <strong>${escapeHtml(t("read.unstableHint", "Move or rotate the chip slightly"))}</strong>
            <span>${escapeHtml(uiMessage(state.lastScan, "read.unstableBody"))}</span>
          </div>
          <div class="scan-actions">
            <button class="button" type="button" data-read-scan ${state.connection.connected ? "" : "disabled"}>${escapeHtml(t("read.continueMeasuring", "Continue measuring"))}</button>
            <button class="button button-secondary" type="button" data-read-scan ${state.connection.connected ? "" : "disabled"}>${escapeHtml(t("read.scanAgain", "Scan again"))}</button>
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
          <h1 id="resultTitle" class="screen-title">${escapeHtml(t("read.resultTitle", "Chip read"))}</h1>
          <p class="screen-subtitle" data-read-result-subtitle></p>
        </div>
        <div class="result-actions" data-read-result-actions></div>
      </div>
      <div class="result-grid">
        <div class="panel panel-fit" data-read-chip-card></div>
        <div class="panel panel-fit">
          <div class="panel-header">
            <div>
              <h2>${escapeHtml(t("chip.memoryAreas", "Memory areas"))}</h2>
              <div class="meta-line">${escapeHtml(t("read.memorySubtitle", "only areas actually read"))}</div>
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
    ? `${chip.technology || scan.title || t("chip.generic", "Chip")} · ${chip.frequency || ""} · ${t("read.secondScanConfirmed", "second scan confirmed")}`
    : `${chip.frequency || ""} · ${uiMessage(scan, "read.notTemplateConfirmed")}`;
  const subtitleNode = appView.querySelector("[data-read-result-subtitle]");
  if (subtitleNode) subtitleNode.textContent = subtitle;
  const scanBusy = isOperationBusy(state.readOperation);
  replaceHtml("[data-read-result-actions]", `
    <button class="info-button" type="button" data-info-chip="lastScan" aria-label="${escapeHtml(t("action.showDetails", "Show details"))}">i</button>
    <button class="button" type="button" data-read-scan ${state.connection.connected && !scanBusy ? "" : "disabled"}>${escapeHtml(t("read.scanNewChip", "Scan new chip"))}</button>
    <button class="button" type="button" data-open-save-template ${scan.canSave ? "" : "disabled"}>${escapeHtml(t("template.saveAs", "Save as template"))}</button>
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
            <div class="panel-header"><h2>${escapeHtml(t("write.currentChip", "Current chip"))}</h2></div>
            <div data-current-chip-slot></div>
            <button class="button button-secondary current-scan-button" type="button" data-write-scan></button>
            <div class="backup-line" data-current-backup-line></div>
          </div>
          <div class="panel write-column changes-column">
            <div class="panel-header"><h2>${escapeHtml(t("write.changes", "Changes"))}</h2></div>
            <div data-change-list></div>
          </div>
          <div class="panel write-column">
            <div class="panel-header"><h2>${escapeHtml(t("write.targetState", "Target state"))}</h2></div>
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
  replaceHtml("[data-current-chip-slot]", state.currentChip ? renderChipCard(state.currentChip, { infoKey: "currentChip" }) : renderEmptyChip(t("write.noCurrentChip", "No chip read yet")));
  const scanButton = appView.querySelector("[data-write-scan]");
  const busy = isOperationBusy(state.currentScanOperation);
  if (scanButton) {
    scanButton.disabled = !state.connection.connected || busy;
    scanButton.textContent = busy ? t("operation.scanRunning", "Scan running ...") : t("write.scanCurrentChip", "Scan current chip");
  }
  const backupLine = appView.querySelector("[data-current-backup-line]");
  if (backupLine) {
    backupLine.hidden = !state.currentBackup;
    backupLine.textContent = state.currentBackup ? `Backup · ${state.currentBackup.created_display}` : "";
  }
  patchTargetControl();
  replaceHtml("[data-target-chip-slot]", state.target?.chip ? renderChipCard(state.target.chip, { infoKey: "target" }) : renderEmptyChip(t("write.chooseTargetState", "Choose target state")));
  const targetLine = appView.querySelector("[data-target-source-line]");
  if (targetLine) targetLine.textContent = state.target ? `${t("label.source", "Source")}: ${state.target.source}` : t("write.sourceNotSelected", "Source: not selected");
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
      <select class="target-select" id="targetSelect" data-target-select aria-label="${escapeHtml(t("write.targetTemplateLabel", "Target template"))}">
        <option value="">${escapeHtml(t("write.chooseTemplate", "Choose template"))}</option>
        ${options}
      </select>
      <button class="link-action" type="button" data-open-backup-targets>${escapeHtml(t("write.useBackupTarget", "Use backup as target state"))}</button>
    </div>
  `;
  if (container.dataset.html !== html && document.activeElement?.dataset?.targetSelect === undefined) {
    container.dataset.html = html;
    container.innerHTML = html;
  }
}

function renderCompatibilityBar() {
  if (state.comparison) {
    return `<div class="compat-bar is-${state.comparison.status === "danger" ? "danger" : "success"}">${escapeHtml(comparisonMessage(state.comparison))}</div>`;
  }
  if (!state.currentChip) return `<div class="compat-bar is-neutral">${escapeHtml(t("write.scanCurrentChip", "Scan current chip"))}</div>`;
  if (!state.target) return `<div class="compat-bar is-neutral">${escapeHtml(t("write.chooseTargetState", "Choose target state"))}</div>`;
  return `<div class="compat-bar is-neutral">${escapeHtml(t("write.comparisonUnavailable", "Comparison unavailable"))}</div>`;
}

function renderChangeList() {
  if (!state.currentChip) return `<div class="no-actions">${escapeHtml(t("write.emptyCurrent", "Scan the current chip first. A backup is created automatically when the adapter can read the chip completely."))}</div>`;
  if (!state.target) return `<div class="no-actions">${escapeHtml(t("write.emptyTarget", "Choose a template or backup as the target state."))}</div>`;
  if (!state.comparison) return `<div class="no-actions">${escapeHtml(t("write.emptyComparison", "The comparison could not be calculated for this combination."))}</div>`;
  if (state.comparison.status === "danger") return `<div class="no-actions">${escapeHtml(t("write.incompatibleTarget", "This target state does not match the current chip."))}</div>`;

  const actions = state.comparison.actions || [];
  actions.forEach((action) => {
    state.knownActions[action.region_id] = action;
  });
  const rows = orderedActionRows(actions);
  if (!rows.length) return `<div class="no-actions no-actions-success">✓ ${escapeHtml(t("write.matchesTarget", "Current chip matches the target state."))}</div>`;
  const openCount = actions.filter((action) => action.enabled).length;
  const autoBusy = isOperationBusy(state.autoWriteOperation);
  return `
    <div>
      <div class="change-toolbar">
        <div>
          <div class="difference-count">${escapeHtml(formatOpenCount(openCount))}</div>
          ${autoBusy ? `<div class="change-status">${escapeHtml(autoProgressText())}</div>` : ""}
        </div>
        ${openCount ? `<button class="button button-small" type="button" data-write-all ${state.connection.connected && !anyWriteBusy() ? "" : "disabled"}>${escapeHtml(t("write.applyAll", "Apply all differences"))}</button>` : ""}
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
    ? uiMessage(operation || state.autoWriteOperation, "write.regionApplying", `${action.label} is being applied ...`)
    : done
      ? `✓ ${action.label} ${t("write.regionAppliedSuffix", "applied")}`
      : failed
        ? uiMessage(operation || state.autoWriteOperation, "write.regionVerifyFailed", `${action.label} konnte nicht verifiziert werden`)
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
        <button class="button button-secondary button-small" type="button" data-write-action="${escapeHtml(action.region_id)}" ${state.connection.connected && !anyWriteBusy() ? "" : "disabled"}>${escapeHtml(t("action.apply", "Apply"))}</button>
      ` : done ? `<span class="done-label">${escapeHtml(t("write.verified", "Verified"))}</span>` : `<span class="blocked-label">${escapeHtml(t("write.blocked", "Blocked"))}</span>`}
    </div>
  `;
}

function autoProgressText() {
  const details = state.autoWriteOperation?.details || {};
  const total = details.total_steps || state.comparison?.writable_difference_count || 0;
  const done = details.completed_steps || 0;
  return t("write.autoProgress", "{done} / {total} areas applied").replace("{done}", done).replace("{total}", total);
}

function comparisonMessage(comparison) {
  if (!comparison.compatible) return t("write.comparisonIncompatible", "Not compatible · target state does not match current chip");
  if (comparison.writable_difference_count) {
    return t("write.comparisonWritable", "Compatible · {count} applicable changes").replace("{count}", comparison.writable_difference_count);
  }
  return t("write.comparisonNoOpen", "Compatible · no open writable changes");
}

function renderAnalysisView() {
  return `
    <section class="screen" aria-labelledby="analysisTitle">
      <div class="screen-head">
        <div>
          <h1 id="analysisTitle" class="screen-title">${escapeHtml(t("analysis.title", "Analysis"))}</h1>
          <p class="screen-subtitle">${escapeHtml(t("analysis.subtitle", "Only real PM3 read-only paths and the last real chip data read."))}</p>
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
        <h2>${escapeHtml(t("analysis.positionTitle", "Optimize position"))}</h2>
        <div class="meta-line">${escapeHtml(t("analysis.positionMeta", "limited read-only measurement series"))}</div>
      </div>
      <button class="button button-small" type="button" data-start-position ${state.connection.connected && !busy ? "" : "disabled"}>${escapeHtml(busy ? t("operation.measurementRunning", "Measurement running ...") : t("action.start", "Start"))}</button>
    </div>
    <p class="analysis-copy">${escapeHtml(t("analysis.positionCopy", "Place the chip centered and move it slowly by a few millimeters."))}</p>
    ${busy ? `<div class="no-actions">${escapeHtml(uiMessage(state.positionOperation, "operation.measurementRunning"))}</div>` : ""}
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
        <h2>${escapeHtml(t("analysis.antennaTitle", "Check antenna"))}</h2>
        <div class="meta-line">${escapeHtml(t("analysis.antennaMeta", "uses the real hw tune path"))}</div>
      </div>
      <button class="button button-small" type="button" data-start-antenna ${state.connection.connected && !busy ? "" : "disabled"}>${escapeHtml(busy ? t("operation.checkRunning", "Check running ...") : t("action.check", "Check"))}</button>
    </div>
    ${busy ? `<div class="no-actions">${escapeHtml(uiMessage(state.antennaOperation, "operation.antennaRunning"))}</div>` : ""}
    ${state.antennaResult ? renderAntennaResult(state.antennaResult) : `<div class="no-actions">${escapeHtml(t("status.antennaIdle", "No antenna check in this session."))}</div>`}
  `;
}

function renderAntennaResult(result) {
  const lf = result.lf || {};
  const hf = result.hf || {};
  return `
    <div class="detail-list">
      <div class="detail-row"><span>${escapeHtml(t("antenna.lf", "LF antenna"))}</span><span>${escapeHtml(lf.status || t("compat.unknown", "Unknown"))}</span></div>
      ${lf.voltage_125khz ? `<div class="detail-row"><span>125 kHz</span><span>${escapeHtml(lf.voltage_125khz)}</span></div>` : ""}
      ${lf.optimal_frequency || lf.optimal_voltage ? `<div class="detail-row"><span>${escapeHtml(t("antenna.optimalRange", "Optimal range"))}</span><span>${escapeHtml([lf.optimal_frequency, lf.optimal_voltage].filter(Boolean).join(" · "))}</span></div>` : ""}
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
        <h2>${escapeHtml(t("analysis.technicalTitle", "Technical details"))}</h2>
        <div class="meta-line">${escapeHtml(t("analysis.technicalMeta", "last real chip read"))}</div>
      </div>
    </div>
    ${rows.length ? `
      <div class="detail-list">
        ${rows.map(([label, value]) => `
          <div class="detail-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>
        `).join("")}
      </div>
    ` : `<div class="no-actions">${escapeHtml(t("analysis.noRealChip", "No real chip read in this session yet."))}</div>`}
  `;
}

function renderTemplatesView() {
  return `
    <section class="screen" aria-labelledby="templatesTitle">
      <div class="screen-head">
        <div>
          <h1 id="templatesTitle" class="screen-title">${escapeHtml(t("templates.title", "Templates"))}</h1>
          <p class="screen-subtitle">${escapeHtml(t("templates.subtitle", "Templates come from real local storage."))}</p>
        </div>
        <div class="template-toolbar">
          <input class="search-input" type="search" placeholder="${escapeHtml(t("templates.searchPlaceholder", "Search templates ..."))}" value="${escapeHtml(state.templateSearch)}" data-template-search />
          <select class="compact-select" data-template-type-filter aria-label="${escapeHtml(t("templates.filterType", "Filter chip type"))}"></select>
          <select class="compact-select" data-template-sort aria-label="${escapeHtml(t("templates.sort", "Sort templates"))}">
            ${templateSortOptions().map(([value, label]) => `<option value="${value}" ${state.templateSort === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="button button-secondary" type="button" data-import-templates>${escapeHtml(t("action.import", "Import"))}</button>
        </div>
      </div>
      <div class="management-list" data-template-list></div>
    </section>
  `;
}

function patchTemplatesView() {
  const typeFilter = appView.querySelector("[data-template-type-filter]");
  if (typeFilter) {
    const options = [["all", t("templates.allTypes", "All chip types")], ...templateTypes().map((type) => [type, type])];
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
    : `<div class="no-actions">${escapeHtml(t("templates.empty", "No matching templates found in storage."))}</div>`;
}

function renderTemplateItem(template) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(template.name)}</h2>
        <div class="item-meta">${escapeHtml(template.technology)} · ${escapeHtml(template.frequency)} · UID ${escapeHtml(template.uid || "")}</div>
        <div class="item-meta">${escapeHtml(t("label.created", "Created"))}: ${escapeHtml(template.created_display || "")}</div>
        ${template.description ? `<p>${escapeHtml(template.description)}</p>` : ""}
        ${template.category ? `<p>${escapeHtml(t("template.categoryNote", "Category / note"))}: ${escapeHtml(template.category)}</p>` : ""}
      </div>
      <div class="item-actions">
        <button class="button button-small" type="button" data-use-template-target="${escapeHtml(template.id)}">${escapeHtml(t("write.useAsTarget", "Use as target state"))}</button>
        <button class="kebab-button" type="button" data-template-menu="${escapeHtml(template.id)}" aria-label="${escapeHtml(t("action.moreActions", "More actions"))}">⋯</button>
      </div>
    </article>
  `;
}

function renderBackupsView() {
  return `
    <section class="screen" aria-labelledby="backupsTitle">
      <div class="screen-head">
        <div>
          <h1 id="backupsTitle" class="screen-title">${escapeHtml(t("backups.title", "Backups"))}</h1>
          <p class="screen-subtitle">${escapeHtml(t("backups.subtitle", "Backups are saved only after an actual chip read."))}</p>
        </div>
        <div class="template-toolbar">
          <input class="search-input" type="search" placeholder="${escapeHtml(t("backups.searchPlaceholder", "Search backups ..."))}" value="${escapeHtml(state.backupSearch)}" data-backup-search />
          <select class="compact-select" data-backup-sort aria-label="${escapeHtml(t("backups.sort", "Sort backups"))}">
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
    : `<div class="no-actions">${escapeHtml(t("backups.empty", "No matching backups found in storage."))}</div>`;
}

function renderBackupItem(backup) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(backup.technology)}</h2>
        <div class="item-meta">UID: ${escapeHtml(backup.uid || "")}</div>
        <div class="item-meta">${escapeHtml(t("label.created", "Created"))}: ${escapeHtml(backup.created_display || "")}</div>
        <p>${escapeHtml(t("label.source", "Source"))}: ${escapeHtml(backup.source || t("backups.title", "Backup"))}</p>
      </div>
      <div class="item-actions">
        <button class="button button-small" type="button" data-use-backup-target="${escapeHtml(backup.id)}">${escapeHtml(t("write.useAsTarget", "Use as target state"))}</button>
        <button class="kebab-button" type="button" data-backup-menu="${escapeHtml(backup.id)}" aria-label="${escapeHtml(t("action.moreActions", "More actions"))}">⋯</button>
      </div>
    </article>
  `;
}

function templateSortOptions() {
  return [
    ["newest", t("sort.newest", "Newest first")],
    ["oldest", t("sort.oldest", "Oldest first")],
    ["name_asc", "Name A-Z"],
    ["name_desc", "Name Z-A"],
    ["technology", t("chip.type", "Chip type")],
  ];
}

function backupSortOptions() {
  return [
    ["newest", t("sort.newest", "Newest first")],
    ["oldest", t("sort.oldest", "Oldest first")],
    ["technology", t("chip.type", "Chip type")],
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
          <strong>${escapeHtml(chip.technology || t("chip.generic", "Chip"))}</strong>
          <span>${escapeHtml(chip.frequency || "")}</span>
        </div>
        <span class="chip-status-badge">${escapeHtml(statusLabel(chip))}</span>
        ${options.infoKey ? `<button class="info-button" type="button" data-info-chip="${escapeHtml(options.infoKey)}" aria-label="${escapeHtml(t("action.showDetails", "Show details"))}">i</button>` : ""}
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
          <div class="memory-segments" aria-label="${escapeHtml(t("chip.memorySegments", "Memory segments"))}">
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
    { label: t("chip.frequency", "Frequency"), value: chip.frequency },
    { label: t("chip.memory", "Memory"), value: chip.memoryRange },
  ].filter((field) => field.value);
}

function statusLabel(chip) {
  if (chip.read_status === "identity_read") return t("chip.statusIdRead", "ID read");
  if (chip.support_level === "detected_only") return t("chip.statusDetected", "detected");
  return chip.config ? t("chip.statusDetailsRead", "Details read") : t("antenna.ready", "ready");
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
    return `<div class="no-actions">${escapeHtml(t("chip.noMemoryRead", "No memory areas read."))}</div>`;
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
  return count === 1 ? t("write.openChangeOne", "1 open change") : t("write.openChangeMany", "{count} open changes").replace("{count}", count || 0);
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
  state.connection = { status: "checking", connected: false, message_key: "connection.checking" };
  setStatus(t("connection.checking", "Checking Proxmark3 connection ..."));
  render();
  try {
    state.connection = await callBridge("refresh_connection");
    setStatus(state.connection.connected ? t("app.ready", "Ready") : state.connection);
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
    setStatus(state.connection);
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
  state.readOperation = { operation_id: "pending", state: "queued", message_key: "operation.scanStarting", progress: ["Starting scan ..."], progress_keys: ["operation.scanStarting"] };
  setStatus(t("operation.chipReading", "Reading chip ..."));
  render();
  const response = await callBridge("start_scan", state.readMode);
  state.readOperation = { operation_id: response.operation_id, state: "queued", message_key: "operation.scanStarting", progress: [] };
  pollOperation(response.operation_id, "readOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.lastScan = operation.result;
      setTransientStatus(uiMessage(operation.result || operation));
    } else {
      setStatus(operation);
      if (operation.state === "connection_lost") {
        setConnectionLost(operation);
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
  state.currentScanOperation = { operation_id: "pending", state: "queued", message_key: "operation.currentChipReading", progress: ["Starting scan ..."], progress_keys: ["operation.scanStarting"] };
  setStatus(t("operation.currentChipReading", "Current chip is being read ..."));
  render();
  const response = await callBridge("start_current_chip_scan");
  state.currentScanOperation = { operation_id: response.operation_id, state: "queued", message_key: "operation.currentChipReading", progress: [] };
  pollOperation(response.operation_id, "currentScanOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.currentChip = operation.result.chip;
      state.currentBackup = operation.result.backup;
      await loadCollections();
      await refreshComparison();
      setTransientStatus(uiMessage(operation.result));
    } else {
      setStatus(operation);
      if (operation.state === "connection_lost") {
        setConnectionLost(operation);
      }
    }
  });
}

async function startWriteAction(regionId) {
  if (isOperationBusy(state.writeOperations[regionId]) || anyWriteBusy()) return;
  const response = await callBridge("start_write_region", regionId);
  state.writeOperations[regionId] = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus(t("write.actionStarted", "Write action started"));
  render();
  pollWriteOperation(response.operation_id, regionId);
}

async function startWriteAll() {
  if (anyWriteBusy()) return;
  state.completedActions = {};
  state.failedRegionId = null;
  const response = await callBridge("start_write_all");
  state.autoWriteOperation = { operation_id: response.operation_id, state: "queued", progress: [], details: {} };
  setStatus(t("write.allStarting", "All differences are being applied"));
  render();
  pollAutoWriteOperation(response.operation_id);
}

async function pollOperation(operationId, stateKey, done) {
  const operation = await callBridge("get_operation_state", operationId);
  state[stateKey] = operation;
  setStatus(operation);
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
  setStatus(operation);
  render();
  if (!TERMINAL_STATES.has(operation.state)) {
    window.setTimeout(() => pollWriteOperation(operationId, regionId), 500);
    return;
  }
  if (operation.state === "succeeded") {
    state.completedActions[regionId] = state.knownActions[regionId] || { region_id: regionId, label: regionId };
    await syncCurrentAndComparison();
    showToast(uiMessage(operation.result || operation, "write.actionVerified"));
    setTransientStatus(uiMessage(operation.result || operation, "write.actionVerified"));
  } else {
    state.failedRegionId = regionId;
    setStatus(operation);
  }
  if (operation.state === "connection_lost") {
    setConnectionLost(operation);
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
  setStatus(operation);
  render();
  if (!TERMINAL_STATES.has(operation.state)) {
    window.setTimeout(() => pollAutoWriteOperation(operationId), 500);
    return;
  }
  if (operation.state === "succeeded") {
    showToast(uiMessage(operation.result || operation, "write.allVerified"));
    setTransientStatus(uiMessage(operation.result || operation, "write.allVerified"));
  } else if (operation.state === "connection_lost") {
    setConnectionLost(operation);
    state.currentChip = null;
    state.currentBackup = null;
    state.comparison = null;
  } else {
    setStatus(operation);
  }
  render();
}

async function startPositionCheck() {
  if (isOperationBusy(state.positionOperation)) return;
  const response = await callBridge("start_position_check");
  state.positionOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus(t("operation.positionRunning", "Position is being checked ..."));
  render();
  pollOperation(response.operation_id, "positionOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.positionResult = operation.result.position;
      setTransientStatus(uiMessage(operation.result));
    } else if (operation.state === "connection_lost") {
      setConnectionLost(operation);
      setStatus(operation);
    } else {
      setStatus(operation);
    }
  });
}

async function startAntennaCheck(options = {}) {
  if (isOperationBusy(state.antennaOperation)) return;
  const response = await callBridge("start_antenna_check");
  state.antennaOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  if (options.startup) state.startupFlow = "antenna-running";
  setStatus(t("operation.antennaRunning", "Antenna check running ..."));
  render();
  pollOperation(response.operation_id, "antennaOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.antennaResult = operation.result.antenna;
      setTransientStatus(uiMessage(operation.result));
      if (options.startup) {
        state.startupFlow = "antenna-result";
        window.setTimeout(() => {
          continueToOverview();
        }, TRANSIENT_STATUS_MS);
      }
    } else if (operation.state === "connection_lost") {
      setConnectionLost(operation);
      if (options.startup) state.startupFlow = "antenna-error";
      setStatus(operation);
    } else {
      if (options.startup) state.startupFlow = "antenna-error";
      setStatus(operation);
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
    showToast(uiMessage(response));
    return;
  }
  closeModal();
  await loadCollections();
  showToast(t("template.saved", "Template saved"));
  setTransientStatus(t("template.saved", "Template saved"));
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
    showToast(uiMessage(response));
    return;
  }
  closeModal();
  await loadCollections();
  setTransientStatus(t("template.updated", "Template updated"));
  render();
}

async function useTemplateTarget(templateId) {
  const response = await callBridge("set_target_template", templateId);
  if (!response.ok) {
    showToast(uiMessage(response));
    return;
  }
  state.target = response.target;
  state.completedActions = {};
  state.failedRegionId = null;
  await refreshComparison();
  setActiveView("write");
  setTransientStatus(t("template.usedAsTarget", "Template used as target state"));
}

async function useBackupTarget(backupId) {
  const response = await callBridge("use_backup_as_target", backupId);
  if (!response.ok) {
    showToast(uiMessage(response));
    return;
  }
  state.target = response.target;
  state.completedActions = {};
  state.failedRegionId = null;
  await refreshComparison();
  setActiveView("write");
  setTransientStatus(t("backup.usedAsTarget", "Backup used as target state"));
}

async function deleteTemplate(templateId) {
  const response = await callBridge("delete_template", templateId);
  if (!response.ok) {
    showToast(uiMessage(response));
    return;
  }
  closeModal();
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setTransientStatus(t("template.deleted", "Template deleted"));
  render();
}

async function duplicateTemplate(templateId) {
  const response = await callBridge("duplicate_template", templateId);
  if (!response.ok) {
    showToast(uiMessage(response));
    return;
  }
  clearPopover();
  await loadCollections();
  setTransientStatus(t("template.duplicated", "Template duplicated"));
  render();
}

async function deleteBackup(backupId) {
  const response = await callBridge("delete_backup", backupId);
  if (!response.ok) {
    showToast(uiMessage(response));
    return;
  }
  closeModal();
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setTransientStatus(t("backup.deleted", "Backup deleted"));
  render();
}

async function importTemplates() {
  const response = await callBridge("import_existing_templates");
  await loadCollections();
  showToast(uiMessage(response, "template.importCompleted"));
  setTransientStatus(uiMessage(response, "template.importCompleted"));
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
  state.activeModal = { type: "saveTemplate" };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="saveTitle">
      <h2 id="saveTitle">${escapeHtml(t("template.saveTitle", "Save template"))}</h2>
      <form class="form-grid" data-save-template-form>
        <div class="form-field">
          <label for="templateName">${escapeHtml(t("field.name", "Name"))}</label>
          <input id="templateName" name="name" autocomplete="off" required />
        </div>
        <div class="form-field">
          <label for="templateDescription">${escapeHtml(t("field.description", "Description"))}</label>
          <textarea id="templateDescription" name="description"></textarea>
        </div>
        <div class="form-field">
          <label for="templateCategory">${escapeHtml(t("template.categoryNote", "Category / note"))}</label>
          <input id="templateCategory" name="category" autocomplete="off" />
        </div>
        <div class="modal-actions">
          <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
          <button class="button" type="submit">${escapeHtml(t("action.save", "Save"))}</button>
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
  state.activeModal = { type: "editTemplate", id: templateId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="editTitle">
      <h2 id="editTitle">${escapeHtml(t("template.editTitle", "Edit template"))}</h2>
      <form class="form-grid" data-edit-template-form data-template-id="${escapeHtml(template.id)}">
        <div class="form-field">
          <label for="editName">${escapeHtml(t("field.name", "Name"))}</label>
          <input id="editName" name="name" value="${escapeHtml(template.name)}" autocomplete="off" required />
        </div>
        <div class="form-field">
          <label for="editDescription">${escapeHtml(t("field.description", "Description"))}</label>
          <textarea id="editDescription" name="description">${escapeHtml(template.description || "")}</textarea>
        </div>
        <div class="form-field">
          <label for="editCategory">${escapeHtml(t("template.categoryNote", "Category / note"))}</label>
          <input id="editCategory" name="category" value="${escapeHtml(template.category || "")}" autocomplete="off" />
        </div>
        <div class="modal-actions">
          <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
          <button class="button" type="submit">${escapeHtml(t("action.save", "Save"))}</button>
        </div>
      </form>
    </div>
  `;
  modalRoot.querySelector("input")?.focus();
}

function openConfirmDeleteTemplate(templateId) {
  clearPopover();
  state.activeModal = { type: "deleteTemplate", id: templateId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="deleteTemplateTitle">
      <h2 id="deleteTemplateTitle">${escapeHtml(t("template.confirmDelete", "Delete template?"))}</h2>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
        <button class="button button-danger" type="button" data-confirm-delete-template="${escapeHtml(templateId)}">${escapeHtml(t("action.delete", "Delete"))}</button>
      </div>
    </div>
  `;
}

function openConfirmDeleteBackup(backupId) {
  clearPopover();
  state.activeModal = { type: "deleteBackup", id: backupId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="deleteBackupTitle">
      <h2 id="deleteBackupTitle">${escapeHtml(t("backup.confirmDelete", "Delete backup?"))}</h2>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
        <button class="button button-danger" type="button" data-confirm-delete-backup="${escapeHtml(backupId)}">${escapeHtml(t("action.delete", "Delete"))}</button>
      </div>
    </div>
  `;
}

function openBackupDetails(backupId) {
  clearPopover();
  const backup = state.backups.find((item) => item.id === backupId);
  if (!backup) return;
  state.activeModal = { type: "backupDetails", id: backupId };
  const chip = backup.chip || {};
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="backupDetailsTitle">
      <h2 id="backupDetailsTitle">${escapeHtml(t("backup.detailsTitle", "Backup details"))}</h2>
      <div class="detail-list">
        <div class="detail-row"><span>${escapeHtml(t("chip.type", "Chip type"))}</span><span>${escapeHtml(backup.technology || "")}</span></div>
        <div class="detail-row"><span>UID</span><span>${escapeHtml(backup.uid || "")}</span></div>
        <div class="detail-row"><span>Config</span><span>${escapeHtml(chip.config || "")}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("label.timestamp", "Timestamp"))}</span><span>${escapeHtml(backup.created_display || "")}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("label.source", "Source"))}</span><span>${escapeHtml(backup.source || "")}</span></div>
      </div>
      <div class="data-overview modal-data">
        ${renderDataRows(chip.memoryRegions)}
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
      </div>
    </div>
  `;
}

function closeModal() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
  state.activeModal = null;
}

function openBackupTargetPopover(trigger) {
  clearPopover();
  const items = state.backups.length ? state.backups.map((backup) => `
    <button class="popover-option" type="button" data-use-backup-target="${escapeHtml(backup.id)}">
      <strong>${escapeHtml(backup.technology)}</strong>
      <span>${escapeHtml(backup.created_display || "")} · UID ${escapeHtml(backup.uid || "")}</span>
    </button>
  `).join("") : `<div class="no-actions">${escapeHtml(t("backups.none", "No backups available."))}</div>`;
  openPopover(trigger, `<h3>${escapeHtml(t("backup.choose", "Choose backup"))}</h3><div class="popover-list">${items}</div>`);
}

function openTemplateMenu(trigger, templateId) {
  openPopover(trigger, `
    <div class="popover-list">
      <button class="popover-option" type="button" data-edit-template="${escapeHtml(templateId)}">${escapeHtml(t("action.edit", "Edit"))}</button>
      <button class="popover-option" type="button" data-duplicate-template="${escapeHtml(templateId)}">${escapeHtml(t("action.duplicate", "Duplicate"))}</button>
      <button class="popover-option is-danger" type="button" data-delete-template="${escapeHtml(templateId)}">${escapeHtml(t("action.delete", "Delete"))}</button>
    </div>
  `);
}

function openBackupMenu(trigger, backupId) {
  openPopover(trigger, `
    <div class="popover-list">
      <button class="popover-option" type="button" data-backup-details="${escapeHtml(backupId)}">${escapeHtml(t("action.showDetails", "Show details"))}</button>
      <button class="popover-option is-danger" type="button" data-delete-backup="${escapeHtml(backupId)}">${escapeHtml(t("action.delete", "Delete"))}</button>
    </div>
  `);
}

function openInfoPopover(trigger) {
  const details = detailsForKey(trigger.dataset.infoChip);
  if (!details) return;
  openPopover(trigger, `
    <h3>${escapeHtml(t("action.details", "Details"))}</h3>
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
  state.activeModal = { type: "help", topic };
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
  state.activeModal = { type: "status" };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pm3StatusTitle">
      <h2 id="pm3StatusTitle">${escapeHtml(t("settings.pm3Status", "PM3 status"))}</h2>
      <div class="detail-list">
        <div class="detail-row"><span>${escapeHtml(t("label.status", "Status"))}</span><span>${escapeHtml(connection.connected ? t("status.connected", "Connected") : connection.status)}</span></div>
        <div class="detail-row"><span>Port</span><span>${escapeHtml(connection.port || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.device", "Device"))}</span><span>${escapeHtml(connection.target || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.client", "Client"))}</span><span>${escapeHtml(connection.client_version || t("connection.notAvailable", "not available"))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("status.compatibility", "Compatibility"))}</span><span>${escapeHtml(compatibilityLabel(connection.compatibility))}</span></div>
        <div class="detail-row"><span>${escapeHtml(t("label.message", "Message"))}</span><span>${escapeHtml(uiMessage(connection))}</span></div>
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
      </div>
    </div>
  `;
}

function showAboutModal() {
  state.activeModal = { type: "about" };
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

function rerenderActiveModal() {
  const modal = state.activeModal;
  if (!modal || modalRoot.hidden) return;
  if (modal.type === "saveTemplate") openSaveTemplateModal();
  else if (modal.type === "editTemplate") openEditTemplateModal(modal.id);
  else if (modal.type === "deleteTemplate") openConfirmDeleteTemplate(modal.id);
  else if (modal.type === "deleteBackup") openConfirmDeleteBackup(modal.id);
  else if (modal.type === "backupDetails") openBackupDetails(modal.id);
  else if (modal.type === "help") openHelpModal(modal.topic);
  else if (modal.type === "status") showStatusModal();
  else if (modal.type === "about") showAboutModal();
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
    showToast(t("settings.advancedUnavailable", "Advanced tools are not enabled in this real app."));
    return;
  }
  if (target.closest("[data-about]")) {
    showAboutModal();
    return;
  }

  const readMode = target.closest("[data-read-mode]");
  if (readMode) {
    state.readMode = readMode.dataset.readMode;
    setTransientStatus(t("read.modeSelected", "Scan mode {mode}").replace("{mode}", state.readMode.toUpperCase()));
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
