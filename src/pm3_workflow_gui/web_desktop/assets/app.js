const appView = document.getElementById("appView");
const statusText = document.getElementById("statusText");
const statusDot  = document.getElementById("statusDot");
const statusPort = document.getElementById("statusPort");
const statusConn = document.getElementById("statusConn");
const deviceDot  = document.getElementById("deviceDot");
const devicePort = document.getElementById("devicePort");
const deviceWifi = document.getElementById("deviceWifi");
const mainTitle  = document.getElementById("mainTitle");
const mainSub    = document.getElementById("mainSub");
const headerActions = document.getElementById("headerActions");
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
  analysisShowDetails: false,
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

function enabledWriteActions() {
  return (state.comparison?.actions || []).filter((action) => action.enabled);
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
  const connected = connection.connected;
  const checking  = connection.status === "checking";
  const lost      = connection.status === "lost";

  // Sidebar device card
  if (deviceDot) {
    deviceDot.className = "device-dot" + (connected ? " is-ok" : lost ? " is-err" : "");
  }
  if (devicePort) {
    devicePort.textContent = connected
      ? `${connection.port || "auto"} · ${connection.target || "PM3"}`
      : checking ? t("connection.checking", "Verbinde…")
      : lost ? t("connection.lost", "Verbindung verloren")
      : t("connection.noDevice", "Kein Gerät");
  }
  if (deviceWifi) {
    deviceWifi.hidden = !connected;
  }

  // Status bar
  if (statusDot) {
    statusDot.className = "status-dot" + (connected ? " is-ok" : lost ? " is-err" : "");
  }
  if (statusConn) {
    statusConn.textContent = connected ? "PM3 verbunden" : "";
  }
  if (statusPort) {
    statusPort.textContent = connected ? (connection.port || "") : "";
  }

  // Template counter badge
  const badge = document.querySelector("[data-template-count]");
  if (badge) badge.textContent = (state.templates || []).length;
}

function updateNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });
  // Green dot on Lesen tab when a scan result is loaded
  const readDot = document.querySelector("[data-read-dot]");
  if (readDot) readDot.hidden = !state.lastScan?.chip;
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
  if (state.activeView === "overview") return `read:${readSurface()}`;
  if (state.activeView === "read") return `read:${readSurface()}`;
  return state.activeView;
}

const SCREEN_HEADERS = {
  "read:start":    ["Lesen",      "Chip auf den Scanner legen"],
  "read:scanning": ["Lesen",      ""],
  "read:unstable": ["Lesen",      ""],
  "read:result":   ["Lesen",      ""],
  "write":         ["Schreiben",  ""],
  "analysis":      ["Selbsttest", "Diagnose"],
  "templates":     ["Vorlagen",   "Gespeicherte Chip-Konfigurationen"],
  "backups":       ["Backups",    "Automatisch gesicherte Chip-Zustände"],
};
function updateHeader(key) {
  const [title, sub] = SCREEN_HEADERS[key] || ["PM3 Studio", ""];
  if (mainTitle) mainTitle.textContent = title;
  if (mainSub)   mainSub.textContent   = sub;
}

function render() {
  updateConnectionStatus();
  updateNavigation();
  const nextKey = screenKey();
  updateHeader(nextKey);
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

// Global handler for inline onclick="setReadMode(...)" in renderReadStart freq tabs
function setReadMode(m) {
  state.readMode = m;
  const tabsEl = appView.querySelector("[data-read-mode-tabs]");
  if (tabsEl) {
    tabsEl.innerHTML = ["auto","lf","hf"].map((mode) => `
      <div onclick="setReadMode('${mode}')" style="padding:4px 11px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;
        background:${state.readMode===mode?"rgba(59,130,246,.2)":"transparent"};
        color:${state.readMode===mode?"#3B82F6":"#4A6080"};">${mode.toUpperCase()}</div>
    `).join("");
  }
}

const PM3_READER_SVG = `<svg width="260" height="165" viewBox="0 0 300 190" fill="none">
  <rect width="300" height="190" rx="14" fill="#0E1D34" stroke="#2A4070" stroke-width="1.5"/>
  <rect x="6" y="6" width="288" height="178" rx="10" fill="#091524" stroke="#1A3050" stroke-width="1"/>
  <rect x="18" y="18" width="264" height="154" rx="8" fill="none" stroke="#243D60" stroke-width="1.8"/>
  <circle cx="222" cy="95" r="52" fill="#070E1A" stroke="#1A3050" stroke-width="1.5"/>
  <g transform="translate(208,83)" fill="none" stroke="#3B82F6" stroke-linecap="round">
    <circle cx="4" cy="12" r="2.5" fill="#3B82F6" stroke="none" style="animation:nfcPulse 2.5s ease-in-out infinite"/>
    <path d="M10 6 A8.5 8.5 0 0 1 10 18" stroke-width="2" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:.35s"/>
    <path d="M15 3 A13 13 0 0 1 15 21" stroke-width="1.7" opacity=".5" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:.7s"/>
    <path d="M20 0 A17.5 17.5 0 0 1 20 24" stroke-width="1.4" opacity=".35" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:1.05s"/>
  </g>
  <circle cx="268" cy="20" r="3.5" fill="#3B82F6" opacity=".5" style="animation:ledBlink 2.5s ease-in-out infinite;color:#3B82F6"/>
  <circle cx="280" cy="20" r="3.5" fill="#1D4ED8" opacity=".5" style="animation:ledBlink 2.5s ease-in-out infinite;animation-delay:.5s;color:#1D4ED8"/>
  <text x="22" y="175" font-family="monospace" font-size="7.5" fill="#2A4070" letter-spacing="1.8">LF · 125 kHz</text>
  <text x="190" y="168" font-family="monospace" font-size="7" fill="#1E3050" letter-spacing="1.5">HF · 13.56 MHz</text>
</svg>`;

const CHIP_SVG = (opts = {}) => `<svg width="${opts.size||76}" height="${opts.size||76}" viewBox="0 0 100 100" fill="none">
  <defs>
    <radialGradient id="cg1-${opts.id||'0'}" cx="50%" cy="38%" r="62%"><stop offset="0%" stop-color="#1C3260"/><stop offset="100%" stop-color="#09101E"/></radialGradient>
    <radialGradient id="cg2-${opts.id||'0'}" cx="45%" cy="35%" r="65%"><stop offset="0%" stop-color="#D4AC2A"/><stop offset="100%" stop-color="#7A5800"/></radialGradient>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#cg1-${opts.id||'0'})" stroke="${opts.stroke||'#2A4878'}" stroke-width="2"/>
  <circle cx="50" cy="50" r="43" fill="none" stroke="#223860" stroke-width="1.3"/>
  <circle cx="50" cy="50" r="37" fill="none" stroke="#1C3050" stroke-width="1.2"/>
  <circle cx="50" cy="50" r="31" fill="none" stroke="#162840" stroke-width="1.1"/>
  <circle cx="50" cy="50" r="13" fill="#081220" stroke="${opts.stroke||'#2A4878'}" stroke-width="1"/>
  <circle cx="50" cy="50" r="8.5" fill="url(#cg2-${opts.id||'0'})"/>
  <circle cx="50" cy="50" r="4.5" fill="#4A3600"/>
</svg>`;

function renderDarkStartup({ icon, title, sub, actions = "" }) {
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;text-align:center;padding:28px;">
      ${icon}
      <div>
        <div style="font-size:21px;font-weight:700;color:#F1F5F9;margin-bottom:8px;">${title}</div>
        ${sub ? `<div style="font-size:13.5px;color:#4A6080;line-height:1.6;max-width:360px;margin:0 auto;">${sub}</div>` : ""}
      </div>
      ${actions ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${actions}</div>` : ""}
    </div>`;
}

function darkBtn(label, attrs, style = "primary") {
  const styles = {
    primary:   "background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.32);color:#3B82F6;",
    secondary: "background:#111D30;border:1px solid #1E3050;color:#4A6080;",
    ok:        "background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#22C55E;",
  };
  return `<button type="button" ${attrs} style="padding:9px 22px;border-radius:9px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${styles[style]||styles.primary}">${label}</button>`;
}

function renderBridgeMissing() {
  return renderDarkStartup({
    icon: `<div style="width:60px;height:60px;border-radius:50%;background:rgba(239,68,68,.1);border:2px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center;font-size:26px;">⚠</div>`,
    title: escapeHtml(t("bridgeMissing.title", "Desktop bridge unavailable")),
    sub: escapeHtml(t("bridgeMissing.body", "Start in the pywebview window. Without the Python bridge no PM3 states are shown.")),
  });
}

function renderLanguageChoice() {
  return renderDarkStartup({
    icon: `<div style="font-size:40px;">🌐</div>`,
    title: escapeHtml(t("language.title", "Sprache wählen")),
    actions: darkBtn(t("language.de","Deutsch"), `data-choose-language="de"`, "primary")
           + darkBtn(t("language.en","English"),  `data-choose-language="en"`, "secondary"),
  });
}

function renderStartupChecking() {
  return renderDarkStartup({
    icon: `<div class="spinner"></div>`,
    title: escapeHtml(t("connection.checking", "Proxmark3 wird gesucht …")),
    sub: escapeHtml(state.connection.message || ""),
  });
}

function renderStartupAntennaReady() {
  return renderDarkStartup({
    icon: PM3_READER_SVG,
    title: escapeHtml(t("antenna.title", "Antennenprüfung")),
    sub: escapeHtml(t("antenna.body", "Alle Transponder von der Antenne entfernen.")),
    actions: darkBtn(t("action.startAntennaCheck","Antennenprüfung starten"), "data-startup-antenna", "ok")
           + darkBtn(t("action.continueOverview","Überspringen"), "data-continue-overview", "secondary"),
  });
}

function renderStartupAntennaRunning() {
  return renderDarkStartup({
    icon: `<div class="spinner"></div>`,
    title: escapeHtml(t("antenna.title", "Antennenprüfung")),
    sub: escapeHtml(uiMessage(state.antennaOperation, "operation.antennaRunning")),
  });
}

function renderStartupAntennaResult() {
  return renderDarkStartup({
    icon: `<div style="width:60px;height:60px;border-radius:50%;background:rgba(34,197,94,.1);border:2px solid rgba(34,197,94,.3);display:flex;align-items:center;justify-content:center;"><svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M6 15 L12 21 L24 9" stroke="#22C55E" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,
    title: escapeHtml(t("connection.deviceConnected", "Gerät verbunden")),
    sub: escapeHtml(t("antenna.title","Antennenprüfung abgeschlossen")),
    actions: darkBtn(t("action.continueOverview","Weiter"), "data-continue-overview", "ok"),
  });
}

function renderStartupAntennaError() {
  const isConnErr = !state.connection.connected && !state.antennaOperation;
  const pm3Path = state.settings?.last_known_pm3_path || "C:\\Tools\\proxmark3\\client";
  const pathHint = isConnErr
    ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(15,23,42,.6);border:1px solid #1E3050;border-radius:8px;font-size:11px;color:#64748B;text-align:left;word-break:break-all;">
        <span style="color:#475569;">Gesuchter Pfad:</span>
        <span style="color:#94A3B8;font-family:var(--mono);">${escapeHtml(pm3Path + "\\proxmark3.exe")}</span>
        <div style="margin-top:5px;color:#64748B;">Pfad falsch? ⚙ Einstellungen → <em>PM3-Pfad</em> anpassen.</div>
      </div>`
    : "";
  return renderDarkStartup({
    icon: `<div style="width:60px;height:60px;border-radius:50%;background:rgba(245,158,11,.1);border:2px solid rgba(245,158,11,.3);display:flex;align-items:center;justify-content:center;font-size:26px;">!</div>`,
    title: escapeHtml(isConnErr ? t("connection.notFound", "Proxmark3 nicht gefunden") : t("antenna.error", "Antennenprüfung fehlgeschlagen")),
    sub: escapeHtml(uiMessage(state.antennaOperation || state.connection, "antenna.error")) + pathHint,
    actions: darkBtn(t("action.retry","Wiederholen"), "data-startup-antenna", "primary")
           + darkBtn(t("action.continueOverview","Überspringen"), "data-continue-overview", "secondary"),
  });
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
  const connected = state.connection.connected;
  const freqBtns = ["auto","lf","hf"].map((m) => `
    <div onclick="setReadMode('${m}')" style="padding:4px 11px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;
      background:${state.readMode===m?"rgba(59,130,246,.2)":"transparent"};
      color:${state.readMode===m?"#3B82F6":"#4A6080"};">${m.toUpperCase()}</div>
  `).join("");
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto;position:relative;
      background:radial-gradient(ellipse 55% 55% at 50% 50%,rgba(59,130,246,.05) 0%,transparent 70%);">
      <div style="animation:chipFloat 3.5s ease-in-out infinite;">${CHIP_SVG({size:76,id:"idle"})}</div>
      <div style="animation:arrowBounce 1.2s ease-in-out infinite;margin:4px 0;">
        <svg width="12" height="24" viewBox="0 0 12 24" fill="none">
          <line x1="6" y1="0" x2="6" y2="14" stroke="rgba(59,130,246,.5)" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M1.5 12 L6 20 L10.5 12" stroke="rgba(59,130,246,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      ${PM3_READER_SVG}
      <div style="margin-top:18px;text-align:center;animation:fadeInUp .6s ease both;">
        <div style="font-size:17px;font-weight:700;color:#F1F5F9;margin-bottom:5px;">${escapeHtml(t("read.title","Chip auf den Scanner legen"))}</div>
        <div style="font-size:12.5px;color:#4A6080;max-width:300px;line-height:1.5;margin:0 auto 14px;">${escapeHtml(t("read.body","LF (125 kHz) oder HF (13.56 MHz) – automatische Erkennung"))}</div>
        <div style="display:inline-flex;gap:2px;background:#111D30;border:1px solid #1E3050;border-radius:8px;padding:3px;margin-bottom:14px;" data-read-mode-tabs>
          ${freqBtns}
        </div><br>
        <button type="button" data-read-scan ${connected?"":"disabled"}
          style="padding:9px 26px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.35);border-radius:10px;color:#3B82F6;font-family:inherit;font-size:13.5px;font-weight:600;cursor:${connected?"pointer":"not-allowed"};opacity:${connected?1:.5};">
          ${escapeHtml(t("read.scanChip","Scan starten"))}
        </button>
        ${!connected ? `<br><button type="button" data-refresh-connection style="margin-top:10px;padding:7px 18px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#4A6080;font-family:inherit;font-size:12.5px;cursor:pointer;">${escapeHtml(t("connection.retryCheck","Verbindung prüfen"))}</button>` : ""}
      </div>
    </div>`;
}

function patchReadStart() {
  // Read start is fully rebuilt on screen key change, freq tabs update via re-render
}

function renderReadScanning() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative;
      background:radial-gradient(ellipse 55% 55% at 50% 50%,rgba(59,130,246,.07) 0%,transparent 70%);">
      <div style="position:absolute;top:50%;left:50%;pointer-events:none;margin-top:-80px;">
        <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:2px solid rgba(59,130,246,.85);animation:scanRing 2s ease-out infinite;"></div>
        <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:1.5px solid rgba(59,130,246,.65);animation:scanRing 2s ease-out infinite;animation-delay:.55s;"></div>
        <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:1px solid rgba(29,78,216,.7);animation:scanRing 2s ease-out infinite;animation-delay:1.1s;"></div>
      </div>
      <div style="animation:chipLand .9s cubic-bezier(.34,1.56,.64,1) both;z-index:4;margin-bottom:-8px;">${CHIP_SVG({size:82,id:"scan",stroke:"rgba(59,130,246,.7)"})}</div>
      <div style="animation:readerPulse 1.4s ease-in-out infinite;border-radius:14px;">${PM3_READER_SVG}</div>
      <div style="margin-top:18px;text-align:center;">
        <div style="font-size:17px;font-weight:600;color:#3B82F6;margin-bottom:12px;animation:fadeInUp .4s ease both;">${escapeHtml(t("read.scanningTitle","Chip erkannt – Daten werden gelesen"))}</div>
        <div style="display:flex;flex-direction:column;gap:5px;text-align:left;width:260px;" data-read-progress></div>
      </div>
    </div>`;
}

function patchReadScanning() {
  const progress = operationProgress(state.readOperation, "operation.running");
  const total = Math.max(progress.length, 3);
  const items = Array.from({ length: total }, (_, i) => {
    const label = progress[i] || "…";
    const isDone = i < progress.length - 1;
    const isActive = i === progress.length - 1;
    const bg = isActive ? "rgba(59,130,246,.1)" : isDone ? "rgba(34,197,94,.07)" : "#111D30";
    const dBg = isDone ? "#22C55E" : isActive ? "#3B82F6" : "#4A6080";
    const col = isActive ? "#3B82F6" : isDone ? "#22C55E" : "#4A6080";
    const icon = isDone ? "✓" : isActive
      ? `<div style="width:8px;height:8px;border:1.5px solid white;border-top-color:transparent;border-radius:50%;animation:spin .45s linear infinite;"></div>`
      : String(i + 1);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;background:${bg};animation:fadeInUp .35s ease ${i*.08}s both;">
      <div style="width:18px;height:18px;border-radius:50%;background:${dBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;color:white;font-weight:700;">${icon}</div>
      <span style="font-size:12.5px;font-weight:500;color:${col};">${escapeHtml(label)}</span>
    </div>`;
  });
  replaceHtml("[data-read-progress]", items.join(""));
}

function renderReadUnstable() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:28px;text-align:center;">
      <div style="font-size:17px;font-weight:700;color:#F59E0B;">${escapeHtml(t("read.unstableTitle","Signal gefunden"))}</div>
      <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:12px;padding:14px 20px;max-width:360px;">
        <strong style="display:block;color:#F59E0B;margin-bottom:5px;">${escapeHtml(t("read.unstableHint","Chip leicht verschieben oder drehen"))}</strong>
        <span style="font-size:13px;color:#4A6080;">${escapeHtml(uiMessage(state.lastScan,"read.unstableBody"))}</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" data-read-scan class="btn btn-primary">${escapeHtml(t("read.continueMeasuring","Weiter messen"))}</button>
        <button type="button" data-read-scan class="btn btn-ghost">${escapeHtml(t("read.scanAgain","Erneut scannen"))}</button>
      </div>
    </div>`;
}

function renderReadResult() {
  return `
    <div style="flex:1;display:flex;min-height:0;overflow:hidden;animation:fadeIn .4s ease both;" data-read-result-root>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;position:relative;
        background:radial-gradient(ellipse 50% 50% at 50% 50%,rgba(34,197,94,.05) 0%,transparent 70%);">
        <div style="position:absolute;top:50%;left:50%;pointer-events:none;margin-top:-80px;">
          <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:2px solid rgba(34,197,94,.7);animation:successBurst .9s ease-out both;"></div>
          <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:1.5px solid rgba(34,197,94,.5);animation:successBurst .9s ease-out .22s both;"></div>
        </div>
        <div style="position:relative;">${CHIP_SVG({size:80,id:"result",stroke:"rgba(34,197,94,.55)"})}</div>
        <div style="text-align:center;animation:fadeInUp .5s ease .35s both;">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:20px;color:#22C55E;font-size:13px;font-weight:600;margin-bottom:5px;" data-read-result-badge>
            ✓ ${escapeHtml(t("read.confirmed","Zweiter Scan bestätigt"))}
          </div>
          <div style="font-size:12px;color:#4A6080;" data-read-result-subtitle></div>
        </div>
      </div>
      <div style="width:320px;flex-shrink:0;border-left:1px solid #1E3050;overflow-y:auto;background:#0D1525;animation:slideInRight .5s ease both;" data-read-chip-panel>
      </div>
    </div>`;
}

function patchReadResult() {
  const scan = state.lastScan;
  if (!scan?.chip) return;
  const chip = scan.chip;

  const subtitle = scan.confirmed
    ? `${chip.technology || t("chip.generic","Chip")} · ${chip.frequency || ""} · ${t("read.secondScanConfirmed","second scan confirmed")}`
    : `${chip.frequency || ""} · ${uiMessage(scan,"read.notTemplateConfirmed")}`;
  const subtitleNode = appView.querySelector("[data-read-result-subtitle]");
  if (subtitleNode) subtitleNode.textContent = subtitle;

  // Header actions (in header bar)
  const scanBusy = isOperationBusy(state.readOperation);
  replaceHtml("[data-read-result-actions]", `
    <button class="btn btn-ghost btn-sm" type="button" data-read-scan ${state.connection.connected && !scanBusy ? "" : "disabled"}>${escapeHtml(t("read.scanNewChip","Neu scannen"))}</button>
    <button class="btn btn-ok btn-sm" type="button" data-open-save-template ${scan.canSave ? "" : "disabled"}>${escapeHtml(t("template.saveAs","Als Vorlage speichern"))}</button>
  `);

  // Right panel: chip info + memory
  const tags = [chip.technology, chip.frequency].filter(Boolean);
  const regions = chip.memoryRegions || [];
  const regionRows = regions.map((r) => {
    const col = r.state === "is-failed" ? "#EF4444" : r.state === "is-unavailable" ? "#4A6080" : "#22C55E";
    const icon = r.state === "is-failed" ? "✕" : r.state === "is-unavailable" ? "—" : "✓";
    const valText = (r.currentValue || "").substring(0,32) + ((r.currentValue||"").length>32?"…":"");
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-bottom:1px solid #1E3050;">
      <span style="font-size:10px;color:${col};font-family:var(--mono);min-width:12px;">${icon}</span>
      <span style="font-size:12px;color:#CBD5E1;flex:1;min-width:0;">${escapeHtml(r.label||r.id||"")}</span>
      ${valText ? `<span style="font-size:10.5px;color:#4A6080;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;">${escapeHtml(valText)}</span>` : ""}
    </div>`;
  }).join("");

  replaceHtml("[data-read-chip-panel]", `
    <div style="padding:16px;border-bottom:1px solid #1E3050;">
      <div style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:3px;">${escapeHtml(chip.technology||t("chip.generic","Chip"))}</div>
      <div style="font-family:var(--mono);font-size:11.5px;color:#4A6080;margin-bottom:10px;">${escapeHtml(chip.uid||"—")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${tags.map((tag) => `<span style="padding:2px 9px;background:#162438;border:1px solid #1E3050;border-radius:5px;font-size:11px;color:#CBD5E1;">${escapeHtml(tag)}</span>`).join("")}
        ${scan.confirmed ? `<span style="padding:2px 9px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:5px;font-size:11px;color:#22C55E;">✓ ${escapeHtml(t("read.confirmed","Bestätigt"))}</span>` : ""}
      </div>
    </div>
    <div style="font-size:11px;font-weight:600;color:#4A6080;text-transform:uppercase;letter-spacing:.6px;padding:10px 16px 6px;">${escapeHtml(t("chip.memoryAreas","Speicherbereiche"))}</div>
    ${regionRows || `<div style="padding:10px 16px;font-size:12.5px;color:#4A6080;">${escapeHtml(t("analysis.noRealChip","Keine Speicherdaten"))}</div>`}
  `);
}

// ─── Orange PM3 reader SVG used in Write intro ────────────────────────────────
const PM3_READER_WRITE_SVG = `<svg width="260" height="165" viewBox="0 0 300 190" fill="none" style="border-radius:14px;">
  <rect width="300" height="190" rx="14" fill="#0E1D34" stroke="rgba(245,158,11,.4)" stroke-width="2"/>
  <rect x="6" y="6" width="288" height="178" rx="10" fill="#091524"/>
  <rect x="18" y="18" width="264" height="154" rx="8" fill="none" stroke="rgba(245,158,11,.28)" stroke-width="1.8"/>
  <circle cx="222" cy="95" r="52" fill="#070E1A" stroke="rgba(245,158,11,.16)" stroke-width="1.5"/>
  <g transform="translate(208,83)" fill="none" stroke="rgba(245,158,11,.75)" stroke-linecap="round">
    <circle cx="4" cy="12" r="2.5" fill="rgba(245,158,11,.75)" stroke="none" style="animation:nfcPulse 2.5s ease-in-out infinite"/>
    <path d="M10 6 A8.5 8.5 0 0 1 10 18" stroke-width="2" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:.35s"/>
    <path d="M15 3 A13 13 0 0 1 15 21" stroke-width="1.7" opacity=".55" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:.7s"/>
    <path d="M20 0 A17.5 17.5 0 0 1 20 24" stroke-width="1.4" opacity=".3" style="animation:nfcPulse 2.5s ease-in-out infinite;animation-delay:1.05s"/>
  </g>
  <circle cx="268" cy="20" r="3.5" fill="#F59E0B" style="animation:ledBlink 1.2s ease-in-out infinite;"/>
  <circle cx="280" cy="20" r="3.5" fill="#D97706" opacity=".55" style="animation:ledBlink 1.2s ease-in-out infinite;animation-delay:.4s;"/>
  <text x="22" y="175" font-family="monospace" font-size="7.5" fill="rgba(245,158,11,.3)" letter-spacing="1.8">LF · 125 kHz</text>
  <text x="190" y="168" font-family="monospace" font-size="7" fill="rgba(245,158,11,.2)" letter-spacing="1.5">HF · 13.56 MHz</text>
</svg>`;

// Shared helper: renders scan-progress items for the write intro scanning state
function writeIntroProgressItems(operation) {
  const progress = operationProgress(operation, "operation.running");
  const total = Math.max(progress.length, 3);
  return Array.from({ length: total }, (_, i) => {
    const label = progress[i] || "…";
    const isDone = i < progress.length - 1;
    const isActive = i === progress.length - 1;
    const bg = isActive ? "rgba(245,158,11,.1)" : isDone ? "rgba(34,197,94,.07)" : "#111D30";
    const dBg = isDone ? "#22C55E" : isActive ? "#F59E0B" : "#4A6080";
    const col = isActive ? "#F59E0B" : isDone ? "#22C55E" : "#4A6080";
    const icon = isDone ? "✓" : isActive
      ? `<div style="width:8px;height:8px;border:1.5px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .45s linear infinite;"></div>`
      : String(i + 1);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;background:${bg};animation:fadeInUp .35s ease ${i * .08}s both;">
      <div style="width:18px;height:18px;border-radius:50%;background:${dBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;color:#fff;font-weight:700;">${icon}</div>
      <span style="font-size:12.5px;font-weight:500;color:${col};">${escapeHtml(label)}</span>
    </div>`;
  }).join("");
}

function renderWriteIntro() {
  const connected = state.connection.connected;
  const isScanBusy = isOperationBusy(state.currentScanOperation);

  if (isScanBusy) {
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative;
        background:radial-gradient(ellipse 55% 55% at 50% 50%,rgba(245,158,11,.07) 0%,transparent 70%);" data-write-intro>
        <div style="position:absolute;top:50%;left:50%;pointer-events:none;margin-top:-80px;">
          <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:2px solid rgba(245,158,11,.85);animation:scanRing 2s ease-out infinite;"></div>
          <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:1.5px solid rgba(245,158,11,.6);animation:scanRing 2s ease-out infinite;animation-delay:.55s;"></div>
          <div style="position:absolute;top:50%;left:50%;width:200px;height:200px;border-radius:50%;border:1px solid rgba(245,158,11,.4);animation:scanRing 2s ease-out infinite;animation-delay:1.1s;"></div>
        </div>
        <div style="animation:chipLand .9s cubic-bezier(.34,1.56,.64,1) both;z-index:4;margin-bottom:-8px;">
          ${CHIP_SVG({size:82,id:"wscan",stroke:"rgba(245,158,11,.7)"})}
        </div>
        <div style="animation:readerPulse 1.4s ease-in-out infinite;border-radius:14px;">${PM3_READER_WRITE_SVG}</div>
        <div style="margin-top:18px;text-align:center;">
          <div style="font-size:17px;font-weight:600;color:#F59E0B;margin-bottom:12px;animation:fadeInUp .4s ease both;">
            ${escapeHtml(t("write.scanningTitle","Chip erkannt – Zustand wird gelesen"))}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;text-align:left;width:260px;" data-write-scan-progress>
            ${writeIntroProgressItems(state.currentScanOperation)}
          </div>
        </div>
      </div>`;
  }

  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto;position:relative;
      background:radial-gradient(ellipse 55% 55% at 50% 50%,rgba(245,158,11,.05) 0%,transparent 70%);" data-write-intro>
      <div style="animation:chipFloat 3.5s ease-in-out infinite;">${CHIP_SVG({size:76,id:"widle",stroke:"rgba(245,158,11,.5)"})}</div>
      <div style="animation:arrowBounce 1.2s ease-in-out infinite;margin:4px 0;">
        <svg width="12" height="24" viewBox="0 0 12 24" fill="none">
          <line x1="6" y1="0" x2="6" y2="14" stroke="rgba(245,158,11,.5)" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M1.5 12 L6 20 L10.5 12" stroke="rgba(245,158,11,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      ${PM3_READER_WRITE_SVG}
      <div style="margin-top:18px;text-align:center;animation:fadeInUp .6s ease both;">
        <div style="font-size:17px;font-weight:700;color:#F1F5F9;margin-bottom:5px;">${escapeHtml(t("write.introTitle","Chip zum Schreiben scannen"))}</div>
        <div style="font-size:12.5px;color:#4A6080;max-width:340px;line-height:1.6;margin:0 auto 18px;">
          ${escapeHtml(t("write.introBody","Aktuellen Zustand einlesen – dann Vorlage als Ziel wählen und Änderungen anwenden."))}
        </div>
        <button type="button" data-write-scan ${connected ? "" : "disabled"}
          style="padding:9px 26px;background:rgba(245,158,11,.13);border:1px solid rgba(245,158,11,.38);border-radius:10px;
            color:#F59E0B;font-family:inherit;font-size:13.5px;font-weight:600;
            cursor:${connected ? "pointer" : "not-allowed"};opacity:${connected ? 1 : .5};">
          ${escapeHtml(t("write.scanChip","Chip scannen"))}
        </button>
        ${!connected ? `<br><button type="button" data-refresh-connection
          style="margin-top:10px;padding:7px 18px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#4A6080;font-family:inherit;font-size:12.5px;cursor:pointer;">
          ${escapeHtml(t("connection.retryCheck","Verbindung prüfen"))}</button>` : ""}
      </div>
    </div>`;
}

function patchWriteIntroScan() {
  const el = appView.querySelector("[data-write-scan-progress]");
  if (el) el.innerHTML = writeIntroProgressItems(state.currentScanOperation);
  // If scanning just started and we were on idle intro, rebuild to show scan rings
  const isBusy = isOperationBusy(state.currentScanOperation);
  const hasRings = !!appView.querySelector("[data-write-intro] [style*=scanRing]");
  if (isBusy && !hasRings) appView.innerHTML = renderWriteIntro();
}

function renderWriteView() {
  if (isOperationBusy(state.autoWriteOperation)) return renderWriteAnimating();
  if (!state.currentChip) return renderWriteIntro();
  // NOTE: DONE state is shown only via patchWriteView() transition, never on fresh render
  return `
    <div style="flex:1;display:flex;min-height:0;overflow:hidden;animation:fadeIn .35s ease both;">
      <!-- Left: current chip -->
      <div style="width:220px;flex-shrink:0;border-right:1px solid #1E3050;display:flex;flex-direction:column;overflow:hidden;background:#0D1525;">
        <div style="padding:12px 14px;border-bottom:1px solid #1E3050;">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("write.currentChip","Aktueller Chip"))}</div>
          <div data-wf-current></div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:8px;" data-write-memmap></div>
      </div>
      <!-- Middle: actions -->
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;">
        <div style="flex:1;overflow-y:auto;padding:14px 16px;" data-action-panel></div>
      </div>
      <!-- Right: target -->
      <div style="width:220px;flex-shrink:0;border-left:1px solid #1E3050;display:flex;flex-direction:column;overflow:hidden;background:#0D1525;">
        <div style="padding:12px 14px;border-bottom:1px solid #1E3050;">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("write.targetState","Zielzustand"))}</div>
          <div data-wf-target></div>
        </div>
        <div style="padding:10px 14px;border-bottom:1px solid #1E3050;" data-wf-middle></div>
      </div>
    </div>`;
}

function patchWriteView() {
  const isAnimating = isOperationBusy(state.autoWriteOperation);
  const isDone = !isAnimating && state.autoWriteOperation?.state === "succeeded";
  const isIntro = !state.currentChip && !isAnimating;
  const wasAnimating = !!appView.querySelector("[data-write-anim]");
  const wasDone = !!appView.querySelector("[data-write-done]");
  const wasIntro = !!appView.querySelector("[data-write-intro]");

  if (isAnimating && !wasAnimating) { appView.innerHTML = renderWriteAnimating(); return; }
  if (isDone && !wasDone) { appView.innerHTML = renderWriteDone(); return; }
  if (isIntro) {
    if (!wasIntro) { appView.innerHTML = renderWriteIntro(); return; }
    patchWriteIntroScan(); // live-update scan rings + progress when scan starts/updates
    return;
  }
  // Transition from any special screen → 3-column form (chip just arrived or reset)
  if (!isAnimating && !isDone && (wasAnimating || wasDone || wasIntro)) {
    appView.innerHTML = renderWriteView();
    patchWfBar(); patchMemMap(); patchActionPanel(); patchTargetControl();
    return;
  }
  if (isAnimating) { patchWriteAnimProgress(); return; }
  if (isDone) return;
  patchWfBar();
  patchMemMap();
  patchActionPanel();
  patchTargetControl();
}

function patchWfBar() {
  const chip = state.currentChip;
  const target = state.target;
  const busy = isOperationBusy(state.currentScanOperation);

  // Current chip slot
  const currentHtml = chip
    ? `<div style="font-size:13px;font-weight:600;color:#F1F5F9;margin-bottom:2px;">${escapeHtml(chip.technology||chip.uid||t("chip.generic","Chip"))}</div>
       <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;margin-bottom:8px;">${escapeHtml(chip.uid||"")}</div>
       <button class="btn btn-ghost btn-sm" type="button" data-write-scan ${state.connection.connected&&!busy?"":"disabled"}>
         ${escapeHtml(busy?t("operation.scanRunning","Läuft …"):t("write.scanCurrentChip","Erneut scannen"))}
       </button>`
    : `<div style="font-size:12px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("write.noCurrentChip","Noch kein Chip gescannt"))}</div>
       <button class="btn btn-primary btn-sm" type="button" data-write-scan ${state.connection.connected&&!busy?"":"disabled"}>
         ${escapeHtml(busy?t("operation.scanRunning","Läuft …"):t("write.scanCurrentChip","Chip scannen"))}
       </button>`;
  replaceHtml("[data-wf-current]", currentHtml);

  // Middle: compat pill
  let compatColor = "#4A6080";
  let compatText = "—";
  if (state.comparison) {
    if (state.comparison.status === "danger") { compatColor = "#EF4444"; compatText = t("write.incompatible","Inkompatibel"); }
    else if (state.comparison.writable_difference_count) { compatColor = "#F59E0B"; compatText = `${state.comparison.writable_difference_count} ${t("write.changes","Änderungen")}`; }
    else { compatColor = "#22C55E"; compatText = t("write.noChanges","Aktuell"); }
  }
  replaceHtml("[data-wf-middle]", `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:5px;">Kompatibilität</div>
    <div style="font-size:12.5px;font-weight:700;color:${compatColor};">${escapeHtml(compatText)}</div>
  `);

  // Target slot
  const selectFocused = document.activeElement?.matches("[data-target-select]");
  if (!selectFocused) {
    const targetHtml = target
      ? `<div style="font-size:13px;font-weight:600;color:#F1F5F9;margin-bottom:2px;">${escapeHtml(target.chip?.technology||target.source||t("chip.generic","Vorlage"))}</div>
         <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;margin-bottom:8px;">${escapeHtml(target.source||"")}</div>
         <div data-target-control></div>`
      : `<div style="font-size:12px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("write.chooseTargetState","Kein Ziel gewählt"))}</div>
         <div data-target-control></div>`;
    replaceHtml("[data-wf-target]", targetHtml);
  }
}

function patchMemMap() {
  const chip = state.currentChip;
  const autoDetails = state.autoWriteOperation?.details || {};
  const actions = state.comparison?.actions || [];
  const actionMap = new Map(actions.map((a) => [a.region_id, a]));

  if (!chip) {
    replaceHtml("[data-write-memmap]", `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("chip.memoryAreas","Speicher"))}</div>
      <div style="font-size:12px;color:#4A6080;">${escapeHtml(t("write.noCurrentChip","Erst Chip scannen"))}</div>
    `);
    return;
  }

  const regions = chip.memoryRegions || [];
  const cells = regions.map((region) => {
    const op = state.writeOperations[region.id];
    const autoActive = isOperationBusy(state.autoWriteOperation) && autoDetails.active_region === region.id;
    const autoDone = (autoDetails.completed_regions || []).includes(region.id);
    const isWriting = autoActive || (op && !TERMINAL_STATES.has(op.state));
    const isDone = region.state === "is-verified" || state.completedActions[region.id] || autoDone || op?.state === "succeeded";
    const isFail = region.state === "is-failed" || state.failedRegionId === region.id || (op && TERMINAL_STATES.has(op.state) && op.state !== "succeeded");
    const isDiff = !isDone && !isFail && !isWriting && (region.state === "is-different" || actionMap.has(region.id));
    const isEmpty = region.state === "is-unavailable";

    const bg = isWriting ? "rgba(59,130,246,.18)" : isDone ? "rgba(34,197,94,.12)" : isFail ? "rgba(239,68,68,.12)" : isDiff ? "rgba(245,158,11,.12)" : isEmpty ? "#111D30" : "#162438";
    const border = isWriting ? "rgba(59,130,246,.4)" : isDone ? "rgba(34,197,94,.35)" : isFail ? "rgba(239,68,68,.4)" : isDiff ? "rgba(245,158,11,.4)" : "#1E3050";
    const col = isWriting ? "#3B82F6" : isDone ? "#22C55E" : isFail ? "#EF4444" : isDiff ? "#F59E0B" : "#4A6080";
    const shortLabel = (region.label||region.id||"").replace(/^page_/,"P").replace(/^sector_/,"S").toUpperCase();
    const icon = isWriting
      ? `<div style="width:8px;height:8px;border:1.5px solid #3B82F6;border-top-color:transparent;border-radius:50%;animation:spin .5s linear infinite;"></div>`
      : isDone ? "✓" : isFail ? "✕" : isDiff ? "≠" : isEmpty ? "—" : "✓";

    return `<div title="${escapeHtml(region.label||region.id||"")}" style="display:flex;align-items:center;gap:5px;padding:4px 7px;border-radius:6px;border:1px solid ${border};background:${bg};font-size:11px;">
      <span style="color:${col};font-size:10px;width:10px;text-align:center;">${icon}</span>
      <span style="color:#CBD5E1;font-family:var(--mono);font-size:10px;">${escapeHtml(shortLabel)}</span>
    </div>`;
  });

  replaceHtml("[data-write-memmap]", `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("chip.memoryAreas","Speicher"))}</div>
    <div style="display:flex;flex-direction:column;gap:3px;">${cells.join("")}</div>
  `);
}

function patchActionPanel() {
  if (!state.currentChip) {
    replaceHtml("[data-action-panel]", `
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;margin-bottom:8px;">${escapeHtml(t("write.changes","Änderungen"))}</div>
      <div style="font-size:12.5px;color:#4A6080;">${escapeHtml(t("write.emptyCurrent","Erst den aktuellen Chip scannen."))}</div>
    `);
    return;
  }
  if (!state.target) {
    replaceHtml("[data-action-panel]", `
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;margin-bottom:8px;">${escapeHtml(t("write.changes","Änderungen"))}</div>
      <div style="font-size:12.5px;color:#4A6080;">${escapeHtml(t("write.emptyTarget","Vorlage oder Backup als Ziel wählen."))}</div>
    `);
    return;
  }
  if (!state.comparison) {
    replaceHtml("[data-action-panel]", `
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;margin-bottom:8px;">${escapeHtml(t("write.changes","Änderungen"))}</div>
      <div style="font-size:12.5px;color:#EF4444;">${escapeHtml(t("write.incompatibleTarget","Zielzustand passt nicht zum aktuellen Chip."))}</div>
    `);
    return;
  }
  // "danger" means the full target state is not compatible; enabled rows may still be writable.
  const dangerBanner = state.comparison.status === "danger"
    ? `<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;margin-bottom:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:9px;font-size:11.5px;color:#F59E0B;">
        <span>⚠</span>
        <span>${escapeHtml(t("write.incompatibleWarn","Zielzustand passt nicht vollständig. Nur freigegebene Bereiche werden geschrieben."))}</span>
      </div>`
    : "";

  const actions = state.comparison.actions || [];
  actions.forEach((a) => { state.knownActions[a.region_id] = a; });
  const rows = orderedActionRows(actions);
  const autoBusy = isOperationBusy(state.autoWriteOperation);
  const autoDetails = state.autoWriteOperation?.details || {};
  const openCount = actions.filter((a) => a.enabled).length;

  if (!rows.length) {
    replaceHtml("[data-action-panel]", `
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;margin-bottom:12px;">${escapeHtml(t("write.changes","Änderungen"))}</div>
      ${renderPageMatrix()}
      <div style="display:flex;align-items:center;gap:8px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;color:#22C55E;font-weight:600;">
        ✓ ${escapeHtml(t("write.matchesTarget","Chip entspricht dem Zielzustand"))}
      </div>
    `);
    return;
  }

  const cards = rows.map((action) => {
    const op = state.writeOperations[action.region_id];
    const autoActive = autoBusy && autoDetails.active_region === action.region_id;
    const autoDone = (autoDetails.completed_regions || []).includes(action.region_id);
    const isWorking = autoActive || (op && !TERMINAL_STATES.has(op.state));
    const isDone = action.uiState === "done" || op?.state === "succeeded" || autoDone;
    const isFailed = state.failedRegionId === action.region_id || (op && TERMINAL_STATES.has(op.state) && op.state !== "succeeded");

    const borderCol = isWorking ? "rgba(59,130,246,.35)" : isDone ? "rgba(34,197,94,.28)" : isFailed ? "rgba(239,68,68,.3)" : "#1E3050";
    const bgCol = isWorking ? "rgba(59,130,246,.06)" : isDone ? "rgba(34,197,94,.05)" : isFailed ? "rgba(239,68,68,.06)" : "#111D30";

    const msgText = isWorking
      ? uiMessage(op||state.autoWriteOperation,"write.regionApplying","Wird angewendet …")
      : isDone ? t("write.verified","Verifiziert ✓")
      : isFailed ? uiMessage(op||state.autoWriteOperation,"write.regionVerifyFailed","Fehlgeschlagen")
      : action.reason || "";

    const ctrlLabel = isFailed ? t("action.retry","Wiederholen") : t("action.apply","Anwenden");
    const ctrlDisabled = !action.enabled || !state.connection.connected || anyWriteBusy();
    const ctrl = isDone
      ? `<span style="color:#22C55E;font-size:16px;font-weight:800;">✓</span>`
      : isWorking
        ? `<div style="width:14px;height:14px;border:2px solid #3B82F6;border-top-color:transparent;border-radius:50%;animation:spin .5s linear infinite;"></div>`
        : `<button class="btn btn-primary btn-sm" type="button" data-write-action="${escapeHtml(action.region_id)}"
            ${ctrlDisabled ? "disabled" : ""}
            style="${isFailed?"border-color:#EF4444;":!action.enabled?"border-color:#F59E0B;":""}">
            ${escapeHtml(ctrlLabel)}
          </button>`;

    return `
      <div style="padding:10px 12px;border-radius:9px;border:1px solid ${borderCol};background:${bgCol};margin-bottom:6px;animation:fadeInUp .25s ease both;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:12.5px;font-weight:600;color:#F1F5F9;margin-bottom:4px;">${escapeHtml(action.label)}</div>
            <div style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10.5px;color:#4A6080;">
              <span style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(action.fromValue||"—")}</span>
              <span style="color:#1E3050;">→</span>
              <span style="color:#CBD5E1;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(action.toValue||"—")}</span>
            </div>
            ${msgText ? `<div style="font-size:11px;color:${isDone?"#22C55E":isFailed?"#EF4444":"#3B82F6"};margin-top:3px;">${escapeHtml(msgText)}</div>` : ""}
          </div>
          <div style="flex-shrink:0;">${ctrl}</div>
        </div>
        ${isWorking ? `<div style="height:2px;background:#1E3050;border-radius:1px;margin-top:8px;overflow:hidden;"><div style="height:100%;width:60%;background:#3B82F6;border-radius:1px;animation:spin 1s linear infinite;transform-origin:left;"></div></div>` : ""}
      </div>
    `;
  }).join("");

  const applyAllDisabled = !state.connection.connected || anyWriteBusy() || !enabledWriteActions().length ? "disabled" : "";
  const progressLine = autoBusy ? `<div style="font-size:11.5px;color:#3B82F6;margin-bottom:8px;">${escapeHtml(autoProgressText())}</div>` : "";

  replaceHtml("[data-action-panel]", `
    ${dangerBanner}
    ${renderPageMatrix()}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("write.changes","Änderungen"))}
        <span style="font-size:11px;background:${openCount?"rgba(245,158,11,.15)":"rgba(34,197,94,.12)"};color:${openCount?"#F59E0B":"#22C55E"};border:1px solid ${openCount?"rgba(245,158,11,.3)":"rgba(34,197,94,.25)"};padding:1px 7px;border-radius:4px;margin-left:6px;">${openCount}</span>
      </div>
      ${openCount ? `<button class="btn btn-warn btn-sm" type="button" data-write-all ${applyAllDisabled}>${escapeHtml(t("write.applyAll","Alle anwenden"))}</button>` : ""}
    </div>
    ${progressLine}
    <div>${cards}</div>
  `);
}

function renderPageMatrix() {
  const comparison = state.comparison;
  const rows = comparison?.page_rows || [];
  if (!rows.length) return "";
  const scopeKey = comparison.profile_scope === "full_profile"
    ? "write.scope.fullProfile"
    : comparison.profile_scope === "legacy_partial"
      ? "write.scope.legacyPartial"
      : "write.scope.partialUpdate";
  const uidKey = comparison.uid_policy === "must_match"
    ? "write.uidPolicy.mustMatch"
    : comparison.uid_policy === "ignore_for_equivalence"
      ? "write.uidPolicy.ignore"
      : "write.uidPolicy.reference";
  const equivalence = comparison.equivalence_status_key
    ? t(comparison.equivalence_status_key, comparison.equivalence_status)
    : comparison.equivalence_status;
  const htmlRows = rows.map((row) => {
    const action = (comparison.actions || []).find((item) => item.page === row.page);
    const op = action ? state.writeOperations[action.region_id] : null;
    const done = action && (state.completedActions[action.region_id] || op?.state === "succeeded");
    const verified = done || row.re_read_verified;
    const status = row.status_key ? t(row.status_key, row.status) : row.status;
    const blocked = row.blocked_reason_key ? t(row.blocked_reason_key, row.blocked_reason) : row.blocked_reason;
    const writable = row.write_supported
      ? row.write_allowed_for_this_plan ? t("write.table.writeAllowed") : t("write.table.writeSupported")
      : t("write.table.notWritable");
    const actionText = action
      ? action.enabled ? t("write.table.actionAvailable") : (action.reason || blocked || t("write.table.actionBlocked"))
      : row.page === 0 ? t("write.table.referenceOnly") : row.included_in_profile ? (blocked || t("write.table.noAction")) : t("write.table.notInScope");
    return `
      <tr>
        <td style="padding:7px 8px;color:#CBD5E1;font-weight:700;white-space:nowrap;">${row.page === 0 ? escapeHtml(t("write.table.uidPage")) : `P${escapeHtml(row.page)}`}</td>
        <td style="padding:7px 8px;font-family:var(--mono);font-size:10.5px;color:#94A3B8;">${escapeHtml(row.template_value || t("write.table.missing"))}</td>
        <td style="padding:7px 8px;font-family:var(--mono);font-size:10.5px;color:#94A3B8;">${escapeHtml(row.target_value || t("write.table.missing"))}</td>
        <td style="padding:7px 8px;color:${row.equal ? "#22C55E" : row.different ? "#F59E0B" : "#94A3B8"};">${escapeHtml(status)}</td>
        <td style="padding:7px 8px;color:#94A3B8;">${escapeHtml(row.included_in_profile ? t("write.table.yes") : t("write.table.no"))}</td>
        <td style="padding:7px 8px;color:${row.write_allowed_for_this_plan ? "#22C55E" : row.write_supported ? "#94A3B8" : "#EF4444"};">${escapeHtml(writable)}</td>
        <td style="padding:7px 8px;color:#94A3B8;">${escapeHtml(actionText)}</td>
        <td style="padding:7px 8px;color:${verified ? "#22C55E" : "#94A3B8"};">${escapeHtml(verified ? t("write.table.verified") : t("write.table.pending"))}</td>
      </tr>
    `;
  }).join("");
  return `
    <div style="border:1px solid #1E3050;background:#0F1A2B;border-radius:8px;margin-bottom:12px;overflow:hidden;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #1E3050;">
        <div>
          <div style="font-size:13px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("write.pageTable.title"))}</div>
          <div style="font-size:11px;color:#94A3B8;margin-top:3px;">${escapeHtml(t(scopeKey))} · ${escapeHtml(t(uidKey))}</div>
        </div>
        <div style="font-size:11px;color:#CBD5E1;text-align:right;max-width:280px;">${escapeHtml(equivalence || "")}</div>
      </div>
      <div style="overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:760px;">
          <thead style="background:#111D30;color:#64748B;text-transform:uppercase;font-size:10px;letter-spacing:.5px;">
            <tr>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.page"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.templateValue"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.targetValue"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.status"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.profilePart"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.writable"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.action"))}</th>
              <th style="text-align:left;padding:7px 8px;">${escapeHtml(t("write.table.reread"))}</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderWriteAnimating() {
  const autoDetails = state.autoWriteOperation?.details || {};
  const actions = state.comparison?.actions || [];
  const completed = (autoDetails.completed_regions || []).length;
  const total = Math.max(actions.length, 1);
  const pct = Math.round((completed / total) * 100);
  const activeRegion = autoDetails.active_region || "";
  const activeAction = actions.find((a) => a.region_id === activeRegion);
  const blockLabel = escapeHtml(activeAction?.label || activeRegion || t("write.writing", "Schreibe…"));
  const detail = escapeHtml(uiMessage(state.autoWriteOperation, "write.regionApplying",
    `${completed}/${total} ${t("write.blocks", "Blöcke")} abgeschlossen`));
  const hexBytes = ["A4","10","B4","20","C5","30","D5","40","E6","60"];
  const hexLeft  = [10, 50, 92, 133, 172, 30, 70, 112, 153, 192];
  const particles = hexBytes.map((hex, i) =>
    `<span style="position:absolute;left:${hexLeft[i]}px;font-family:'JetBrains Mono',monospace;font-size:12px;color:${i%2===0?"#6366F1":"#818CF8"};animation:dataParticle 1.8s ease-in infinite;animation-delay:${(i*0.17).toFixed(2)}s;">${hex}</span>`
  ).join("");
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;overflow:hidden;position:relative;
      background:radial-gradient(ellipse 50% 50% at 50% 45%,rgba(99,102,241,.06) 0%,transparent 70%);" data-write-anim>
      <div style="position:absolute;inset:0;pointer-events:none;overflow:hidden;display:flex;justify-content:center;">
        <div style="position:relative;width:220px;">${particles}</div>
      </div>
      <div style="position:relative;z-index:2;">
        <div style="position:absolute;top:42px;left:68px;z-index:3;">${CHIP_SVG({size:82,id:"writ",stroke:"rgba(129,140,248,.55)"})}</div>
        <svg width="224" height="142" viewBox="0 0 300 190" fill="none" style="border-radius:14px;box-shadow:0 0 44px rgba(99,102,241,.18);">
          <rect width="300" height="190" rx="14" fill="#0E1D34" stroke="rgba(129,140,248,.5)" stroke-width="2"/>
          <rect x="6" y="6" width="288" height="178" rx="10" fill="#091524"/>
          <rect x="18" y="18" width="264" height="154" rx="8" fill="none" stroke="rgba(99,102,241,.4)" stroke-width="1.8"/>
          <circle cx="268" cy="20" r="3.5" fill="#818CF8" style="animation:ledBlink .45s ease-in-out infinite;color:#818CF8;"/>
          <circle cx="280" cy="20" r="3.5" fill="#6366F1" opacity=".8" style="animation:ledBlink .45s ease-in-out infinite;animation-delay:.22s;color:#6366F1;"/>
        </svg>
      </div>
      <div style="width:300px;z-index:2;animation:fadeInUp .4s ease .2s both;" data-write-anim-progress>
        <div style="display:flex;justify-content:space-between;margin-bottom:7px;">
          <span style="font-size:13.5px;font-weight:600;color:#F1F5F9;">${blockLabel}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:13.5px;color:#818CF8;">${pct}%</span>
        </div>
        <div style="height:4px;background:#162438;border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#4F46E5,#818CF8);border-radius:4px;width:${pct}%;transition:width .1s linear;box-shadow:0 0 8px rgba(129,140,248,.4);"></div>
        </div>
        <div style="margin-top:8px;font-size:11.5px;color:#4A6080;text-align:center;font-family:'JetBrains Mono',monospace;">${detail}</div>
      </div>
    </div>`;
}

function renderWriteDone() {
  const autoDetails = state.autoWriteOperation?.details || {};
  const actions = state.comparison?.actions || [];
  const completedIds = autoDetails.completed_regions?.length ? autoDetails.completed_regions : actions.map((a) => a.region_id);
  const logRows = completedIds.slice(0, 8).map((id) => {
    const action = actions.find((a) => a.region_id === id) || state.completedActions[id];
    const label = action?.label || action?.region_id || id;
    const val = (action?.toValue || "").substring(0, 14) + ((action?.toValue || "").length > 14 ? "…" : "");
    return `<div style="display:flex;justify-content:space-between;">
      <span style="color:#4A6080;">${escapeHtml(label)}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:#22C55E;">${escapeHtml(val || "—")} ✓</span>
    </div>`;
  }).join("");
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;overflow:auto;animation:fadeInUp .5s ease both;" data-write-done>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;top:50%;left:50%;width:150px;height:150px;border-radius:50%;border:2px solid #22C55E;animation:successBurst 1s ease-out .1s both;"></div>
        <div style="position:absolute;top:50%;left:50%;width:150px;height:150px;border-radius:50%;border:1.5px solid #22C55E;animation:successBurst 1s ease-out .3s both;"></div>
        <div style="width:68px;height:68px;border-radius:50%;background:rgba(34,197,94,.1);border:2px solid rgba(34,197,94,.38);display:flex;align-items:center;justify-content:center;">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <path d="M8 17 L14 23 L26 11" stroke="#22C55E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
              stroke-dasharray="27" style="animation:checkDraw .5s ease .5s both;stroke-dashoffset:27;"/>
          </svg>
        </div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:23px;font-weight:700;color:#F1F5F9;letter-spacing:-.3px;">${escapeHtml(t("write.doneTitle","Chip erfolgreich beschrieben"))}</div>
        <div style="font-size:13px;color:#4A6080;margin-top:5px;">${escapeHtml(t("write.doneBody","Alle Blöcke geschrieben und verifiziert"))}</div>
      </div>
      ${logRows ? `
      <div style="background:#111D30;border:1px solid rgba(34,197,94,.2);border-radius:13px;padding:14px 20px;width:320px;animation:fadeInUp .5s ease .3s both;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;margin-bottom:10px;">${escapeHtml(t("write.writeLog","Schreibprotokoll"))}</div>
        <div style="display:flex;flex-direction:column;gap:7px;font-size:12.5px;">${logRows}</div>
      </div>` : ""}
      <div style="display:flex;gap:8px;animation:fadeInUp .5s ease .45s both;">
        <button type="button" data-write-reset
          style="padding:9px 20px;background:#111D30;border:1px solid #1E3050;border-radius:9px;color:#4A6080;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">
          ${escapeHtml(t("action.back","Zurück"))}
        </button>
        <button type="button" data-verify-after-write
          style="padding:9px 20px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.28);border-radius:9px;color:#3B82F6;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">
          ${escapeHtml(t("write.verifyChip","Chip verifizieren"))}
        </button>
      </div>
    </div>`;
}

function patchWriteAnimProgress() {
  const el = appView.querySelector("[data-write-anim-progress]");
  if (!el) return;
  const autoDetails = state.autoWriteOperation?.details || {};
  const actions = state.comparison?.actions || [];
  const completed = (autoDetails.completed_regions || []).length;
  const total = Math.max(actions.length, 1);
  const pct = Math.round((completed / total) * 100);
  const activeRegion = autoDetails.active_region || "";
  const activeAction = actions.find((a) => a.region_id === activeRegion);
  const blockLabel = escapeHtml(activeAction?.label || activeRegion || t("write.writing", "Schreibe…"));
  const detail = escapeHtml(uiMessage(state.autoWriteOperation, "write.regionApplying",
    `${completed}/${total} ${t("write.blocks", "Blöcke")} abgeschlossen`));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:7px;">
      <span style="font-size:13.5px;font-weight:600;color:#F1F5F9;">${blockLabel}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:13.5px;color:#818CF8;">${pct}%</span>
    </div>
    <div style="height:4px;background:#162438;border-radius:4px;overflow:hidden;">
      <div style="height:100%;background:linear-gradient(90deg,#4F46E5,#818CF8);border-radius:4px;width:${pct}%;transition:width .1s linear;box-shadow:0 0 8px rgba(129,140,248,.4);"></div>
    </div>
    <div style="margin-top:8px;font-size:11.5px;color:#4A6080;text-align:center;font-family:'JetBrains Mono',monospace;">${detail}</div>`;
}

function patchTargetControl() {
  const container = appView.querySelector("[data-target-control]");
  if (!container) return;
  const selectedTemplate = state.target?.kind === "template" ? state.target.id : "";
  const options = getSortedTemplates().map((template) => `
    <option value="${escapeHtml(template.id)}" ${selectedTemplate === template.id ? "selected" : ""}>${escapeHtml(template.name)}</option>
  `).join("");
  const html = `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <select id="targetSelect" data-target-select aria-label="${escapeHtml(t("write.targetTemplateLabel", "Target template"))}"
        style="width:100%;padding:6px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-size:12.5px;font-family:inherit;">
        <option value="">${escapeHtml(t("write.chooseTemplate", "Choose template"))}</option>
        ${options}
      </select>
      <button type="button" data-open-backup-targets
        style="display:block;margin-top:2px;font-size:11.5px;color:#3B82F6;background:none;border:0;cursor:pointer;text-align:left;padding:0;font-family:inherit;">${escapeHtml(t("write.useBackupTarget", "Use backup as target state"))}</button>
    </div>
  `;
  if (container.dataset.html !== html && document.activeElement?.dataset?.targetSelect === undefined) {
    container.dataset.html = html;
    container.innerHTML = html;
  }
}

function renderCompatibilityBar() {
  const isDanger = state.comparison?.status === "danger";
  const isOk = state.comparison && !isDanger;
  const color = isDanger ? "#EF4444" : isOk ? "#22C55E" : "#4A6080";
  const bg = isDanger ? "rgba(239,68,68,.1)" : isOk ? "rgba(34,197,94,.08)" : "#111D30";
  const border = isDanger ? "rgba(239,68,68,.3)" : isOk ? "rgba(34,197,94,.25)" : "#1E3050";
  const message = state.comparison
    ? comparisonMessage(state.comparison)
    : !state.currentChip ? t("write.scanCurrentChip", "Scan current chip")
    : !state.target ? t("write.chooseTargetState", "Choose target state")
    : t("write.comparisonUnavailable", "Comparison unavailable");
  return `<div style="padding:8px 12px;border-radius:8px;background:${bg};border:1px solid ${border};font-size:12.5px;color:${color};">${escapeHtml(message)}</div>`;
}

function renderChangeList() {
  const noAction = (msg) => `<div style="font-size:13px;color:#4A6080;padding:8px 0;">${escapeHtml(msg)}</div>`;
  if (!state.currentChip) return noAction(t("write.emptyCurrent", "Scan the current chip first."));
  if (!state.target) return noAction(t("write.emptyTarget", "Choose a template or backup as the target state."));
  if (!state.comparison) return noAction(t("write.emptyComparison", "The comparison could not be calculated for this combination."));
  // Incompatible rows are visible, but they are not actionable.

  const actions = state.comparison.actions || [];
  actions.forEach((action) => {
    state.knownActions[action.region_id] = action;
  });
  const rows = orderedActionRows(actions);
  if (!rows.length) return `<div style="display:flex;align-items:center;gap:8px;padding:12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;color:#22C55E;font-weight:600;">✓ ${escapeHtml(t("write.matchesTarget", "Current chip matches the target state."))}</div>`;
  const openCount = actions.filter((action) => action.enabled).length;
  const autoBusy = isOperationBusy(state.autoWriteOperation);
  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div style="font-size:13px;font-weight:600;color:#F1F5F9;">${escapeHtml(formatOpenCount(openCount))}</div>
          ${autoBusy ? `<div style="font-size:11.5px;color:#3B82F6;margin-top:3px;">${escapeHtml(autoProgressText())}</div>` : ""}
        </div>
        ${openCount ? `<button class="btn btn-primary btn-sm" type="button" data-write-all ${state.connection.connected && !anyWriteBusy() ? "" : "disabled"}>${escapeHtml(t("write.applyAll", "Apply all differences"))}</button>` : ""}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
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
  const borderCol = running ? "rgba(59,130,246,.35)" : done ? "rgba(34,197,94,.28)" : failed ? "rgba(239,68,68,.3)" : "#1E3050";
  const bgCol = running ? "rgba(59,130,246,.06)" : done ? "rgba(34,197,94,.05)" : failed ? "rgba(239,68,68,.06)" : "#111D30";
  const statusCol = running ? "#3B82F6" : done ? "#22C55E" : failed ? "#EF4444" : "#4A6080";
  const rowLabel = failed ? t("action.retry","Retry") : t("action.apply","Apply");
  const ctrlDisabled = !action.enabled || !state.connection.connected || anyWriteBusy();
  const ctrl = done
    ? `<span style="color:#22C55E;font-size:11px;font-weight:600;">${escapeHtml(t("write.verified", "Verified"))}</span>`
    : `<button class="btn btn-ghost btn-sm" type="button" data-write-action="${escapeHtml(action.region_id)}"
        ${ctrlDisabled ? "disabled" : ""}
        style="${failed?"border-color:#EF4444;":!action.enabled?"border-color:#F59E0B;":""}">
        ${escapeHtml(rowLabel)}
      </button>`;
  return `
    <div style="padding:9px 12px;border-radius:9px;border:1px solid ${borderCol};background:${bgCol};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:12.5px;font-weight:600;color:#F1F5F9;margin-bottom:3px;">${escapeHtml(action.label)}</div>
          <div style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10.5px;color:#4A6080;">
            <span>${escapeHtml(action.fromValue || "—")}</span>
            <span style="color:#1E3050;">→</span>
            <span style="color:#CBD5E1;">${escapeHtml(action.toValue || "—")}</span>
          </div>
          ${status ? `<div style="font-size:11px;color:${statusCol};margin-top:3px;">${escapeHtml(status)}</div>` : ""}
        </div>
        <div style="flex-shrink:0;">${ctrl}</div>
      </div>
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

function renderAnalysisDone() {
  const posResult = state.positionResult;
  const antResult = state.antennaResult;
  const posOk = posResult && !posResult.error && !posResult.failed;
  const antOk = antResult && !antResult.error && !antResult.failed;
  const allOk = posOk && antOk;
  const anyFail = (posResult && !posOk) || (antResult && !antOk);
  const overallColor = allOk ? "#22C55E" : anyFail ? "#EF4444" : "#F59E0B";
  const overallIcon = allOk ? "✓" : anyFail ? "✕" : "⚠";
  const overallLabel = allOk
    ? t("analysis.doneOk", "Alle Tests bestanden")
    : anyFail
      ? t("analysis.doneFail", "Test fehlgeschlagen")
      : t("analysis.doneWarn", "Tests mit Warnungen");

  const summaryRow = (label, ok, result) => {
    const col = ok ? "#22C55E" : result ? "#EF4444" : "#4A6080";
    const icon = ok ? "✓" : result ? "✕" : "—";
    const detail = escapeHtml(result?.message || result?.status || result?.title || "");
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:#111D30;border-radius:9px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="color:${col};font-size:15px;font-weight:700;width:18px;text-align:center;">${icon}</span>
        <span style="font-size:13px;font-weight:600;color:#CBD5E1;">${escapeHtml(label)}</span>
      </div>
      ${detail ? `<span style="font-size:11px;font-family:var(--mono);color:#4A6080;">${detail}</span>` : ""}
    </div>`;
  };

  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;overflow:auto;padding:20px;animation:fadeInUp .5s ease both;" data-analysis-done>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;top:50%;left:50%;width:150px;height:150px;border-radius:50%;border:2px solid ${overallColor};animation:successBurst 1s ease-out .1s both;"></div>
        <div style="position:absolute;top:50%;left:50%;width:150px;height:150px;border-radius:50%;border:1.5px solid ${overallColor};animation:successBurst 1s ease-out .3s both;"></div>
        <div style="width:68px;height:68px;border-radius:50%;background:rgba(34,197,94,.08);border:2px solid rgba(34,197,94,.25);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:26px;color:${overallColor};animation:fadeInUp .4s ease .4s both;">${overallIcon}</span>
        </div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:21px;font-weight:700;color:#F1F5F9;letter-spacing:-.3px;">${escapeHtml(t("analysis.doneTitle","Selbsttest abgeschlossen"))}</div>
        <div style="font-size:13px;color:${overallColor};margin-top:5px;font-weight:600;">${escapeHtml(overallLabel)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;width:320px;animation:fadeInUp .5s ease .25s both;">
        ${summaryRow(t("analysis.positionTitle","Position"), posOk, posResult)}
        ${summaryRow(t("analysis.antennaTitle","Antenne"), antOk, antResult)}
      </div>
      <div style="display:flex;gap:8px;animation:fadeInUp .5s ease .4s both;">
        <button type="button" data-analysis-details
          style="padding:9px 20px;background:#111D30;border:1px solid #1E3050;border-radius:9px;color:#4A6080;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">
          ${escapeHtml(t("analysis.showDetails","Details anzeigen"))}
        </button>
        <button type="button" data-start-selftest ${state.connection.connected?"":"disabled"}
          style="padding:9px 20px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.28);border-radius:9px;color:#3B82F6;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">
          ${escapeHtml(t("analysis.retestBtn","Erneut testen"))}
        </button>
      </div>
    </div>`;
}

function renderAnalysisIntro() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:auto;padding:20px;animation:fadeInUp .5s ease both;" data-analysis-intro>
      <div style="display:flex;flex-direction:column;align-items:center;gap:26px;">
        <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
          <div style="position:relative;z-index:3;margin-bottom:-18px;margin-left:16px;">${CHIP_SVG({size:76,id:"intro",stroke:"#2A4878"})}</div>
          <div style="position:absolute;top:-10px;right:-96px;animation:arrowBounce 1s ease-in-out infinite;text-align:center;">
            <svg width="76" height="48" viewBox="0 0 76 48" fill="none">
              <path d="M10 40 Q36 22 60 8" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="5 3"/>
              <path d="M53 3 L60 8 L55 16" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <div style="font-size:10.5px;color:#F59E0B;font-weight:600;margin-top:-4px;">${escapeHtml(t("analysis.removeChip","entfernen"))}</div>
          </div>
          <svg width="254" height="160" viewBox="0 0 300 190" fill="none" style="border-radius:14px;">
            <rect width="300" height="190" rx="14" fill="#0E1D34" stroke="rgba(245,158,11,.42)" stroke-width="2"/>
            <rect x="6" y="6" width="288" height="178" rx="10" fill="#091524"/>
            <rect x="18" y="18" width="264" height="154" rx="8" fill="none" stroke="rgba(245,158,11,.3)" stroke-width="1.8"/>
            <circle cx="222" cy="95" r="52" fill="#070E1A" stroke="rgba(245,158,11,.18)" stroke-width="1.5"/>
            <g transform="translate(208,83)" fill="none" stroke="rgba(245,158,11,.7)" stroke-linecap="round">
              <circle cx="4" cy="12" r="2.5" fill="rgba(245,158,11,.7)" stroke="none"/>
              <path d="M10 6 A8.5 8.5 0 0 1 10 18" stroke-width="2"/>
              <path d="M15 3 A13 13 0 0 1 15 21" stroke-width="1.7" opacity=".65"/>
            </g>
            <circle cx="268" cy="20" r="3.5" fill="#F59E0B" style="animation:ledBlink .7s ease-in-out infinite;color:#F59E0B;"/>
            <circle cx="280" cy="20" r="3.5" fill="#F59E0B" opacity=".5" style="animation:ledBlink .7s ease-in-out infinite;animation-delay:.35s;color:#F59E0B;"/>
          </svg>
        </div>
        <div style="text-align:center;max-width:390px;">
          <div style="font-size:21px;font-weight:700;color:#F1F5F9;margin-bottom:9px;">${escapeHtml(t("analysis.removeChipTitle","Chip vom Scanner entfernen"))}</div>
          <div style="font-size:13.5px;color:#4A6080;line-height:1.7;margin-bottom:22px;">${escapeHtml(t("analysis.removeChipBody","Für den Selbsttest muss der Scanner frei sein. Entfernen Sie bitte alle Chips und starten Sie die Diagnose."))}</div>
          <button type="button" data-start-selftest ${state.connection.connected?"":"disabled"}
            style="padding:11px 34px;background:linear-gradient(135deg,rgba(34,197,94,.14),rgba(22,163,74,.09));border:1px solid rgba(34,197,94,.38);border-radius:11px;color:#22C55E;font-family:inherit;font-size:14px;font-weight:700;cursor:${state.connection.connected?"pointer":"not-allowed"};opacity:${state.connection.connected?1:.5};">
            ${escapeHtml(t("analysis.startDiagnosis","Scanner frei – Diagnose starten"))}
          </button>
        </div>
      </div>
    </div>`;
}

function renderAnalysisPanels() {
  return `
    <div style="flex:1;display:flex;gap:0;min-height:0;overflow:hidden;animation:fadeIn .35s ease both;" data-analysis-panels>
      <div style="flex:1;overflow-y:auto;padding:18px;border-right:1px solid #1E3050;" data-position-panel></div>
      <div style="flex:1;overflow-y:auto;padding:18px;border-right:1px solid #1E3050;" data-antenna-panel></div>
      <div style="flex:1;overflow-y:auto;padding:18px;" data-technical-panel></div>
    </div>`;
}

function renderAnalysisView() {
  const hasResults = state.antennaResult || state.positionResult;
  const isBusy = isOperationBusy(state.antennaOperation) || isOperationBusy(state.positionOperation);
  const bothDone = !isBusy && !!state.antennaResult && !!state.positionResult && !state.analysisShowDetails;
  if (!hasResults && !isBusy) return renderAnalysisIntro();
  if (bothDone) return renderAnalysisDone();
  return renderAnalysisPanels();
}

function patchAnalysisView() {
  const hasResults = state.antennaResult || state.positionResult;
  const isBusy = isOperationBusy(state.antennaOperation) || isOperationBusy(state.positionOperation);
  const bothDone = !isBusy && !!state.antennaResult && !!state.positionResult && !state.analysisShowDetails;
  const wasIntro = !!appView.querySelector("[data-analysis-intro]");
  const wasDone = !!appView.querySelector("[data-analysis-done]");
  const wasPanels = !!appView.querySelector("[data-analysis-panels]");

  if (!hasResults && !isBusy) {
    if (!wasIntro) appView.innerHTML = renderAnalysisIntro();
    return;
  }
  if (bothDone) {
    if (!wasDone) appView.innerHTML = renderAnalysisDone();
    return;
  }
  if (!wasPanels) {
    appView.innerHTML = renderAnalysisPanels();
  }
  replaceHtml("[data-position-panel]", renderPositionPanel());
  replaceHtml("[data-antenna-panel]", renderAntennaPanel());
  replaceHtml("[data-technical-panel]", renderTechnicalPanel());
}

function renderPositionPanel() {
  const busy = isOperationBusy(state.positionOperation);
  const result = state.positionResult;
  const pillColor = busy ? "#3B82F6" : result ? "#22C55E" : "#4A6080";
  const pillLabel = busy ? t("operation.measurementRunning","Läuft …") : result ? t("status.done","Fertig") : t("status.idle","Bereit");
  const history = result?.history || [];
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("analysis.positionTitle","Position"))}</div>
      <span style="font-size:10.5px;font-weight:600;color:${pillColor};background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:4px;padding:2px 7px;">${escapeHtml(pillLabel)}</span>
    </div>
    ${busy ? `<div style="height:2px;background:#1E3050;border-radius:1px;margin-bottom:10px;overflow:hidden;"><div style="height:100%;background:linear-gradient(90deg,transparent,#3B82F6,transparent);animation:spin 1.2s linear infinite;border-radius:1px;"></div></div>` : ""}
    <p style="font-size:12px;color:#4A6080;line-height:1.6;margin-bottom:12px;">${escapeHtml(t("analysis.positionCopy","Chip langsam ein paar Millimeter über die Antenne bewegen."))}</p>
    ${result ? `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1E3050;margin-bottom:4px;"><span style="font-size:12px;color:#CBD5E1;">${escapeHtml(result.title||result.status||"")}</span><span style="font-size:12px;font-family:var(--mono);color:#22C55E;">${escapeHtml(result.message||"")}</span></div>` : ""}
    ${history.map((item) => `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #111D30;">
        <span style="font-size:11.5px;color:#4A6080;">${escapeHtml(item.label)}</span>
        <span style="font-size:11.5px;font-weight:600;color:#CBD5E1;">${escapeHtml(item.status)}</span>
      </div>
    `).join("")}
    ${result?.next_step ? `<div style="font-size:11.5px;color:#3B82F6;margin-top:10px;">${escapeHtml(result.next_step)}</div>` : ""}
    <div style="margin-top:14px;">
      <button class="btn btn-primary btn-sm" type="button" data-start-position ${state.connection.connected&&!busy?"":"disabled"}>
        ${escapeHtml(busy?t("operation.measurementRunning","Läuft …"):t("action.start","Starten"))}
      </button>
    </div>
  `;
}

function renderAntennaPanel() {
  const busy = isOperationBusy(state.antennaOperation);
  const result = state.antennaResult;
  const pillColor = busy ? "#3B82F6" : result ? "#22C55E" : "#4A6080";
  const pillLabel = busy ? t("operation.checkRunning","Läuft …") : result ? t("status.done","Fertig") : t("status.idle","Bereit");

  const voltBar = (voltStr) => {
    const match = voltStr ? voltStr.match(/[\d.]+/) : null;
    const v = match ? parseFloat(match[0]) : 0;
    const pct = Math.min(100, (v / 40) * 100);
    const col = pct > 60 ? "#22C55E" : pct > 30 ? "#F59E0B" : "#EF4444";
    return `<div style="height:4px;background:#1E3050;border-radius:2px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${col};border-radius:2px;"></div></div>`;
  };

  let rows = "";
  if (result) {
    const lf = result.lf || {};
    const hf = result.hf || {};
    rows = `
      <div style="padding:7px 0;border-bottom:1px solid #1E3050;">
        <div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#CBD5E1;">${escapeHtml(t("antenna.lf","LF 125 kHz"))}</span><span style="font-size:12px;font-family:var(--mono);color:#CBD5E1;">${escapeHtml(lf.voltage_125khz||lf.status||"—")}</span></div>
        ${lf.voltage_125khz ? voltBar(lf.voltage_125khz) : ""}
      </div>
      ${lf.optimal_frequency||lf.optimal_voltage ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #111D30;"><span style="font-size:11.5px;color:#4A6080;">${escapeHtml(t("antenna.optimalRange","Optimal"))}</span><span style="font-size:11.5px;font-family:var(--mono);color:#22C55E;">${escapeHtml([lf.optimal_frequency,lf.optimal_voltage].filter(Boolean).join(" · "))}</span></div>` : ""}
      <div style="padding:7px 0;">
        <div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#CBD5E1;">${escapeHtml(t("antenna.hf","HF 13.56 MHz"))}</span><span style="font-size:12px;font-family:var(--mono);color:#CBD5E1;">${escapeHtml(hf.voltage_13_56mhz||hf.status||"—")}</span></div>
        ${hf.voltage_13_56mhz ? voltBar(hf.voltage_13_56mhz) : ""}
      </div>
    `;
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("analysis.antennaTitle","Antenne"))}</div>
      <span style="font-size:10.5px;font-weight:600;color:${pillColor};background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:4px;padding:2px 7px;">${escapeHtml(pillLabel)}</span>
    </div>
    ${busy ? `<div style="height:2px;background:#1E3050;border-radius:1px;margin-bottom:10px;overflow:hidden;"><div style="height:100%;background:linear-gradient(90deg,transparent,#3B82F6,transparent);animation:spin 1.2s linear infinite;border-radius:1px;"></div></div>` : ""}
    ${rows || `<div style="font-size:12px;color:#4A6080;margin-bottom:10px;">${escapeHtml(t("status.antennaIdle","Noch keine Prüfung in dieser Sitzung."))}</div>`}
    <div style="margin-top:14px;">
      <button class="btn btn-primary btn-sm" type="button" data-start-antenna ${state.connection.connected&&!busy?"":"disabled"}>
        ${escapeHtml(busy?t("operation.checkRunning","Läuft …"):t("action.check","Prüfen"))}
      </button>
    </div>
  `;
}

function renderTechnicalPanel() {
  const chip = state.currentChip || state.lastScan?.chip;
  const details = chip?.details || {};
  const rows = Object.entries(details).filter(([, value]) => value);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("analysis.technicalTitle","Chip-Details"))}</div>
      ${chip
        ? `<span style="font-size:10.5px;font-weight:600;color:#22C55E;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:4px;padding:2px 7px;">${escapeHtml(chip.technology||t("chip.generic","Chip"))}</span>`
        : `<span style="font-size:10.5px;font-weight:600;color:#4A6080;background:#111D30;border:1px solid #1E3050;border-radius:4px;padding:2px 7px;">${escapeHtml(t("status.idle","Kein Chip"))}</span>`}
    </div>
    ${rows.length
      ? rows.map(([label, value]) => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #111D30;">
          <span style="font-size:11.5px;color:#4A6080;flex-shrink:0;padding-right:8px;">${escapeHtml(label)}</span>
          <span style="font-size:11px;font-family:var(--mono);color:#CBD5E1;text-align:right;word-break:break-all;">${escapeHtml(value)}</span>
        </div>
      `).join("")
      : `<div style="font-size:12px;color:#4A6080;">${escapeHtml(t("analysis.noRealChip","In dieser Sitzung noch kein Chip gelesen."))}</div>`}
  `;
}

function renderTemplatesView() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;animation:fadeIn .35s ease both;">
      <div style="padding:14px 18px;border-bottom:1px solid #1E3050;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="search" placeholder="${escapeHtml(t("templates.searchPlaceholder","Suchen …"))}" value="${escapeHtml(state.templateSearch)}" data-template-search
          style="padding:5px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-family:inherit;font-size:12.5px;flex:1;min-width:120px;"/>
        <select data-template-type-filter style="padding:5px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-size:12px;"></select>
        <select data-template-sort style="padding:5px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-size:12px;">
          ${templateSortOptions().map(([value, label]) => `<option value="${value}" ${state.templateSort===value?"selected":""}>${label}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-import-templates>${escapeHtml(t("action.import","Importieren"))}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;align-content:start;" data-template-list></div>
    </div>`;
}

function patchTemplatesView() {
  const typeFilter = appView.querySelector("[data-template-type-filter]");
  if (typeFilter) {
    const options = [["all", t("templates.allTypes", "All types")], ...templateTypes().map((type) => [type, type])];
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
    : `<div style="font-size:13px;color:#4A6080;padding:8px 0;">${escapeHtml(t("templates.empty","Keine passenden Vorlagen gefunden."))}</div>`;
}

function renderTemplateItem(template) {
  return `
    <article style="background:#0D1525;border:1px solid #1E3050;border-radius:11px;padding:13px;display:flex;flex-direction:column;gap:8px;animation:fadeInUp .3s ease both;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="font-size:13px;font-weight:600;color:#F1F5F9;line-height:1.3;">${escapeHtml(template.name)}</div>
        ${template.technology ? `<span style="flex-shrink:0;font-size:10.5px;padding:2px 7px;background:#162438;border:1px solid #1E3050;border-radius:4px;color:#CBD5E1;">${escapeHtml(template.technology)}</span>` : ""}
      </div>
      <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;">${escapeHtml(template.uid||"—")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;color:#4A6080;">
        ${template.frequency ? `<span>${escapeHtml(template.frequency)}</span>` : ""}
        ${template.created_display ? `<span>· ${escapeHtml(template.created_display)}</span>` : ""}
        ${template.category ? `<span>· ${escapeHtml(template.category)}</span>` : ""}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
        <button class="btn btn-primary btn-sm" type="button" data-use-template-target="${escapeHtml(template.id)}">${escapeHtml(t("write.useAsTarget","Als Ziel verwenden"))}</button>
        <button style="background:none;border:0;color:#4A6080;font-size:18px;cursor:pointer;padding:2px 5px;" type="button" data-template-menu="${escapeHtml(template.id)}" aria-label="${escapeHtml(t("action.moreActions","Mehr"))}">⋯</button>
      </div>
    </article>
  `;
}

function renderBackupsView() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;animation:fadeIn .35s ease both;">
      <div style="padding:14px 18px;border-bottom:1px solid #1E3050;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="search" placeholder="${escapeHtml(t("backups.searchPlaceholder","Suchen …"))}" value="${escapeHtml(state.backupSearch)}" data-backup-search
          style="padding:5px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-family:inherit;font-size:12.5px;flex:1;min-width:120px;"/>
        <select data-backup-sort style="padding:5px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-size:12px;">
          ${backupSortOptions().map(([value, label]) => `<option value="${value}" ${state.backupSort===value?"selected":""}>${label}</option>`).join("")}
        </select>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;align-content:start;" data-backup-list></div>
    </div>`;
}

function patchBackupsView() {
  replaceHtml("[data-backup-list]", renderBackupList());
}

function renderBackupList() {
  const backups = getVisibleBackups();
  return backups.length
    ? backups.map(renderBackupItem).join("")
    : `<div style="font-size:13px;color:#4A6080;padding:8px 0;">${escapeHtml(t("backups.empty","Keine passenden Backups gefunden."))}</div>`;
}

function renderBackupItem(backup) {
  return `
    <article style="background:#0D1525;border:1px solid #1E3050;border-radius:11px;padding:13px;display:flex;flex-direction:column;gap:8px;animation:fadeInUp .3s ease both;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="font-size:13px;font-weight:600;color:#F1F5F9;line-height:1.3;">${escapeHtml(backup.technology||t("chip.generic","Chip"))}</div>
        ${backup.technology ? `<span style="flex-shrink:0;font-size:10.5px;padding:2px 7px;background:#162438;border:1px solid #1E3050;border-radius:4px;color:#CBD5E1;">${escapeHtml(backup.technology)}</span>` : ""}
      </div>
      <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;">${escapeHtml(backup.uid||"—")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;color:#4A6080;">
        ${backup.created_display ? `<span>${escapeHtml(backup.created_display)}</span>` : ""}
        ${backup.source ? `<span>· ${escapeHtml(backup.source)}</span>` : ""}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
        <button class="btn btn-primary btn-sm" type="button" data-use-backup-target="${escapeHtml(backup.id)}">${escapeHtml(t("write.useAsTarget","Als Ziel verwenden"))}</button>
        <button style="background:none;border:0;color:#4A6080;font-size:18px;cursor:pointer;padding:2px 5px;" type="button" data-backup-menu="${escapeHtml(backup.id)}" aria-label="${escapeHtml(t("action.moreActions","Mehr"))}">⋯</button>
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
    <div style="background:#0D1525;border:1px solid #1E3050;border-radius:11px;padding:13px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:700;color:#F1F5F9;">${escapeHtml(chip.technology || t("chip.generic", "Chip"))}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10.5px;padding:2px 7px;background:#162438;border:1px solid #1E3050;border-radius:4px;color:#CBD5E1;">${escapeHtml(statusLabel(chip))}</span>
          ${options.infoKey ? `<button type="button" data-info-chip="${escapeHtml(options.infoKey)}" aria-label="${escapeHtml(t("action.showDetails", "Show details"))}" style="width:18px;height:18px;border-radius:50%;background:#162438;border:1px solid #1E3050;color:#4A6080;font-size:10px;cursor:pointer;font-family:inherit;">i</button>` : ""}
        </div>
      </div>
      ${chip.frequency ? `<div style="font-size:11px;color:#3B82F6;margin-bottom:6px;">${escapeHtml(chip.frequency)}</div>` : ""}
      <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;margin-bottom:10px;">${escapeHtml(chip.uid || "—")}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${facts.map((field) => `
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #111D30;">
            <span style="font-size:11px;color:#4A6080;">${escapeHtml(field.label)}</span>
            <span style="font-size:11px;font-family:var(--mono);color:${field.isReadonly ? "#4A6080" : "#CBD5E1"};">${escapeHtml(field.value || "")}</span>
          </div>
        `).join("")}
      </div>
      ${regions.length ? `
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:3px;">
          ${regions.map((r) => `<span style="font-size:10px;padding:2px 6px;background:#162438;border:1px solid #1E3050;border-radius:4px;color:#4A6080;font-family:var(--mono);">${escapeHtml((r.label||r.id||"").substring(0,8))}</span>`).join("")}
        </div>
      ` : ""}
    </div>
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
    return `<div style="font-size:13px;color:#4A6080;padding:8px 0;">${escapeHtml(t("chip.noMemoryRead", "No memory areas read."))}</div>`;
  }
  return regions.map((region) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #111D30;">
      <strong style="font-size:11.5px;color:#4A6080;font-weight:600;">${escapeHtml(region.label)}</strong>
      <span style="font-size:11px;font-family:var(--mono);color:#CBD5E1;text-align:right;word-break:break-all;max-width:60%;">${escapeHtml(region.value)}</span>
    </div>
  `).join("");
}

function renderEmptyChip(label) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;color:#4A6080;">
      <div style="width:40px;height:40px;border-radius:50%;background:#111D30;border:1px solid #1E3050;" aria-hidden="true"></div>
      <strong style="font-size:13px;font-weight:600;">${escapeHtml(label)}</strong>
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
  const wasLost = state.connection.status === "lost";
  state.connection = { status: "checking", connected: false, message_key: "connection.checking" };
  setStatus(t("connection.checking", "Checking Proxmark3 connection ..."));
  render();
  try {
    state.connection = await callBridge("refresh_connection");
    setStatus(state.connection.connected ? t("app.ready", "Ready") : state.connection);
    if (state.connection.connected) {
      // Unblock startup error screen so the user can continue
      if (state.startupFlow === "antenna-error") {
        state.startupFlow = "antenna-ready";
      }
      // After a mid-session reconnect, force a full re-render of the current
      // screen so any static disabled states (buttons, notes) get cleared
      if (wasLost) {
        renderedScreenKey = "";
      }
    }
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
  const action = state.knownActions[regionId] || (state.comparison?.actions || []).find((item) => item.region_id === regionId);
  if (!action?.enabled) {
    showToast(t("write.actionBlocked", "Diese Schreibaktion ist nicht freigegeben."));
    return;
  }
  const response = await callBridge("start_write_region", regionId);
  state.writeOperations[regionId] = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus(t("write.actionStarted", "Write action started"));
  render();
  pollWriteOperation(response.operation_id, regionId);
}

async function startWriteAll() {
  if (anyWriteBusy()) return;
  if (!enabledWriteActions().length) {
    showToast(t("write.noEnabledActions", "Keine freigegebenen Schreibaktionen."));
    return;
  }
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
  // Reset write operation so navigating back always shows the form, not a stale DONE screen
  if (view === "write") state.autoWriteOperation = null;
  state.activeView = view;
  appView.scrollTop = 0;
  appView.scrollLeft = 0;
  render();
  resetStatusForView();
  appView.focus({ preventScroll: true });
}

function openSaveTemplateModal() {
  if (!state.lastScan?.canSave) return;
  // Auto-suggest name: "<ChipType>_YYYYMMDD"
  const chip = state.lastScan?.chip;
  const tech = (chip?.technology || chip?.type || "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`;
  const defaultName = tech ? `${tech}_${datePart}` : datePart;
  state.activeModal = { type: "saveTemplate" };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:380px;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="saveTitle">
        <h2 id="saveTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:16px;">${escapeHtml(t("template.saveTitle", "Save template"))}</h2>
        <form style="display:flex;flex-direction:column;gap:14px;" data-save-template-form>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="templateName" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("field.name", "Name"))}</label>
            <input id="templateName" name="name" value="${escapeHtml(defaultName)}" autocomplete="off" required style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;" />
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="templateDescription" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("field.description", "Description"))}</label>
            <textarea id="templateDescription" name="description" style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;resize:vertical;min-height:64px;"></textarea>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="templateCategory" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("template.categoryNote", "Category / note"))}</label>
            <input id="templateCategory" name="category" autocomplete="off" style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;" />
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
            <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
            <button class="btn btn-primary" type="submit">${escapeHtml(t("action.save", "Save"))}</button>
          </div>
        </form>
      </div>
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
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:380px;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="editTitle">
        <h2 id="editTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:16px;">${escapeHtml(t("template.editTitle", "Edit template"))}</h2>
        <form style="display:flex;flex-direction:column;gap:14px;" data-edit-template-form data-template-id="${escapeHtml(template.id)}">
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="editName" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("field.name", "Name"))}</label>
            <input id="editName" name="name" value="${escapeHtml(template.name)}" autocomplete="off" required style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;" />
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="editDescription" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("field.description", "Description"))}</label>
            <textarea id="editDescription" name="description" style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;resize:vertical;min-height:64px;">${escapeHtml(template.description || "")}</textarea>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="editCategory" style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(t("template.categoryNote", "Category / note"))}</label>
            <input id="editCategory" name="category" value="${escapeHtml(template.category || "")}" autocomplete="off" style="padding:7px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;" />
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
            <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
            <button class="btn btn-primary" type="submit">${escapeHtml(t("action.save", "Save"))}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modalRoot.querySelector("input")?.focus();
}

function openConfirmDeleteTemplate(templateId) {
  clearPopover();
  state.activeModal = { type: "deleteTemplate", id: templateId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:320px;max-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="deleteTemplateTitle">
        <h2 id="deleteTemplateTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:16px;">${escapeHtml(t("template.confirmDelete", "Delete template?"))}</h2>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
          <button class="btn btn-sm" type="button" data-confirm-delete-template="${escapeHtml(templateId)}" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#EF4444;">${escapeHtml(t("action.delete", "Delete"))}</button>
        </div>
      </div>
    </div>
  `;
}

function openConfirmDeleteBackup(backupId) {
  clearPopover();
  state.activeModal = { type: "deleteBackup", id: backupId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:320px;max-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="deleteBackupTitle">
        <h2 id="deleteBackupTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:16px;">${escapeHtml(t("backup.confirmDelete", "Delete backup?"))}</h2>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.cancel", "Cancel"))}</button>
          <button class="btn btn-sm" type="button" data-confirm-delete-backup="${escapeHtml(backupId)}" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#EF4444;">${escapeHtml(t("action.delete", "Delete"))}</button>
        </div>
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
  const detailRow = (label, value) => `
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1E3050;font-size:12.5px;">
      <span style="color:#4A6080;">${escapeHtml(label)}</span>
      <span style="color:#CBD5E1;font-family:var(--mono);">${escapeHtml(value)}</span>
    </div>`;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:380px;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="backupDetailsTitle">
        <h2 id="backupDetailsTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:16px;">${escapeHtml(t("backup.detailsTitle", "Backup details"))}</h2>
        <div style="display:flex;flex-direction:column;gap:0;margin-bottom:14px;">
          ${detailRow(t("chip.type", "Chip type"), backup.technology || "")}
          ${detailRow("UID", backup.uid || "")}
          ${detailRow("Config", chip.config || "")}
          ${detailRow(t("label.timestamp", "Timestamp"), backup.created_display || "")}
          ${detailRow(t("label.source", "Source"), backup.source || "")}
        </div>
        <div style="margin-bottom:14px;">
          ${renderDataRows(chip.memoryRegions)}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
        </div>
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
  `).join("") : `<div style="font-size:13px;color:#4A6080;padding:8px 0;">${escapeHtml(t("backups.none", "No backups available."))}</div>`;
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
  const rows = Object.entries(details).map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1E3050;font-size:12px;">
      <span style="color:#4A6080;">${escapeHtml(label)}</span>
      <span style="font-family:var(--mono);color:#CBD5E1;">${escapeHtml(value)}</span>
    </div>`).join("");
  openPopover(trigger, `<div style="padding:4px 0;">${rows}</div>`);
}

function openHelpModal(topic) {
  const key = HELP_TOPICS.includes(topic) ? topic : HELP_TOPICS[0];
  state.activeModal = { type: "help", topic: key };
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div style="background:#0D1525;border:1px solid #1E3050;border-radius:16px;padding:24px;min-width:380px;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.5);" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <h2 id="helpTitle" style="font-size:15px;font-weight:700;color:#F1F5F9;margin-bottom:12px;">${escapeHtml(t(`help.${key}.title`, "Help"))}</h2>
        <p style="font-size:13px;color:#4A6080;line-height:1.6;margin-bottom:16px;">${escapeHtml(t(`help.${key}.body`, ""))}</p>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" type="button" data-close-modal>${escapeHtml(t("action.close", "Close"))}</button>
        </div>
      </div>
    </div>
  `;
}

function detailsForKey(key) {
  if (!key) return null;
  const chip = state.lastScan?.chip || state.currentChip;
  if (!chip) return null;
  const details = chip.details || {};
  if (Object.keys(details).length) return details;
  return null;
}

function openPopover(trigger, content) {
  clearPopover();
  const el = document.createElement("div");
  el.className = "popover";
  el.innerHTML = content;
  document.body.appendChild(el);
  state.activePopover = el;
  const rect = trigger.getBoundingClientRect();
  const popRect = el.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left;
  if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
  if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 6;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
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
  toastRoot.innerHTML = `
    <div style="position:absolute;bottom:48px;left:50%;transform:translateX(-50%);pointer-events:none;">
      <div class="toast" role="status"><span>${escapeHtml(message)}</span></div>
    </div>`;
  toastTimer = setTimeout(() => { toastRoot.hidden = true; }, 2800);
}

function setTransientStatus(message) {
  if (!message) return;
  showToast(message);
}

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;

  const navButton = target.closest("[data-view]");
  if (navButton) {
    setActiveView(navButton.dataset.view);
    return;
  }

  // ── Language selection (first-run screen) ───────────────────────────
  const chooseLanguage = target.closest("[data-choose-language]");
  if (chooseLanguage) {
    await setLanguage(chooseLanguage.dataset.chooseLanguage, true);
    state.startupFlow = state.settings.show_startup_check_on_launch !== false ? "checking" : "done";
    await loadCollections();
    await loadTarget();
    if (state.settings.show_startup_check_on_launch !== false) {
      await runStartupCheck();
    } else {
      render();
    }
    return;
  }

  // ── Write actions ────────────────────────────────────────────────────
  const writeActionBtn = target.closest("[data-write-action]");
  if (writeActionBtn) {
    await startWriteAction(writeActionBtn.dataset.writeAction);
    return;
  }

  // ── Template & backup targeting ──────────────────────────────────────
  const useTemplateBtn = target.closest("[data-use-template-target]");
  if (useTemplateBtn) {
    await useTemplateTarget(useTemplateBtn.dataset.useTemplateTarget);
    return;
  }
  const useBackupBtn = target.closest("[data-use-backup-target]");
  if (useBackupBtn) {
    await useBackupTarget(useBackupBtn.dataset.useBackupTarget);
    return;
  }
  const templateMenuBtn = target.closest("[data-template-menu]");
  if (templateMenuBtn) {
    openTemplateMenu(templateMenuBtn, templateMenuBtn.dataset.templateMenu);
    return;
  }

  // ── Template popover actions ─────────────────────────────────────────
  const editTemplateBtn = target.closest("[data-edit-template]");
  if (editTemplateBtn) {
    openEditTemplateModal(editTemplateBtn.dataset.editTemplate);
    return;
  }
  const duplicateTemplateBtn = target.closest("[data-duplicate-template]");
  if (duplicateTemplateBtn) {
    await duplicateTemplate(duplicateTemplateBtn.dataset.duplicateTemplate);
    return;
  }

  // ── Backup popover / confirm actions ────────────────────────────────
  const deleteBackupBtn = target.closest("[data-delete-backup]");
  if (deleteBackupBtn) {
    openConfirmDeleteBackup(deleteBackupBtn.dataset.deleteBackup);
    return;
  }
  const confirmDeleteBackupBtn = target.closest("[data-confirm-delete-backup]");
  if (confirmDeleteBackupBtn) {
    await deleteBackup(confirmDeleteBackupBtn.dataset.confirmDeleteBackup);
    return;
  }

  // ── Info / help popovers ─────────────────────────────────────────────
  const infoChipBtn = target.closest("[data-info-chip]");
  if (infoChipBtn) {
    openInfoPopover(infoChipBtn);
    return;
  }

  if (target.closest("[data-read-scan]")) {
    await startReadScan();
    return;
  }
  if (target.closest("[data-verify-after-write]")) {
    setActiveView("read");
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
  if (target.closest("[data-write-reset]")) {
    state.autoWriteOperation = null;
    render();
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
  const backupMenu = target.closest("[data-backup-menu]");
  if (backupMenu) {
    openBackupMenu(backupMenu, backupMenu.dataset.backupMenu);
    return;
  }
  if (target.closest("[data-open-backup-targets]")) {
    openBackupTargetPopover(target.closest("[data-open-backup-targets]"));
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
  if (target.closest("[data-analysis-details]")) {
    state.analysisShowDetails = true;
    patchAnalysisView();
    return;
  }
  if (target.closest("[data-start-selftest]")) {
    state.positionResult = null;
    state.antennaResult = null;
    state.analysisShowDetails = false;
    startPositionCheck();
    await startAntennaCheck();
    return;
  }
  if (target.closest("[data-close-modal]")) {
    closeModal();
    return;
  }
  // ── Startup screen buttons ───────────────────────────────────────────
  if (target.closest("[data-continue-overview]")) {
    await continueToOverview();
    return;
  }
  if (target.closest("[data-startup-antenna]")) {
    // On "antenna-ready": start the antenna check for the first time.
    // On "antenna-error":  re-run the full startup (connection + antenna).
    if (state.startupFlow === "antenna-ready") {
      await startAntennaCheck({ startup: true });
    } else {
      await runStartupCheck();
    }
    return;
  }
  // ── Sidebar settings panel ──────────────────────────────────────────
  if (target.closest("[data-settings-toggle]")) {
    const isOpening = settingsPanel.hidden;
    settingsPanel.hidden = !isOpening;
    if (isOpening) {
      // Populate PM3 path input with current value
      const pathInput = settingsPanel.querySelector("[data-pm3-path-input]");
      if (pathInput) {
        try {
          const res = await callBridge("get_pm3_path");
          if (res?.path) pathInput.value = res.path;
        } catch {
          // ignore
        }
      }
    }
    return;
  }
  if (target.closest("[data-run-startup-check]")) {
    settingsPanel.hidden = true;
    await runStartupCheck();
    return;
  }
  if (target.closest("[data-refresh-connection]")) {
    settingsPanel.hidden = true;
    await refreshConnection();
    render();
    return;
  }
  if (target.closest("[data-import-templates]")) {
    settingsPanel.hidden = true;
    await importTemplates();
    return;
  }
  if (target.closest("[data-save-pm3-path]")) {
    const pathInput = settingsPanel.querySelector("[data-pm3-path-input]");
    const newPath = pathInput?.value?.trim() || "";
    if (!newPath) { showToast("Bitte einen Pfad eingeben."); return; }
    try {
      const res = await callBridge("update_pm3_path", { path: newPath });
      if (res?.ok) {
        showToast("Pfad gespeichert. Verbindung wird geprüft …");
        settingsPanel.hidden = true;
        await refreshConnection();
        render();
      } else {
        showToast(res?.message || "Pfad konnte nicht gespeichert werden.");
      }
    } catch (err) {
      showToast(err.message || "Fehler beim Speichern des Pfads.");
    }
    return;
  }
  // ────────────────────────────────────────────────────────────────────
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
    return;
  }
  // Keyboard shortcuts — skip when focus is inside an input/textarea/select
  const inInput = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement;
  if (inInput || event.metaKey || event.ctrlKey || event.altKey) return;
  // Space = start scan (Lesen view)
  if (event.code === "Space" && state.activeView === "read"
      && state.connection.connected && !isOperationBusy(state.readOperation)) {
    event.preventDefault();
    startReadScan();
    return;
  }
  // W = write all (Schreiben view)
  if ((event.key === "w" || event.key === "W") && state.activeView === "write"
      && state.connection.connected && !anyWriteBusy() && enabledWriteActions().length) {
    event.preventDefault();
    startWriteAll();
    return;
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
