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
const appShell = document.querySelector("[data-app-shell]");

const TERMINAL_STATES = new Set(["succeeded", "failed", "verification_failed", "connection_lost"]);
const TRANSIENT_STATUS_MS = 2600;
const STARTUP_ANTENNA_RESULT_MS = 5000;
const STARTUP_CONNECTION_RETRY_MS = 900;
const WRITE_SCAN_BACKUP_STEP_MIN_MS = 650;
const WRITE_ORDER = ["page_4", "page_5", "page_6", "page_7", "page_1"];
const STARTUP_FLOW_STATES = new Set([
  "language",
  "checking",
  "notFound",
  "antenna",
  "bridgeMissing",
  "antenna-ready",
  "antenna-running",
  "antenna-result",
  "antenna-error",
]);
const READ_PROGRESS_KEYS = [
  "operation.pm3ConnectionChecking",
  "operation.scanSearchAuto",
  "operation.scanSearchHf",
  "operation.scanSearchLf",
  "operation.firstReadRunning",
  "operation.secondReadRunning",
  "operation.scanCompare",
];
const CURRENT_SCAN_PROGRESS_KEYS = [
  "operation.pm3ConnectionChecking",
  "operation.currentChipFullRead",
  "operation.backupSaving",
];
const ANTENNA_PROGRESS_KEYS = ["operation.pm3ConnectionChecking", "operation.antennaRunning"];
const HELP_TOPICS = [
  "notDetected",
  "readFails",
  "signalUnstable",
  "antennaFails",
  "saveFails",
  "writeVerifyFails",
];
const GITHUB_PROFILE = {
  login: "DevOpsOfChaos",
  name: "Manu",
  avatarUrl: "https://avatars.githubusercontent.com/u/233074384?v=4",
  url: "https://github.com/DevOpsOfChaos",
  publicRepos: 9,
};
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
  ["Backup wird erstellt ...", "operation.backupSaving"],
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
  ["Der Transponder entspricht der Vorlage.", "write.matchesTemplate"],
  ["Vorlage erfolgreich übernommen und geprüft.", "write.templateAppliedVerified"],
  ["Änderung erfolgreich geprüft.", "write.singleChangeVerified"],
  ["Die Vorlage kann mit diesem Transponder nicht vollständig übernommen werden.", "write.templateCannotBeFullyApplied"],
]);

const fallbackLocales = { en: {} };

let statusTimer = null;
let renderedScreenKey = "";
let bootPromise = null;
let comparisonRequestSeq = 0;
let targetSelectionSeq = 0;

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
  comparisonLoading: false,
  readOperation: null,
  currentScanOperation: null,
  writeOperations: {},
  autoWriteOperation: null,
  knownActions: {},
  completedActions: {},
  failedRegionId: null,
  writeShowDetails: false,
  positionOperation: null,
  positionResult: null,
  antennaOperation: null,
  antennaResult: null,
  analysisShowDetails: false,
  helpTopic: "notDetected",
  toasts: [],
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function checkingConnectionState() {
  return { status: "checking", connected: false, message_key: "connection.checking" };
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
  return formatTemplate(
    t(key, message),
    payload.message_args || payload.messageArgs || payload.details?.message_args || payload.details?.messageArgs || {},
  );
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

function operationHasProgressKey(operation, key) {
  return (operation?.progress_keys || []).includes(key);
}

function isWriteScanProgressVisible(operation) {
  return isOperationBusy(operation)
    || (operation?.state === "succeeded" && operationHasProgressKey(operation, "operation.backupSaving"));
}

function operationPercent(operation, totalSteps = 1) {
  if (!operation) return 0;
  if (TERMINAL_STATES.has(operation.state)) return operation.state === "succeeded" ? 100 : 0;
  const details = operation.details || {};
  if (Number.isFinite(details.total_steps) && details.total_steps > 0) {
    const done = Number(details.completed_steps || 0);
    const active = details.active_region ? 0.35 : 0;
    return Math.max(0, Math.min(99, Math.round(((done + active) / details.total_steps) * 100)));
  }
  const steps = Math.max(operation.progress_keys?.length || operation.progress?.length || 0, operation.state === "running" ? 1 : 0);
  return Math.max(0, Math.min(99, Math.round((steps / Math.max(totalSteps, 1)) * 100)));
}

function progressBar(percent, color = "#3B82F6", height = 4) {
  return `<div style="height:${height}px;background:#162438;border-radius:${height}px;overflow:hidden;">
    <div style="height:100%;width:${Math.max(0, Math.min(100, percent))}%;background:${color};border-radius:${height}px;transition:width 180ms ease;"></div>
  </div>`;
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
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder, element.getAttribute("placeholder") || ""));
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
  if (!state.bridgeReady) return t("bridgeMissing.short", "Desktop-Bridge fehlt");
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
  if (!state.bridgeReady) {
    if (deviceDot) deviceDot.className = "device-dot is-err";
    if (devicePort) devicePort.textContent = t("bridgeMissing.short", "Desktop-Bridge fehlt");
    if (deviceWifi) deviceWifi.hidden = true;
    if (statusDot) statusDot.className = "status-dot is-err";
    if (statusConn) statusConn.textContent = "";
    if (statusPort) statusPort.textContent = "";
    return;
  }

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
    statusConn.textContent = connected ? t("connection.pm3Connected", "PM3 connected") : "";
  }
  if (statusPort) {
    statusPort.textContent = connected ? (connection.port || "") : "";
  }

  // Template counter badge
  const badge = document.querySelector("[data-template-count]");
  if (badge) badge.textContent = (state.templates || []).length;
  const backupBadge = document.querySelector("[data-backup-count]");
  if (backupBadge) backupBadge.textContent = (state.backups || []).length;
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
  if (!state.bridgeReady && state.startupFlow !== "done") return "bridge-missing";
  if (STARTUP_FLOW_STATES.has(state.startupFlow)) return `startup:${state.startupFlow}`;
  if (state.activeView === "overview") return "overview";
  if (state.activeView === "read") return `read:${readSurface()}`;
  return state.activeView;
}

function isStartupScreenKey(key) {
  return key === "bridge-missing" || key.startsWith("startup:");
}

function writeHeaderSubtitle() {
  if (isOperationBusy(state.currentScanOperation)) return t("operation.currentChipFullRead", "Chip wird gelesen ...");
  if (isOperationBusy(state.autoWriteOperation)) return t("write.writing", "Schreibe Änderungen ...");
  if (state.autoWriteOperation?.state === "succeeded") return t("write.doneTitle", "Chip erfolgreich beschrieben");
  if (!state.currentChip) return t("write.introBody", "Chip scannen, dann Vorlage wählen");
  if (!state.target) return t("write.chooseTargetState", "Chip gelesen · Vorlage wählen");
  if (state.comparisonLoading) return `${state.target.label || t("write.targetState", "Zielzustand")} · ${t("write.comparisonLoading", "Vergleich wird berechnet ...")}`;
  if (state.comparison?.writable_difference_count) {
    return `${state.target.label || t("write.targetState", "Zielzustand")} · ${formatOpenCount(state.comparison.writable_difference_count)}`;
  }
  return state.target.label || t("write.comparisonNoOpen", "Der Transponder entspricht der Vorlage.");
}

function countLabel(count, oneKey, manyKey, oneFallback, manyFallback) {
  const key = count === 1 ? oneKey : manyKey;
  const fallback = count === 1 ? oneFallback : manyFallback;
  return t(key, fallback).replace("{count}", count);
}

function updateHeader(key) {
  const headers = {
    "overview":      [t("nav.overview", "Übersicht"), ""],
    "read:start":    [t("nav.read", "Lesen"), ""],
    "read:scanning": [t("nav.read", "Lesen"), ""],
    "read:unstable": [t("nav.read", "Lesen"), ""],
    "read:result":   [t("nav.read", "Lesen"), ""],
    "write":         [t("nav.write", "Schreiben"), writeHeaderSubtitle()],
    "analysis":      [t("nav.analysis", "Selbsttest"), ""],
    "templates":     [t("nav.templates", "Vorlagen"), countLabel(state.templates.length, "templates.countOne", "templates.countMany", "1 Vorlage", "{count} Vorlagen")],
    "backups":       [t("nav.backups", "Backups"), countLabel(state.backups.length, "backups.countOne", "backups.countMany", "1 Backup", "{count} Backups")],
  };
  const [title, sub] = headers[key] || ["PM3 Studio", ""];
  if (mainTitle) mainTitle.textContent = title;
  if (mainSub)   mainSub.textContent   = sub;
  if (headerActions) headerActions.innerHTML = headerActionsForKey(key);
}

function helpTopicForScreen(key) {
  if (key.startsWith("read:unstable")) return "signalUnstable";
  if (key.startsWith("read:")) return "readFails";
  if (key === "write") return "writeVerifyFails";
  if (key === "analysis") return "antennaFails";
  if (key === "templates") return "saveFails";
  return "notDetected";
}

function headerActionsForKey(key) {
  if (isStartupScreenKey(key)) return "";
  const topic = helpTopicForScreen(key);
  return `
    <button class="btn btn-ghost btn-sm" type="button" data-open-help="${escapeHtml(topic)}">${escapeHtml(t("overview.help", "Hilfe"))}</button>
    <button class="btn btn-ghost btn-sm" type="button" data-open-settings>${escapeHtml(t("settings.title", "Einstellungen"))}</button>
  `;
}

function render() {
  updateConnectionStatus();
  updateNavigation();
  const nextKey = screenKey();
  if (appShell) appShell.classList.toggle("is-startup", isStartupScreenKey(nextKey));
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
  if (key === "startup:notFound") return renderStartupNotFound();
  if (key === "startup:antenna") return renderStartupAntennaStandalone();
  if (key === "startup:bridgeMissing") return renderBridgeMissing();
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

const CHIP_SVG = (opts = {}) => {
  const size = opts.size || 82;
  const stroke = opts.stroke || "#3B82F6";
  const pinStroke = opts.pinStroke || "rgba(203,213,225,.36)";
  const fill = opts.fill || "#081220";
  const inner = opts.inner || "#0D1525";
  const pins = [40, 54, 68, 82, 96].map((y) => `
    <rect x="5" y="${y - 5}" width="16" height="10" rx="3" fill="${inner}" stroke="${pinStroke}" stroke-width="1.6"/>
    <rect x="119" y="${y - 5}" width="16" height="10" rx="3" fill="${inner}" stroke="${pinStroke}" stroke-width="1.6"/>
  `).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 140 140" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="chipGlow-${opts.id || "0"}" cx="44%" cy="28%" r="76%">
        <stop offset="0%" stop-color="rgba(59,130,246,.24)"/>
        <stop offset="100%" stop-color="rgba(8,13,24,0)"/>
      </radialGradient>
    </defs>
    <rect x="19" y="18" width="102" height="104" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>
    <rect x="27" y="26" width="86" height="88" rx="7" fill="url(#chipGlow-${opts.id || "0"})" stroke="rgba(203,213,225,.08)" stroke-width="1"/>
    ${pins}
    <path d="M55 70a15 15 0 0 1 30 0" stroke="${stroke}" stroke-width="4" stroke-linecap="round" opacity=".9"/>
    <path d="M47 70a23 23 0 0 1 46 0" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <path d="M39 70a31 31 0 0 1 62 0" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" opacity=".32"/>
    <circle cx="70" cy="78" r="4.2" fill="${stroke}"/>
    <circle cx="37" cy="36" r="4" fill="${stroke}" opacity=".72"/>
    <circle cx="103" cy="36" r="4" fill="${stroke}" opacity=".72"/>
    <circle cx="37" cy="104" r="4" fill="${stroke}" opacity=".72"/>
    <circle cx="103" cy="104" r="4" fill="${stroke}" opacity=".72"/>
    <circle cx="37" cy="36" r="1.8" fill="#F1F5F9" opacity=".7"/>
    <circle cx="103" cy="104" r="1.8" fill="#F1F5F9" opacity=".7"/>
  </svg>`;
};

function renderDarkStartup({ icon, title, sub, actions = "" }) {
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;text-align:center;padding:28px;background:radial-gradient(ellipse 54% 54% at 50% 42%,rgba(59,130,246,.07),transparent 70%),var(--bg);">
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
    err:       "background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.32);color:#EF4444;",
  };
  return `<button type="button" ${attrs} style="padding:9px 22px;border-radius:9px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${styles[style]||styles.primary}">${label}</button>`;
}

function startupLogoSvg(size = 48) {
  return `<div style="width:${size}px;height:${size}px;border-radius:14px;background:linear-gradient(135deg,#3B82F6,#1D4ED8);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 34px rgba(59,130,246,.34);">
    <svg width="${Math.round(size * .58)}" height="${Math.round(size * .58)}" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="2" stroke="#fff" stroke-width="1.6"/>
      <rect x="7.5" y="7.5" width="5" height="5" rx="1" fill="#fff" opacity=".86"/>
      <path d="M4 8.5H1.5M4 11.5H1.5M16 8.5h2.5M16 11.5h2.5M8.5 4V1.5M11.5 4V1.5M8.5 16v2.5M11.5 16v2.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  </div>`;
}

function startupLedDots(color = "#3B82F6") {
  return `<span style="display:inline-flex;gap:5px;margin-left:4px;vertical-align:middle;">
    ${[0, .18, .36].map((delay) => `<span style="width:5px;height:5px;border-radius:50%;background:${color};color:${color};animation:ledBlink 1.1s ease-in-out ${delay}s infinite;"></span>`).join("")}
  </span>`;
}

function startupWarningIcon(color = "#EF4444") {
  return `<div style="width:64px;height:64px;border-radius:18px;background:${color}18;border:1px solid ${color}55;display:flex;align-items:center;justify-content:center;">
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path d="M17 4 31 29H3L17 4Z" stroke="${color}" stroke-width="2.3" stroke-linejoin="round"/>
      <path d="M17 12v8" stroke="${color}" stroke-width="2.3" stroke-linecap="round"/>
      <circle cx="17" cy="25" r="1.7" fill="${color}"/>
    </svg>
  </div>`;
}

function startupBridgeIcon() {
  return `<div style="width:64px;height:64px;border-radius:18px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.38);display:flex;align-items:center;justify-content:center;">
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="22" height="14" rx="3" stroke="#EF4444" stroke-width="2.2"/>
      <path d="M12 17h10" stroke="#EF4444" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
  </div>`;
}

function renderBridgeMissing() {
  return renderDarkStartup({
    icon: startupBridgeIcon(),
    title: escapeHtml(t("bridgeMissing.title", "Desktop bridge unavailable")),
    sub: `<div>${escapeHtml(t("bridgeMissing.body", "Start in the pywebview window. Without the Python bridge no PM3 states are shown."))}</div>
      <div style="margin-top:12px;padding:10px 12px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.22);border-radius:9px;color:#EF4444;font-family:var(--mono);font-size:11.5px;">${escapeHtml(t("bridgeMissing.detail", "pywebview-Bridge nicht initialisiert"))}</div>`,
    actions: darkBtn(t("action.closeApp", "App beenden"), "data-exit-app", "err")
           + darkBtn(t("action.openLimited", "Eingeschränkt öffnen"), "data-continue-overview", "secondary"),
  });
}

function renderLanguageChoice() {
  return renderDarkStartup({
    icon: startupLogoSvg(48),
    title: escapeHtml(t("language.title", "Sprache wählen")),
    sub: escapeHtml(t("language.body", "Wähle die Sprache für PM3 Studio.")),
    actions: darkBtn(t("language.de","Deutsch"), `data-choose-language="de"`, "primary")
           + darkBtn(t("language.en","English"),  `data-choose-language="en"`, "secondary"),
  });
}

function renderStartupChecking() {
  return renderDarkStartup({
    icon: `<div class="spinner" style="width:64px;height:64px;border-width:4px;"></div>`,
    title: `${escapeHtml(t("connection.checking", "Proxmark3 wird gesucht …"))}${startupLedDots()}`,
    sub: escapeHtml(state.connection.message || t("startup.checkingBody", "Verbindung wird geprüft …")),
  });
}

function renderStartupNotFound() {
  const pm3Path = state.settings?.last_known_pm3_path || "/dev/ttyACM0";
  return renderDarkStartup({
    icon: startupWarningIcon("#EF4444"),
    title: escapeHtml(t("connection.notFound", "PM3 nicht gefunden")),
    sub: `
      <div>${escapeHtml(uiMessage(state.connection, "connection.noDeviceReconnect", "Kein Proxmark erkannt. Bitte PM3 verbinden und erneut prüfen."))}</div>
      <input type="text" value="${escapeHtml(pm3Path)}" data-pm3-path-input aria-label="${escapeHtml(t("settings.pm3Path", "PM3-Pfad"))}"
        style="margin-top:14px;width:min(320px,100%);padding:8px 12px;background:var(--s2);border:1px solid var(--bd);border-radius:7px;color:var(--brt);font-family:var(--mono);font-size:12.5px;text-align:center;" />
    `,
    actions: darkBtn(t("action.retry", "Erneut prüfen"), "data-refresh-connection", "primary")
           + darkBtn(t("settings.enterPath", "Pfad eingeben"), "data-save-pm3-path", "secondary"),
  });
}

function startupAntennaIcon() {
  return `<div style="position:relative;width:150px;height:150px;">
    ${[0, .4, .8, 1.2].map((delay) => `<div style="position:absolute;top:50%;left:50%;width:130px;height:130px;border-radius:50%;border:1.5px solid rgba(245,158,11,.35);animation:antRing 3.2s ease-out ${delay}s infinite;"></div>`).join("")}
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:66px;height:66px;border-radius:50%;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.42);display:flex;align-items:center;justify-content:center;">
      <svg width="32" height="25" viewBox="0 0 26 20" fill="none" stroke="#F59E0B" stroke-linecap="round" stroke-width="1.9"><path d="M3 10 A10 8 0 0 1 23 10"/><path d="M7 13.5 A6 5 0 0 1 19 13.5"/><circle cx="13" cy="16" r="2" fill="#F59E0B" stroke="none"/></svg>
    </div>
  </div>`;
}

function renderStartupSelftestScreen({ title, sub, actions = "", busy = false, result = "" }) {
  return `
    <div class="startup-selftest-screen">
      <div class="startup-selftest-visual">
        ${renderSelftestStage(busy, { variant: "startup", chipSize: 108, id: busy ? "startup-selftest-running" : "startup-selftest-ready" })}
      </div>
      <div class="startup-selftest-copy">
        <div class="selftest-kicker">${escapeHtml(t("analysis.header", "Selbsttest"))}</div>
        <h1>${title}</h1>
        <div class="startup-selftest-sub">${sub}</div>
        ${result ? `<div class="startup-selftest-result">${result}</div>` : ""}
        ${actions ? `<div class="startup-selftest-actions">${actions}</div>` : ""}
      </div>
    </div>`;
}

function renderStartupAntennaStandalone() {
  return renderStartupSelftestScreen({
    busy: true,
    title: escapeHtml(t("startup.antennaRunning", "Antennentest läuft …")),
    sub: escapeHtml(t("antenna.body", "Alle Transponder von der Antenne entfernen.")),
    actions: darkBtn(t("action.continueOverview", "Überspringen"), "data-continue-overview", "secondary"),
  });
}

function renderStartupAntennaReady() {
  const connectionDetail = startupConnectionDetail();
  return renderStartupSelftestScreen({
    title: escapeHtml(t("antenna.title", "Antennenprüfung")),
    sub: `
      <div>${escapeHtml(t("connection.pm3Connected", "PM3 verbunden"))}${connectionDetail ? ` · ${escapeHtml(connectionDetail)}` : ""}</div>
      <div style="margin-top:6px;">${escapeHtml(t("antenna.body", "Alle Transponder von der Antenne entfernen."))}</div>
    `,
    actions: darkBtn(t("action.startAntennaCheck","Antennenprüfung starten"), "data-startup-antenna", "ok")
           + darkBtn(t("action.continueOverview","Überspringen"), "data-continue-overview", "secondary"),
  });
}

function startupConnectionDetail() {
  if (!state.connection.connected) return "";
  return [state.connection.port, state.connection.target, compatibilityLabel(state.connection.compatibility)]
    .filter(Boolean)
    .join(" · ");
}

function renderStartupAntennaRunning() {
  return renderStartupSelftestScreen({
    busy: true,
    title: escapeHtml(t("antenna.title", "Antennenprüfung")),
    sub: escapeHtml(uiMessage(state.antennaOperation, "operation.antennaRunning") || t("operation.antennaRunning", "Antennentest läuft ...")),
  });
}

function renderStartupAntennaResult() {
  const antenna = state.antennaResult || {};
  const seconds = Math.round(STARTUP_ANTENNA_RESULT_MS / 1000);
  return renderStartupSelftestScreen({
    title: escapeHtml(t("antenna.summaryTitle", "Antennenprüfung abgeschlossen")),
    sub: escapeHtml(t("antenna.summaryBody", "Antenne bereit. Keine Schreibaktion wurde ausgeführt.")),
    result: `
      <div style="max-width:420px;margin:0 auto;">${renderAntennaStatusSummary(antenna, true)}</div>
      <div style="margin-top:12px;font-size:11.5px;color:#64748B;">${escapeHtml(t("antenna.autoContinue", "Weiter zur Übersicht in {seconds} s").replace("{seconds}", seconds))}</div>
      <div style="height:3px;background:#162438;border-radius:3px;margin:8px auto 0;max-width:260px;overflow:hidden;">
        <div style="height:100%;background:#22C55E;animation:summaryCountdown ${STARTUP_ANTENNA_RESULT_MS}ms linear forwards;"></div>
      </div>
    `,
    actions: darkBtn(t("action.continueOverview","Weiter"), "data-continue-overview", "ok"),
  });
}

function statusPill(status) {
  const ok = String(status || "").toLowerCase() === "ok";
  const color = ok ? "#22C55E" : status ? "#F59E0B" : "#64748B";
  const background = ok ? "rgba(34,197,94,.1)" : status ? "rgba(245,158,11,.1)" : "rgba(100,116,139,.12)";
  const label = ok ? t("status.ok", "OK") : status || t("connection.notAvailable", "not available");
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 7px;border-radius:999px;background:${background};color:${color};font-size:10.5px;font-weight:800;font-family:var(--mono);">${escapeHtml(label)}</span>`;
}

function antennaRows(antenna) {
  const lf = antenna?.lf || {};
  const hf = antenna?.hf || {};
  return [
    { group: t("antenna.lf", "LF-Antenne"), label: t("antenna.lf125", "125 kHz"), value: lf.voltage_125khz || "", status: lf.status },
    { group: t("antenna.lf", "LF-Antenne"), label: t("antenna.lf134", "134,83 kHz"), value: lf.voltage_134_83khz || "", status: lf.status },
    { group: t("antenna.lf", "LF-Antenne"), label: t("antenna.lfOptimal", "Optimal"), value: [lf.optimal_frequency, lf.optimal_voltage].filter(Boolean).join(" · "), status: lf.status },
    { group: t("antenna.hf", "HF-Antenne"), label: t("antenna.hf1356", "13,56 MHz"), value: hf.voltage_13_56mhz || "", status: hf.status },
  ].filter((row) => row.value || row.status);
}

function normalizeAntennaStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["perfect", "excellent", "optimal"].includes(value)) return "perfect";
  if (value === "ok") return "ok";
  if (!value || value === "unknown") return "unknown";
  return "bad";
}

function antennaStatusLabel(status) {
  const normalized = normalizeAntennaStatus(status);
  if (normalized === "perfect") return t("antenna.statusPerfect", "Perfekt");
  if (normalized === "ok") return t("antenna.statusOk", "OK");
  if (normalized === "unknown") return t("antenna.statusUnknown", "Unbekannt");
  return t("antenna.statusProblem", "Nicht OK");
}

function antennaStatusColor(status) {
  const normalized = normalizeAntennaStatus(status);
  if (normalized === "perfect") return "#22C55E";
  if (normalized === "ok") return "#3B82F6";
  if (normalized === "unknown") return "#94A3B8";
  return "#F59E0B";
}

function renderAntennaStatusSummary(antenna, compact = false) {
  const lfStatus = antenna?.lf?.status;
  const hfStatus = antenna?.hf?.status;
  const statuses = [
    { label: t("antenna.lf", "LF-Antenne"), status: lfStatus },
    { label: t("antenna.hf", "HF-Antenne"), status: hfStatus },
  ];
  const hasProblem = statuses.some((item) => normalizeAntennaStatus(item.status) === "bad");
  const hasUnknown = statuses.some((item) => normalizeAntennaStatus(item.status) === "unknown");
  const note = hasProblem
    ? t("antenna.problemHint", "Wahrscheinlich liegt noch ein Chip auf dem Scanner. Entferne alle Chips und teste erneut.")
    : hasUnknown
      ? t("antenna.unknownHint", "Antennenstatus konnte nicht eindeutig gelesen werden. Teste bei Bedarf erneut.")
      : t("antenna.summaryBody", "Antenne bereit. Keine Schreibaktion wurde ausgeführt.");
  return `
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
      ${statuses.map((item) => {
        const color = antennaStatusColor(item.status);
        return `<div style="min-width:${compact ? "126px" : "150px"};padding:10px 12px;border:1px solid ${color};background:${color}14;border-radius:8px;text-align:left;">
          <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(item.label)}</div>
          <div style="font-size:18px;font-weight:800;color:${color};margin-top:2px;">${escapeHtml(antennaStatusLabel(item.status))}</div>
        </div>`;
      }).join("")}
    </div>
    <div style="margin-top:10px;font-size:12px;line-height:1.45;color:${hasProblem ? "#F59E0B" : "#94A3B8"};">${escapeHtml(note)}</div>`;
}

function renderAntennaValueGrid(antenna, compact = false) {
  const rows = antennaRows(antenna);
  if (!rows.length) {
    return `<div style="font-size:12px;color:#64748B;">${escapeHtml(t("status.antennaIdle", "Noch kein Antennentest in dieser Sitzung."))}</div>`;
  }
  return `<div style="display:grid;grid-template-columns:${compact ? "1fr 1fr" : "1fr"};gap:7px;text-align:left;">
    ${rows.map((row) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;background:#111D30;border:1px solid #1E3050;border-radius:8px;">
        <div style="min-width:0;">
          <div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(row.group)}</div>
          <div style="font-size:12.5px;font-weight:700;color:#CBD5E1;margin-top:1px;">${escapeHtml(row.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span style="font-size:11.5px;color:#F1F5F9;font-family:var(--mono);">${escapeHtml(row.value || "—")}</span>
          ${statusPill(row.status)}
        </div>
      </div>
    `).join("")}
  </div>`;
}

function renderStartupAntennaError() {
  const isConnErr = !state.connection.connected && !state.antennaOperation;
  const pm3Path = state.settings?.last_known_pm3_path || "C:\\Tools\\proxmark3\\client";
  const pathHint = isConnErr
    ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(15,23,42,.6);border:1px solid #1E3050;border-radius:8px;font-size:11px;color:#64748B;text-align:left;word-break:break-all;">
        <span style="color:#475569;">${escapeHtml(t("settings.searchedPath", "Gesuchter Pfad"))}:</span>
        <span style="color:#94A3B8;font-family:var(--mono);">${escapeHtml(pm3Path + "\\proxmark3.exe")}</span>
        <div style="margin-top:5px;color:#64748B;">${escapeHtml(t("settings.pm3PathHint", "Pfad falsch? In den Einstellungen den PM3-Pfad anpassen."))}</div>
      </div>`
    : "";
  return renderStartupSelftestScreen({
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

function renderOverview() {
  return `
    <div style="flex:1;overflow-y:auto;background:var(--bg);" data-overview-page data-logo-placeholder="${escapeHtml(t("overview.logoPlaceholder", "Logo"))}">
      <section style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:370px;padding:48px 40px 44px;text-align:center;overflow:hidden;border-bottom:1px solid var(--bd);">
        <div style="position:absolute;top:50%;left:50%;pointer-events:none;">
          <div style="position:absolute;top:50%;left:50%;width:600px;height:600px;border-radius:50%;border:1px solid rgba(59,130,246,.09);animation:rfidRing 6s ease-out infinite;"></div>
          <div style="position:absolute;top:50%;left:50%;width:600px;height:600px;border-radius:50%;border:1px solid rgba(59,130,246,.07);animation:rfidRing 6s ease-out 2s infinite;"></div>
          <div style="position:absolute;top:50%;left:50%;width:600px;height:600px;border-radius:50%;border:1px solid rgba(59,130,246,.05);animation:rfidRing 6s ease-out 4s infinite;"></div>
        </div>
        <div style="position:absolute;top:18px;right:24px;width:58px;height:58px;border-radius:12px;border:1px solid rgba(59,130,246,.2);background:rgba(59,130,246,.06);display:flex;align-items:center;justify-content:center;color:#2A4070;font-family:var(--mono);font-size:9px;font-weight:800;letter-spacing:.7px;">
          ${escapeHtml(t("overview.logoPlaceholder", "LOGO"))}
        </div>
        <div style="position:relative;z-index:2;margin-bottom:22px;filter:drop-shadow(0 0 22px rgba(59,130,246,.24));">${CHIP_SVG({ size: 58, id: "overview-hero", stroke: "rgba(59,130,246,.72)" })}</div>
        <h1 style="position:relative;z-index:2;font-size:36px;line-height:1.08;font-weight:800;color:var(--brt);max-width:720px;margin:0 auto 14px;">
          ${escapeHtml(t("overview.heroTitle", "RFID-Chips lesen, sichern und kontrolliert beschreiben."))}
        </h1>
        <p style="position:relative;z-index:2;font-size:15px;line-height:1.55;color:var(--dim);max-width:520px;margin:0 auto 20px;">
          ${escapeHtml(t("overview.heroBody", "Dieses Tool führt Proxmark3-Workflows in einer Oberfläche zusammen: echte Hardwareprüfung, bestätigte Reads, Vorlagen, Backups und verifizierte Schreibvorgänge."))}
        </p>
        <div style="position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">
          <span style="font-family:var(--mono);font-size:11px;color:#3B82F6;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.28);border-radius:999px;padding:5px 12px;">LF · 125 kHz</span>
          <span style="font-family:var(--mono);font-size:11px;color:#3B82F6;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.28);border-radius:999px;padding:5px 12px;">HF · 13.56 MHz</span>
          <span style="font-size:12px;font-weight:800;color:#22C55E;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.24);border-radius:999px;padding:5px 12px;">Open Source</span>
        </div>
      </section>

      <section style="padding:36px 28px;border-bottom:1px solid var(--bd);">
        <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#4A6080;margin:0 0 18px;">${escapeHtml(t("overview.capabilities", "Was kann PM3 Studio?"))}</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;">
          ${[
            ["#3B82F6", "overview.explain1Title", "overview.explain1Body", `<path d="M2 8 A7 7 0 0 1 14 8 A7 7 0 0 1 2 8"/><circle cx="8" cy="8" r="2.5"/>`],
            ["#F59E0B", "overview.explain2Title", "overview.explain2Body", `<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8h6M8 5v6"/>`],
            ["#818CF8", "overview.explain3Title", "overview.explain3Body", `<path d="M3 8h10"/><path d="M9 4l4 4-4 4"/><path d="M3 4v8"/>`],
          ].map(([color, titleKey, bodyKey, icon], index) => `
            <article style="background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:18px;animation:fadeInUp .4s ease ${(.1 + index * .08).toFixed(2)}s both;">
              <div style="width:44px;height:44px;border-radius:12px;background:${color}1A;display:flex;align-items:center;justify-content:center;color:${color};margin-bottom:16px;">
                <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
              </div>
              <h2 style="font-size:15px;font-weight:800;color:var(--brt);margin:0 0 8px;">${escapeHtml(t(titleKey, titleKey))}</h2>
              <p style="font-size:13px;line-height:1.55;color:var(--dim);margin:0;">${escapeHtml(t(bodyKey, bodyKey))}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <section style="padding:28px;border-bottom:1px solid var(--bd);">
        <div style="background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:28px;display:flex;align-items:center;justify-content:center;gap:15px;flex-wrap:wrap;">
          ${[
            ["1", "#3B82F6", "overview.step1"],
            ["2", "#3B82F6", "overview.step2"],
            ["3", "#F59E0B", "overview.step4"],
            ["4", "#F59E0B", "overview.step5"],
            ["✓", "#22C55E", "overview.step6"],
          ].map(([num, color, key], index, list) => `
            <div style="display:flex;align-items:center;gap:15px;">
              <div style="display:flex;align-items:center;gap:10px;min-width:132px;">
                <div style="width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${color}1F;border:1px solid ${color}55;color:${color};font-size:13px;font-weight:800;font-family:var(--mono);">${escapeHtml(num)}</div>
                <div style="font-size:12.5px;font-weight:700;color:var(--tx);line-height:1.3;">${escapeHtml(t(key, key))}</div>
              </div>
              ${index < list.length - 1 ? `<div style="font-size:20px;color:#1E3050;">→</div>` : ""}
            </div>
          `).join("")}
        </div>
      </section>

      <section style="padding:28px;border-bottom:1px solid var(--bd);">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;">
          ${[
            ["LF · 125 kHz", "#F59E0B", "Hitag S256, Indala und Low-Frequency-Workflows"],
            ["HF · 13.56 MHz", "#3B82F6", "HF-Erkennung und sichere Read-only-Prüfpfade"],
          ].map(([label, color, body]) => `
            <article style="background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:20px;display:flex;align-items:center;gap:16px;">
              <div style="width:54px;height:54px;border-radius:14px;background:${color}14;border:1px solid ${color}40;color:${color};display:flex;align-items:center;justify-content:center;">
                <svg width="26" height="21" viewBox="0 0 26 21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.9"><path d="M3 10 A10 8 0 0 1 23 10"/><path d="M7 13.5 A6 5 0 0 1 19 13.5"/><circle cx="13" cy="17" r="2" fill="currentColor" stroke="none"/></svg>
              </div>
              <div>
                <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:${color};margin-bottom:6px;">${escapeHtml(label)}</div>
                <div style="font-size:13px;line-height:1.55;color:var(--dim);">${escapeHtml(body)}</div>
              </div>
            </article>
          `).join("")}
        </div>
      </section>

      <section style="padding:28px;background:var(--s1);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:18px;">
            <img src="${escapeHtml(GITHUB_PROFILE.avatarUrl)}" alt="${escapeHtml(GITHUB_PROFILE.login)}" referrerpolicy="no-referrer"
              style="width:84px;height:84px;border-radius:24px;object-fit:cover;border:1px solid rgba(59,130,246,.35);box-shadow:0 12px 30px rgba(59,130,246,.2);background:#111D30;" />
            <div>
              <div style="font-size:24px;font-weight:800;color:var(--brt);letter-spacing:-.3px;">${escapeHtml(GITHUB_PROFILE.name)}</div>
              <div style="font-size:12px;color:#3B82F6;font-family:var(--mono);margin-top:2px;">@${escapeHtml(GITHUB_PROFILE.login)} · ${GITHUB_PROFILE.publicRepos} repos</div>
              <div style="font-size:13.5px;line-height:1.6;color:var(--dim);max-width:620px;">${escapeHtml(t("overview.githubBody", "Entwicklung, Automatisierung und pragmatische Tools rund um Hardware, Workflows und DevOps."))}</div>
            </div>
          </div>
          <a href="${escapeHtml(GITHUB_PROFILE.url)}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:#111D30;border:1px solid #1E3050;color:#CBD5E1;text-decoration:none;font-weight:700;font-size:13px;">
            ${escapeHtml(t("overview.githubLink", "GitHub öffnen"))}
          </a>
        </div>
      </section>
    </div>`;
}

function patchOverview() {
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
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;animation:fadeInUp .4s ease both;">
          <div style="font-size:17px;font-weight:600;color:#3B82F6;" data-read-progress-title>${escapeHtml(t("operation.scanStarting","Scan wird gestartet ..."))}</div>
          <div style="font-family:var(--mono);font-size:13px;color:#3B82F6;" data-read-progress-percent>0%</div>
        </div>
        <div style="width:260px;margin:0 auto 12px;" data-read-progress-bar>${progressBar(0)}</div>
        <div style="display:flex;flex-direction:column;gap:5px;text-align:left;width:260px;" data-read-progress></div>
      </div>
    </div>`;
}

function patchReadScanning() {
  const progress = operationProgress(state.readOperation, "operation.running");
  const title = progress[progress.length - 1] || t("operation.scanStarting", "Scan wird gestartet ...");
  const totalSteps = state.readMode === "hf" ? 4 : 5;
  const percent = operationPercent(state.readOperation, totalSteps);
  const titleNode = appView.querySelector("[data-read-progress-title]");
  if (titleNode) titleNode.textContent = title;
  const percentNode = appView.querySelector("[data-read-progress-percent]");
  if (percentNode) percentNode.textContent = `${percent}%`;
  replaceHtml("[data-read-progress-bar]", progressBar(percent));
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
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;position:relative;padding:24px;
        background:radial-gradient(ellipse 55% 55% at 50% 48%,rgba(34,197,94,.05) 0%,transparent 70%);">
        <div style="position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 28px rgba(34,197,94,.18));animation:fadeInUp .5s ease .1s both;">
          <div style="position:absolute;top:50%;left:50%;width:170px;height:170px;border-radius:50%;border:2px solid rgba(34,197,94,.58);animation:successBurst 1.4s ease-out .1s both;"></div>
          <div style="position:absolute;top:50%;left:50%;width:170px;height:170px;border-radius:50%;border:1.5px solid rgba(34,197,94,.42);animation:successBurst 1.4s ease-out .38s both;"></div>
          ${CHIP_SVG({size:170,id:"read-result",stroke:"rgba(34,197,94,.7)",pinStroke:"rgba(34,197,94,.32)"})}
        </div>
        <div style="text-align:center;animation:fadeInUp .5s ease .28s both;">
          <div style="font-size:12.5px;font-weight:700;color:#F1F5F9;margin-bottom:4px;" data-read-result-tech></div>
          <div style="font-size:10.5px;color:#3B82F6;font-family:var(--mono);" data-read-result-subtitle></div>
        </div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:20px;color:#22C55E;font-size:13px;font-weight:600;animation:fadeInUp .45s ease .34s both;" data-read-result-badge>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7 L5.7 9.7 L11 4" stroke="#22C55E" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>${escapeHtml(t("read.secondScanConfirmed","Zweiter Scan bestätigt"))}</span>
        </div>
        <div style="max-width:520px;width:100%;animation:fadeInUp .45s ease .42s both;" data-read-memory-blocks></div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;animation:fadeInUp .45s ease .5s both;" data-read-result-actions></div>
      </div>
      <div style="width:220px;flex-shrink:0;border-left:1px solid #1E3050;overflow-y:auto;background:#0D1525;animation:slideInRight .5s ease both;">
        <div data-read-chip-panel></div>
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
  const techNode = appView.querySelector("[data-read-result-tech]");
  if (techNode) techNode.textContent = chip.technology || t("chip.generic", "Chip");
  const subtitleNode = appView.querySelector("[data-read-result-subtitle]");
  if (subtitleNode) subtitleNode.textContent = chipDisplayLine(chip) || subtitle;
  const badge = appView.querySelector("[data-read-result-badge]");
  if (badge && !scan.confirmed) {
    badge.style.background = "rgba(245,158,11,.1)";
    badge.style.borderColor = "rgba(245,158,11,.28)";
    badge.style.color = "#F59E0B";
    badge.querySelector("span").textContent = uiMessage(scan, "read.notTemplateConfirmed");
  }

  const scanBusy = isOperationBusy(state.readOperation);
  replaceHtml("[data-read-result-actions]", `
    <button class="btn btn-ghost" type="button" data-read-scan ${state.connection.connected && !scanBusy ? "" : "disabled"}>${escapeHtml(t("read.scanNewChip","Neu scannen"))}</button>
    <button class="btn btn-ok" type="button" data-open-save-template ${scan.canSave ? "" : "disabled"}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7"/><path d="M4 6l3 3 3-3"/><path d="M3 12h8"/></svg>
      ${escapeHtml(t("template.saveAs","Speichern"))}
    </button>
  `);
  replaceHtml("[data-read-memory-blocks]", renderDesignMemoryBlocks(chip.memoryRegions || [], { align: "center" }));

  const regions = chip.memoryRegions || [];
  replaceHtml("[data-read-chip-panel]", `
    <div style="padding:15px 14px;border-bottom:1px solid #1E3050;">
      <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;margin-bottom:10px;">${escapeHtml(t("action.details","Details"))}</div>
      ${renderChipInfoRows(chip)}
    </div>
    <div style="padding:14px;">
      <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;margin-bottom:9px;">${escapeHtml(t("chip.memoryAreas","Rohdaten"))}</div>
      <div style="display:flex;flex-direction:column;gap:5px;">${renderRawMemoryRows(regions)}</div>
    </div>
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
  const isScanBusy = isWriteScanProgressVisible(state.currentScanOperation);
  const scanPercent = operationPercent(state.currentScanOperation, 3);

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
          <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;animation:fadeInUp .4s ease both;">
            <div style="font-size:17px;font-weight:600;color:#F59E0B;" data-write-scan-title>${escapeHtml(t("operation.currentChipFullRead","Aktueller Chip wird vollständig gelesen ..."))}</div>
            <div style="font-family:var(--mono);font-size:13px;color:#F59E0B;" data-write-scan-percent>${scanPercent}%</div>
          </div>
          <div style="width:260px;margin:0 auto 12px;" data-write-scan-bar>${progressBar(scanPercent, "#F59E0B")}</div>
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
  replaceHtml("[data-write-scan-progress]", writeIntroProgressItems(state.currentScanOperation));
  const progress = operationProgress(state.currentScanOperation, "operation.running");
  const title = progress[progress.length - 1] || t("operation.currentChipFullRead", "Aktueller Chip wird vollständig gelesen ...");
  const percent = operationPercent(state.currentScanOperation, 3);
  const titleNode = appView.querySelector("[data-write-scan-title]");
  if (titleNode) titleNode.textContent = title;
  const percentNode = appView.querySelector("[data-write-scan-percent]");
  if (percentNode) percentNode.textContent = `${percent}%`;
  replaceHtml("[data-write-scan-bar]", progressBar(percent, "#F59E0B"));
  // If scanning just started and we were on idle intro, rebuild to show scan rings
  const isBusy = isWriteScanProgressVisible(state.currentScanOperation);
  const hasRings = !!appView.querySelector("[data-write-intro] [style*=scanRing]");
  if (isBusy && !hasRings) appView.innerHTML = renderWriteIntro();
}

function targetStateKey(target = state.target) {
  return target ? `${target.kind || "target"}:${target.id || ""}` : "";
}

function writeCompareRenderKey() {
  const actions = state.comparison?.actions || [];
  return [
    targetStateKey(),
    state.comparisonLoading ? "loading" : "ready",
    state.comparison?.writable_difference_count ?? "none",
    actions.map((action) => `${action.region_id}:${action.enabled ? "1" : "0"}:${action.toValue || ""}`).join("|"),
  ].join("::");
}

function templateTargetPreview(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return null;
  return {
    kind: "template",
    id: template.id,
    label: template.name,
    source: `Vorlage · ${template.name}`,
    chip: template.chip,
  };
}

function backupTargetPreview(backupId) {
  const backup = state.backups.find((item) => item.id === backupId);
  if (!backup) return null;
  return {
    kind: "backup",
    id: backup.id,
    label: backup.created_display || backup.technology || backup.id,
    source: `Backup · ${backup.created_display || backup.technology || backup.id}`,
    chip: backup.chip,
  };
}

function resetComparisonForTargetChange({ loading = false } = {}) {
  comparisonRequestSeq += 1;
  state.comparison = null;
  state.comparisonLoading = loading;
  state.completedActions = {};
  state.failedRegionId = null;
  state.knownActions = {};
}

function renderComparisonLoadingPanel() {
  return `
    <div style="display:flex;align-items:center;gap:9px;padding:12px;background:#111D30;border:1px solid #1E3050;border-radius:9px;color:#F59E0B;font-size:13px;font-weight:700;">
      <div style="width:12px;height:12px;border:2px solid #F59E0B;border-top-color:transparent;border-radius:50%;animation:spin .55s linear infinite;"></div>
      <span>${escapeHtml(t("write.comparisonLoading", "Vergleich wird berechnet ..."))}</span>
    </div>`;
}

function writeActionMap() {
  return new Map((state.comparison?.actions || []).map((action) => {
    state.knownActions[action.region_id] = action;
    return [action.region_id, action];
  }));
}

function renderWriteChipReady() {
  const chip = state.currentChip || {};
  const templatesAvailable = getSortedTemplates().length > 0;
  return `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;overflow:auto;position:relative;padding:24px;
      background:radial-gradient(ellipse 56% 56% at 50% 44%,rgba(34,197,94,.05) 0%,transparent 70%);" data-write-ready>
      <div style="animation:chipFloat 3.5s ease-in-out infinite;filter:drop-shadow(0 0 18px rgba(34,197,94,.2));">
        ${CHIP_SVG({size:120,id:"write-ready",stroke:"rgba(34,197,94,.7)",pinStroke:"rgba(34,197,94,.32)"})}
      </div>
      <div style="text-align:center;">
        <div style="font-size:12.5px;font-weight:700;color:#F1F5F9;margin-bottom:4px;">${escapeHtml(chip.technology || t("chip.generic", "Chip"))}</div>
        <div style="font-size:10.5px;color:#3B82F6;font-family:var(--mono);">${escapeHtml(chipDisplayLine(chip))}</div>
      </div>
      <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:20px;color:#22C55E;font-size:13px;font-weight:600;">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7 L5.7 9.7 L11 4" stroke="#22C55E" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${escapeHtml(t("write.currentChipReady", "Chip erfolgreich gelesen"))}</span>
      </div>
      <div style="width:min(520px,100%);height:1px;background:linear-gradient(90deg,transparent,#1E3050,transparent);"></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:11px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#4A6080;">${escapeHtml(t("write.chooseTargetState", "Vorlage als Zielzustand wählen"))}</div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;">
          ${renderWriteTemplateSelect("data-write-template-select")}
          <button class="btn btn-warn" type="button" data-start-compare ${templatesAvailable ? "" : "disabled"} style="padding:9px 20px;font-size:13px;font-weight:700;">
            ${escapeHtml(t("write.comparisonWritable", "Vergleich starten"))} →
          </button>
        </div>
        <button type="button" data-open-backup-targets style="font-size:11.5px;color:#3B82F6;background:none;border:0;cursor:pointer;font-family:inherit;">${escapeHtml(t("write.useBackupTarget", "Backup als Zielzustand verwenden"))}</button>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-write-scan ${state.connection.connected && !isOperationBusy(state.currentScanOperation) ? "" : "disabled"}>${escapeHtml(t("read.scanNewChip", "Neu scannen"))}</button>
    </div>`;
}

function renderWriteChipColumn(chip, options = {}) {
  const actionMap = options.actionMap || new Map();
  return `
    <div style="flex:1;min-width:240px;display:flex;flex-direction:column;align-items:center;text-align:center;">
      <div style="filter:drop-shadow(0 0 18px ${options.glow || "rgba(59,130,246,.2)"});">
        ${CHIP_SVG({size:122,id:options.id || "compare",stroke:options.stroke || "#3B82F6",pinStroke:options.pinStroke || "rgba(59,130,246,.28)"})}
      </div>
      <div style="margin-top:10px;font-size:12.5px;font-weight:700;color:#F1F5F9;">${escapeHtml(options.title || chip?.technology || t("chip.generic", "Chip"))}</div>
      <div style="margin-top:3px;font-size:10.5px;color:${options.metaColor || "#3B82F6"};font-family:var(--mono);">${escapeHtml(options.meta || chipDisplayLine(chip || {}))}</div>
      <div style="margin-top:14px;width:100%;">${renderDesignMemoryBlocks(chip?.memoryRegions || [], { actionMap, mode: options.mode || "source", align: "center" })}</div>
    </div>`;
}

function renderWriteDiffPanel() {
  if (state.comparisonLoading) return renderComparisonLoadingPanel();
  const actions = orderedActionRows(state.comparison?.actions || []);
  const enabled = actions.filter((action) => action.enabled);
  const autoBusy = isOperationBusy(state.autoWriteOperation);
  const dangerBanner = state.comparison?.status === "danger"
    ? `<div style="margin-bottom:10px;padding:9px 12px;border-radius:9px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);color:#F59E0B;font-size:12px;">${escapeHtml(t("write.incompatibleWarn", "Zielzustand passt nicht vollständig. Nur freigegebene Bereiche werden geschrieben."))}</div>`
    : "";
  if (!state.comparison) {
    return `<div style="font-size:13px;color:#EF4444;">${escapeHtml(t("write.emptyComparison", "Vergleich konnte für diese Kombination nicht berechnet werden."))}</div>`;
  }
  if (!actions.length) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
        <div style="font-size:13px;font-weight:700;color:#22C55E;">${escapeHtml(t("write.matchesTemplate", "Der Transponder entspricht der Vorlage."))}</div>
        <button class="btn btn-primary btn-sm" type="button" data-write-details>${escapeHtml(t("write.showTechnicalDetails", "Technische Details anzeigen"))}</button>
      </div>
      ${state.writeShowDetails ? `<div style="margin-top:12px;">${renderPageMatrix()}</div>` : ""}`;
  }
  return `
    ${dangerBanner}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px;">
      <div>
        <div style="font-size:14px;font-weight:800;color:#F1F5F9;">${escapeHtml(formatOpenCount(enabled.length))}</div>
        ${autoBusy ? `<div style="font-size:11.5px;color:#818CF8;margin-top:3px;">${escapeHtml(autoProgressText())}</div>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-ghost btn-sm" type="button" data-write-details>${escapeHtml(state.writeShowDetails ? t("action.hideDetails", "Details ausblenden") : t("write.showTechnicalDetails", "Technische Details anzeigen"))}</button>
        <button class="btn btn-warn" type="button" data-write-all ${state.connection.connected && enabled.length && !anyWriteBusy() ? "" : "disabled"} style="font-size:14px;font-weight:700;padding:12px 30px;">
          ${escapeHtml(t("write.applyAll", "Alle Änderungen anwenden"))}
        </button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:7px;">
      ${actions.map((action) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:9px;background:#111D30;border:1px solid ${action.enabled ? "rgba(245,158,11,.28)" : "#1E3050"};">
          <div style="font-size:12.5px;font-weight:700;color:#CBD5E1;">${escapeHtml(action.label)}</div>
          <div style="display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11.5px;">
            <span style="color:#4A6080;">${escapeHtml(shortHex(action.fromValue))}</span>
            <span style="color:#F59E0B;">→</span>
            <span style="color:#F1F5F9;">${escapeHtml(shortHex(action.toValue))}</span>
            ${action.enabled ? `<span style="color:#F59E0B;">≠</span>` : `<span style="color:#4A6080;">${escapeHtml(action.reason || t("write.actionBlocked", "Blockiert"))}</span>`}
          </div>
        </div>
      `).join("")}
    </div>
    ${state.writeShowDetails ? `<div style="margin-top:12px;">${renderPageMatrix()}</div>` : ""}`;
}

function renderWriteCompare() {
  const chip = state.currentChip || {};
  const targetChip = state.target?.chip || {};
  const actionMap = writeActionMap();
  const diffCount = state.comparison?.writable_difference_count || (state.comparison?.actions || []).filter((action) => action.enabled).length;
  const diffLabel = state.comparisonLoading ? t("write.comparisonLoadingShort", "Vergleich ...") : formatOpenCount(diffCount);
  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;animation:fadeIn .35s ease both;" data-write-compare data-target-key="${escapeHtml(targetStateKey())}" data-render-key="${escapeHtml(writeCompareRenderKey())}">
      <div style="height:54px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid #1E3050;background:#0D1525;">
        <button class="btn btn-ghost btn-sm" type="button" data-write-back>← ${escapeHtml(t("action.back", "Zurück"))}</button>
        ${renderWriteTemplateSelect("data-target-select")}
        <div style="margin-left:auto;font-size:11px;color:#4A6080;font-family:var(--mono);">${escapeHtml(chipDisplayLine(chip))}</div>
      </div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;background:radial-gradient(ellipse 48% 48% at 50% 38%,rgba(245,158,11,.035) 0%,transparent 72%);">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:30px;padding:26px 28px 22px;">
          ${renderWriteChipColumn(chip, { id:"compare-current", title:t("write.currentChip", "Aktueller Chip"), stroke:"#3B82F6", metaColor:"#3B82F6", glow:"rgba(59,130,246,.2)", actionMap, mode:"source" })}
          <div style="width:122px;display:flex;flex-direction:column;align-items:center;gap:10px;flex-shrink:0;">
            <div style="height:82px;width:1px;background:linear-gradient(transparent,#1E3050,transparent);"></div>
            <div style="width:42px;height:42px;border-radius:50%;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.34);display:flex;align-items:center;justify-content:center;color:#F59E0B;font-size:20px;">→</div>
            <div style="padding:4px 10px;border-radius:20px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.28);color:#F59E0B;font-size:11.5px;font-weight:800;">${escapeHtml(diffLabel)}</div>
            <div style="height:82px;width:1px;background:linear-gradient(transparent,#1E3050,transparent);"></div>
          </div>
          ${renderWriteChipColumn(targetChip, { id:"compare-target", title:state.target?.label || t("write.targetState", "Zielzustand"), stroke:"#F59E0B", pinStroke:"rgba(245,158,11,.28)", metaColor:"#F59E0B", glow:"rgba(245,158,11,.2)", actionMap, mode:"target" })}
        </div>
        <div style="border-top:1px solid #1E3050;background:#0D1525;padding:16px 18px;" data-write-diff-panel>
          ${renderWriteDiffPanel()}
        </div>
      </div>
    </div>`;
}

function renderWriteView() {
  if (isOperationBusy(state.autoWriteOperation)) return renderWriteAnimating();
  if (!isOperationBusy(state.autoWriteOperation) && state.autoWriteOperation?.state === "succeeded") return renderWriteDone();
  if (!state.currentChip) return renderWriteIntro();
  if (!state.target) return renderWriteChipReady();
  return renderWriteCompare();
}

function patchWriteView() {
  const desired = isOperationBusy(state.autoWriteOperation)
    ? "anim"
    : (!isOperationBusy(state.autoWriteOperation) && state.autoWriteOperation?.state === "succeeded")
      ? "done"
      : !state.currentChip
        ? "intro"
        : !state.target
          ? "ready"
          : "compare";
  const current = appView.querySelector("[data-write-anim]") ? "anim"
    : appView.querySelector("[data-write-done]") ? "done"
    : appView.querySelector("[data-write-intro]") ? "intro"
    : appView.querySelector("[data-write-ready]") ? "ready"
    : appView.querySelector("[data-write-compare]") ? "compare"
    : "";

  if (current !== desired) {
    appView.innerHTML = renderWriteView();
  } else if (desired === "compare") {
    const compareNode = appView.querySelector("[data-write-compare]");
    if (compareNode?.dataset.targetKey !== targetStateKey() || compareNode?.dataset.renderKey !== writeCompareRenderKey()) {
      appView.innerHTML = renderWriteView();
    }
  }
  if (desired === "intro") patchWriteIntroScan();
  if (desired === "anim") patchWriteAnimProgress();
  if (desired === "compare") replaceHtml("[data-write-diff-panel]", renderWriteDiffPanel());
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
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:5px;">${escapeHtml(t("status.compatibility", "Compatibility"))}</div>
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
  if (state.comparisonLoading) {
    replaceHtml("[data-action-panel]", `
      <div style="font-size:14px;font-weight:700;color:#F1F5F9;margin-bottom:8px;">${escapeHtml(t("write.changes","Änderungen"))}</div>
      ${renderComparisonLoadingPanel()}
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
  if (!state.writeShowDetails) {
    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button class="btn btn-ghost btn-sm" type="button" data-write-details>
          ${escapeHtml(t("write.showTechnicalDetails", "Technische Details anzeigen"))}
        </button>
      </div>
    `;
  }
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
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="font-size:11px;color:#CBD5E1;text-align:right;max-width:280px;">${escapeHtml(equivalence || "")}</div>
          <button class="btn btn-ghost btn-sm" type="button" data-write-details>${escapeHtml(t("action.hideDetails", "Details ausblenden"))}</button>
        </div>
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
  const pct = operationPercent(state.autoWriteOperation, total);
  const activeRegion = autoDetails.active_region || "";
  const activeAction = actions.find((a) => a.region_id === activeRegion);
  const blockLabel = escapeHtml(activeAction?.label || activeRegion || t("write.writing", "Schreibe…"));
  const detail = escapeHtml(uiMessage(state.autoWriteOperation, "write.regionApplying",
    `${completed}/${total} ${t("write.blocks", "Blöcke")} abgeschlossen`));
  const hexBytes = ["A4","10","B4","20","C5","54","65","73","74","30"];
  const hexLeft  = [10, 50, 92, 133, 172, 30, 70, 112, 153, 192];
  const particles = hexBytes.map((hex, i) =>
    `<span style="position:absolute;top:148px;left:${hexLeft[i]}px;font-family:'JetBrains Mono',monospace;font-size:12px;color:${i%2===0?"#6366F1":"#818CF8"};animation:dataParticle 1.8s ease-in infinite;animation-delay:${(i*0.17).toFixed(2)}s;">${hex}</span>`
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
        ${progressBar(pct, "linear-gradient(90deg,#4F46E5,#818CF8)")}
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
  const pct = operationPercent(state.autoWriteOperation, total);
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
    ${progressBar(pct, "linear-gradient(90deg,#4F46E5,#818CF8)")}
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
  if (state.comparisonLoading) {
    return `<div style="padding:8px 12px;border-radius:8px;background:#111D30;border:1px solid #1E3050;font-size:12.5px;color:#F59E0B;">${escapeHtml(t("write.comparisonLoading", "Vergleich wird berechnet ..."))}</div>`;
  }
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
  if (state.comparisonLoading) return renderComparisonLoadingPanel();
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
  const percent = operationPercent(state.autoWriteOperation, Math.max(total, 1));
  return t("write.autoProgress", "{done} / {total} Bereiche · {percent}%")
    .replace("{done}", done)
    .replace("{total}", total)
    .replace("{percent}", percent);
}

function comparisonMessage(comparison) {
  if (!comparison.compatible) return t("write.comparisonIncompatible", "Not compatible · target state does not match current chip");
  if (comparison.writable_difference_count) {
    return t("write.comparisonWritable", "Compatible · {count} applicable changes").replace("{count}", comparison.writable_difference_count);
  }
  return t("write.comparisonNoOpen", "Compatible · no open writable changes");
}

function selftestStepState(kind) {
  if (kind === "connection") {
    if (state.connection.connected) return "done";
    return state.connection.status === "checking" ? "running" : "failed";
  }
  if (kind === "position") {
    if (isOperationBusy(state.positionOperation)) return "running";
    if (state.positionResult) return state.positionResult.failed || state.positionResult.error ? "failed" : "done";
    return "idle";
  }
  if (kind === "antenna") {
    if (isOperationBusy(state.antennaOperation)) return "running";
    if (state.antennaResult) {
      const lf = normalizeAntennaStatus(state.antennaResult.lf?.status);
      const hf = normalizeAntennaStatus(state.antennaResult.hf?.status);
      return lf === "bad" || hf === "bad" ? "failed" : "done";
    }
    return "idle";
  }
  return "idle";
}

function selftestStateMeta(status) {
  const meta = {
    done: ["#22C55E", "✓", t("status.done", "Fertig")],
    running: ["#3B82F6", "", t("operation.running", "Operation läuft ...")],
    failed: ["#EF4444", "!", t("operation.failed", "Operation fehlgeschlagen.")],
    idle: ["#4A6080", "•", t("status.idle", "Bereit")],
  };
  return meta[status] || meta.idle;
}

function renderSelftestStep({ kind, title, body }, index) {
  const status = selftestStepState(kind);
  const [color, icon, label] = selftestStateMeta(status);
  const indicator = status === "running"
    ? `<span class="selftest-spinner" aria-hidden="true"></span>`
    : escapeHtml(icon);
  return `
    <div class="selftest-step is-${status}" style="animation-delay:${(index * 0.07).toFixed(2)}s;">
      <div class="selftest-step-icon" style="--step-color:${color};">${indicator}</div>
      <div style="min-width:0;flex:1;">
        <div class="selftest-step-title">${escapeHtml(title)}</div>
        <div class="selftest-step-body">${escapeHtml(body)}</div>
      </div>
      <div class="selftest-step-status" style="color:${color};">${escapeHtml(label)}</div>
    </div>`;
}

function selftestSteps() {
  return [
    {
      kind: "connection",
      title: t("analysis.connectionTitle", "PM3-Verbindung"),
      body: state.connection.connected ? startupConnectionDetail() : t("connection.retryCheck", "Verbindung erneut prüfen"),
    },
    {
      kind: "antenna",
      title: t("analysis.antennaTitle", "Antenne prüfen"),
      body: t("analysis.antennaMeta", "nutzt den echten hw tune-Pfad"),
    },
    {
      kind: "position",
      title: t("analysis.positionTitle", "Position optimieren"),
      body: t("analysis.positionMeta", "begrenzte Read-only-Messserie"),
    },
  ];
}

function renderSelftestStage(isBusy = false, options = {}) {
  const variant = options.variant ? ` is-${options.variant}` : "";
  const chipSize = options.chipSize || 96;
  const id = options.id || "selftest-chip";
  return `
    <div class="selftest-stage${variant} ${isBusy ? "is-running" : ""}">
      <div class="selftest-rings" aria-hidden="true">
        <span style="animation-delay:0s;"></span>
        <span style="animation-delay:.65s;"></span>
        <span style="animation-delay:1.3s;"></span>
      </div>
      <div class="selftest-chip" aria-hidden="true">${CHIP_SVG({ size: chipSize, id, stroke: "rgba(34,197,94,.68)", pinStroke: "rgba(34,197,94,.28)" })}</div>
      <div class="selftest-reader">${PM3_READER_SVG}</div>
      <div class="selftest-trace" aria-hidden="true">
        ${["LF", "HF", "UID", "CFG", "P4", "P5"].map((label, index) => `<span style="animation-delay:${(index * 0.18).toFixed(2)}s;">${label}</span>`).join("")}
      </div>
    </div>`;
}

function renderSelftestChecklist() {
  return `<div class="selftest-list">${selftestSteps().map(renderSelftestStep).join("")}</div>`;
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
    <div class="selftest-page" data-analysis-intro>
      <div class="selftest-main">
        ${renderSelftestStage(false, { variant: "analysis", chipSize: 104, id: "analysis-selftest-idle" })}
        <div class="selftest-frequency-row">
          <div><strong>${escapeHtml(t("antenna.lf", "LF-Antenne"))}</strong><span>125 kHz · 134,83 kHz</span></div>
          <div><strong>${escapeHtml(t("antenna.hf", "HF-Antenne"))}</strong><span>13,56 MHz</span></div>
        </div>
      </div>
      <aside class="selftest-side">
        <div class="selftest-kicker">${escapeHtml(t("analysis.header", "Selbsttest"))}</div>
        <h2>${escapeHtml(t("analysis.removeChipTitle","Scanner freiräumen"))}</h2>
        <p>${escapeHtml(t("analysis.removeChipBody","Entferne alle Chips vom Scanner und starte die Diagnose erneut."))}</p>
        ${renderSelftestChecklist()}
        <div class="selftest-actions">
          <button class="btn btn-ok btn-lg" type="button" data-start-selftest ${state.connection.connected?"":"disabled"}>
            ${escapeHtml(t("analysis.startDiagnosis","Diagnose starten"))}
          </button>
          <button class="btn btn-ghost btn-lg" type="button" data-open-help="antennaFails">${escapeHtml(t("overview.help", "Hilfe"))}</button>
        </div>
      </aside>
    </div>`;
}

function renderAnalysisPanels() {
  const isBusy = isOperationBusy(state.antennaOperation) || isOperationBusy(state.positionOperation);
  return `
    <div class="selftest-results" data-analysis-panels>
      <section class="selftest-results-head">
        ${renderSelftestStage(isBusy, { variant: "analysis", chipSize: 104, id: isBusy ? "analysis-selftest-running" : "analysis-selftest-result" })}
        <div>
          <div class="selftest-kicker">${escapeHtml(isBusy ? t("analysis.selftestRunning", "Selbsttest läuft") : t("analysis.doneTitle", "Selbsttest abgeschlossen"))}</div>
          <h2>${escapeHtml(isBusy ? t("analysis.selftestProgress", "PM3 und Antennen werden geprüft") : t("analysis.doneTitle", "Selbsttest abgeschlossen"))}</h2>
          ${renderSelftestChecklist()}
        </div>
      </section>
      <section class="selftest-panel-grid">
        <div class="selftest-panel" data-position-panel></div>
        <div class="selftest-panel" data-antenna-panel></div>
      </section>
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

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#F1F5F9;">${escapeHtml(t("analysis.antennaTitle","Antenne"))}</div>
      <span style="font-size:10.5px;font-weight:600;color:${pillColor};background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:4px;padding:2px 7px;">${escapeHtml(pillLabel)}</span>
    </div>
    ${busy ? `<div style="height:2px;background:#1E3050;border-radius:1px;margin-bottom:10px;overflow:hidden;"><div style="height:100%;background:linear-gradient(90deg,transparent,#3B82F6,transparent);animation:spin 1.2s linear infinite;border-radius:1px;"></div></div>` : ""}
    ${renderAntennaStatusSummary(result, false)}
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
      <div style="padding:14px 18px;border-bottom:1px solid #1E3050;background:#0D1525;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="search" placeholder="${escapeHtml(t("templates.searchPlaceholder","Suchen …"))}" value="${escapeHtml(state.templateSearch)}" data-template-search
          style="padding:8px 11px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#CBD5E1;font-family:inherit;font-size:12.5px;flex:1;min-width:180px;"/>
        <select data-template-type-filter style="padding:8px 11px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#CBD5E1;font-size:12px;"></select>
        <select data-template-sort style="padding:8px 11px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#CBD5E1;font-size:12px;">
          ${templateSortOptions().map(([value, label]) => `<option value="${value}" ${state.templateSort===value?"selected":""}>${label}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-import-templates>${escapeHtml(t("action.import","Importieren"))}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;align-content:start;align-items:start;" data-template-list></div>
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
  const regions = template.chip?.memoryRegions || [];
  const miniBlocks = regions.slice(0, 6).map((region) => {
    const page = regionPage(region);
    const isLocked = page === 0;
    const isTarget = page && page >= 4;
    const bg = isLocked ? "#0D1525" : isTarget ? "rgba(129,140,248,.1)" : "rgba(34,197,94,.1)";
    const border = isLocked ? "#1E3050" : isTarget ? "rgba(129,140,248,.28)" : "rgba(34,197,94,.22)";
    const color = isLocked ? "#4A6080" : isTarget ? "#818CF8" : "#22C55E";
    return `<div title="${escapeHtml(region.label || region.id || "")}" style="height:20px;min-width:24px;flex:1;border-radius:4px;background:${bg};border:1px solid ${border};color:${color};font-size:9px;font-family:var(--mono);font-weight:800;display:flex;align-items:center;justify-content:center;">${escapeHtml(compactRegionLabel(region))}</div>`;
  }).join("");
  return `
    <article style="background:#0D1525;border:1px solid #1E3050;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-height:276px;animation:fadeInUp .35s ease both;">
      <div style="padding:22px 16px 10px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 60% 60% at 50% 48%,rgba(129,140,248,.08),transparent 70%);">
        ${CHIP_SVG({size:82,id:`tpl-${template.id}`,stroke:"rgba(129,140,248,.66)",pinStroke:"rgba(129,140,248,.28)"})}
      </div>
      <div style="padding:0 14px 12px;display:flex;gap:5px;align-items:center;">
        ${miniBlocks || `<div style="font-size:12px;color:#4A6080;">${escapeHtml(t("chip.noMemoryRead", "Keine Speicherbereiche gelesen."))}</div>`}
      </div>
      <div style="padding:10px 14px 16px;display:flex;flex-direction:column;gap:8px;flex:1;">
        <div style="font-size:13.5px;font-weight:700;color:#F1F5F9;line-height:1.3;">${escapeHtml(template.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${template.technology ? `<span style="font-size:10.5px;padding:2px 7px;background:#162438;border:1px solid #1E3050;border-radius:5px;color:#CBD5E1;">${escapeHtml(template.technology)}</span>` : ""}
          ${template.created_display ? `<span style="font-size:10.5px;color:#4A6080;font-family:var(--mono);">${escapeHtml(template.created_display)}</span>` : ""}
        </div>
        <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;">UID ${escapeHtml(template.uid || "—")}</div>
        <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <button class="btn btn-warn btn-sm" type="button" data-use-template-target="${escapeHtml(template.id)}" style="flex:1;color:#F59E0B;">${escapeHtml(t("write.useAsTarget","Als Zielzustand verwenden"))}</button>
          <button style="width:28px;height:28px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#4A6080;font-size:18px;cursor:pointer;line-height:1;" type="button" data-template-menu="${escapeHtml(template.id)}" aria-label="${escapeHtml(t("action.moreActions","Mehr"))}">⋯</button>
        </div>
      </div>
    </article>
  `;
}

function renderBackupsView() {
  return `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;animation:fadeIn .35s ease both;">
      <div style="padding:14px 18px;border-bottom:1px solid #1E3050;background:#0D1525;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="search" placeholder="${escapeHtml(t("backups.searchPlaceholder","Suchen …"))}" value="${escapeHtml(state.backupSearch)}" data-backup-search
          style="padding:8px 11px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#CBD5E1;font-family:inherit;font-size:12.5px;flex:1;min-width:180px;"/>
        <select data-backup-sort aria-label="${escapeHtml(t("backups.sort", "Backups sortieren"))}" style="padding:8px 11px;background:#111D30;border:1px solid #1E3050;border-radius:8px;color:#CBD5E1;font-size:12px;">
          ${backupSortOptions().map(([value, label]) => `<option value="${value}" ${state.backupSort===value?"selected":""}>${label}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-import-backups>${escapeHtml(t("action.import","Importieren"))}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;align-content:start;align-items:start;" data-backup-list></div>
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
  const chip = backup.chip || {};
  const regions = chip.memoryRegions || [];
  const isHf = String(backup.frequency || chip.frequency || "").toLowerCase().includes("hf")
    || String(backup.technology || "").toLowerCase().includes("mifare");
  const stroke = isHf ? "rgba(129,140,248,.66)" : "rgba(59,130,246,.66)";
  const pinStroke = isHf ? "rgba(129,140,248,.28)" : "rgba(59,130,246,.28)";
  const frequency = backupFrequencyLabel(backup);
  const miniBlocks = regions.slice(0, 6).map((region) => `
    <div title="${escapeHtml(region.label || region.id || "")}" style="width:28px;height:20px;border-radius:4px;background:${regionPage(region) === 0 ? "#0D1525" : "rgba(59,130,246,.1)"};border:1px solid ${regionPage(region) === 0 ? "#1E3050" : "rgba(59,130,246,.24)"};color:${regionPage(region) === 0 ? "#4A6080" : "#3B82F6"};font-size:8.5px;font-family:var(--mono);font-weight:800;display:flex;align-items:center;justify-content:center;flex:0 0 28px;">${escapeHtml(compactRegionLabel(region))}</div>
  `).join("");
  return `
    <article style="background:#0D1525;border:1px solid #1E3050;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-height:296px;animation:fadeInUp .35s ease both;">
      <div style="position:relative;padding:20px 16px 10px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 62% 62% at 50% 48%,${isHf ? "rgba(129,140,248,.08)" : "rgba(59,130,246,.08)"},transparent 70%);">
        ${backup.created_display ? `<span style="position:absolute;top:10px;right:10px;background:#111D30;border:1px solid #1E3050;border-radius:6px;padding:3px 7px;font-size:9.5px;color:#4A6080;font-family:var(--mono);">${escapeHtml(backup.created_display)}</span>` : ""}
        ${CHIP_SVG({size:82,id:`bak-${backup.id}`,stroke,pinStroke})}
      </div>
      <div style="padding:0 14px 12px;display:flex;gap:5px;align-items:center;min-height:32px;">
        ${miniBlocks || `<div style="font-size:12px;color:#4A6080;">${escapeHtml(t("chip.noMemoryRead", "Keine Speicherbereiche gelesen."))}</div>`}
      </div>
      <div style="padding:10px 14px 14px;display:flex;flex-direction:column;gap:8px;flex:1;">
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <span style="font-size:13.5px;font-weight:700;color:#F1F5F9;line-height:1.25;">${escapeHtml(backup.technology || t("chip.generic","Chip"))}</span>
          ${frequency ? `<span style="font-size:10.5px;padding:2px 7px;background:#162438;border:1px solid #1E3050;border-radius:5px;color:#CBD5E1;">${escapeHtml(frequency)}</span>` : ""}
        </div>
        <div style="font-family:var(--mono);font-size:10.5px;color:#4A6080;">UID: ${escapeHtml(backup.uid || "—")} · ${escapeHtml(t("label.source", "Quelle"))}: ${escapeHtml(backup.source || "PM3")}</div>
        <div style="margin-top:auto;display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:7px;">
          <button class="btn btn-sm" type="button" data-delete-backup="${escapeHtml(backup.id)}" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.28);color:#EF4444;width:100%;">${escapeHtml(t("action.delete","Löschen"))}</button>
          <button class="btn btn-primary btn-sm" type="button" data-backup-details="${escapeHtml(backup.id)}" style="width:100%;">${escapeHtml(t("action.details","Details"))}</button>
          <button class="btn btn-warn btn-sm" type="button" data-use-backup-target="${escapeHtml(backup.id)}" style="width:100%;color:#F59E0B;">${escapeHtml(t("write.targetState","Zielzustand"))}</button>
        </div>
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
    ["name_asc", "Name A-Z"],
    ["size_desc", t("sort.largest", "Largest first")],
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
  const byName = (a, b) => String(a.technology || a.uid || "").localeCompare(String(b.technology || b.uid || ""), "de", { sensitivity: "base" });
  if (state.backupSort === "oldest") backups.sort((a, b) => byDate(a) - byDate(b));
  else if (state.backupSort === "name_asc") backups.sort((a, b) => byName(a, b) || byDate(b) - byDate(a));
  else if (state.backupSort === "size_desc") backups.sort((a, b) => backupSizeScore(b) - backupSizeScore(a) || byDate(b) - byDate(a));
  else backups.sort((a, b) => byDate(b) - byDate(a));
  return backups.filter((backup) => {
    const haystack = [backup.technology, backup.frequency, backup.uid, backup.created_display, backup.source].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });
}

function backupSizeScore(backup) {
  const regions = backup?.chip?.memoryRegions || [];
  const fields = backup?.chip?.fields || [];
  return JSON.stringify({ regions, fields }).length;
}

function backupFrequencyLabel(backup) {
  const raw = String(backup.frequency || backup.chip?.frequency || "").toLowerCase();
  if (raw === "lf") return "LF · 125 kHz";
  if (raw === "hf") return "HF · 13,56 MHz";
  if (raw.includes("125")) return "LF · 125 kHz";
  if (raw.includes("13")) return "HF · 13,56 MHz";
  return backup.frequency || backup.chip?.frequency || "";
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

function regionPage(region) {
  const match = `${region?.label || ""} ${region?.id || ""}`.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function compactRegionLabel(region) {
  const page = regionPage(region);
  if (page === 0) return "UID";
  if (page === 1) return "CFG";
  if (Number.isFinite(page)) return `P${page}`;
  return String(region?.label || region?.id || "P").slice(0, 4).toUpperCase();
}

function shortHex(value, fallback = "—") {
  const text = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!text) return fallback;
  return text.length > 8 ? text.slice(0, 8) : text;
}

function blockStyle(kind) {
  const styles = {
    locked:  { bg: "#0D1525", border: "#1E3050", label: "#2A4070", value: "#4A6080", icon: "LOCK" },
    ok:      { bg: "rgba(34,197,94,.08)", border: "rgba(34,197,94,.26)", label: "#22C55E", value: "#CBD5E1", icon: "OK" },
    diff:    { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.36)", label: "#F59E0B", value: "#F1F5F9", icon: "DIFF" },
    target:  { bg: "rgba(129,140,248,.12)", border: "rgba(129,140,248,.36)", label: "#818CF8", value: "#F1F5F9", icon: "SET" },
    unavail: { bg: "#111D30", border: "#1E3050", label: "#4A6080", value: "#4A6080", icon: "—" },
    working: { bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.34)", label: "#3B82F6", value: "#F1F5F9", icon: "RUN" },
    failed:  { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.34)", label: "#EF4444", value: "#F1F5F9", icon: "ERR" },
  };
  return styles[kind] || styles.ok;
}

function designBlockState(region, action, mode = "source") {
  const page = regionPage(region);
  if (page === 0) return "locked";
  if (!region || (!region.value && !region.currentValue)) return "unavail";
  const regionId = region.id;
  const autoDetails = state.autoWriteOperation?.details || {};
  if (state.failedRegionId === regionId || autoDetails.failed_region === regionId) return "failed";
  if (isOperationBusy(state.autoWriteOperation) && autoDetails.active_region === regionId) return "working";
  if ((autoDetails.completed_regions || []).includes(regionId) || state.completedActions[regionId]) return "ok";
  if (action) return mode === "target" ? "target" : "diff";
  return "ok";
}

function renderMemoryBlock(region, options = {}) {
  const action = options.actionMap?.get(region.id);
  const kind = designBlockState(region, action, options.mode || "source");
  const style = blockStyle(kind);
  const value = options.mode === "target" && action ? action.toValue : region.currentValue || region.value;
  const delay = Number.isFinite(options.index) ? (options.index * 0.06).toFixed(2) : "0";
  return `
    <div title="${escapeHtml(region.label || region.id || "")}" style="padding:11px 8px;border-radius:10px;min-width:64px;background:${style.bg};border:1px solid ${style.border};animation:blockReveal .4s ease ${delay}s both;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:4px;">
        <span style="font-size:10px;font-weight:800;font-family:var(--mono);color:${style.label};">${escapeHtml(compactRegionLabel(region))}</span>
        <span style="font-size:8px;font-weight:800;color:${style.label};">${escapeHtml(style.icon)}</span>
      </div>
      <div style="font-size:10.5px;font-family:var(--mono);font-weight:700;color:${style.value};white-space:nowrap;">${escapeHtml(shortHex(value))}</div>
    </div>`;
}

function renderDesignMemoryBlocks(regions, options = {}) {
  const list = Array.isArray(regions) ? regions.slice(0, options.limit || 6) : [];
  if (!list.length) {
    return `<div style="font-size:12px;color:#4A6080;">${escapeHtml(t("chip.noMemoryRead", "Keine Speicherbereiche gelesen."))}</div>`;
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:7px;justify-content:${options.align || "center"};">
    ${list.map((region, index) => renderMemoryBlock(region, { ...options, index })).join("")}
  </div>`;
}

function chipDisplayLine(chip) {
  return [chip?.frequency, chip?.uid ? `UID ${chip.uid}` : ""].filter(Boolean).join(" · ");
}

function renderChipInfoRows(chip) {
  const rows = [
    [t("chip.type", "Chiptyp"), chip?.technology],
    [t("chip.frequency", "Frequenz"), chip?.frequency],
    ["UID", chip?.uid],
    ["Config", chip?.config],
    [t("chip.memory", "Speicher"), chip?.memoryRange],
    [t("label.status", "Status"), statusLabel(chip || {})],
  ].filter(([, value]) => value);
  return rows.map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #1E3050;font-size:11.5px;">
      <span style="color:#4A6080;">${escapeHtml(label)}</span>
      <span style="color:#CBD5E1;font-family:var(--mono);text-align:right;word-break:break-all;">${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function renderRawMemoryRows(regions) {
  const list = Array.isArray(regions) ? regions.slice(0, 8) : [];
  if (!list.length) return `<div style="font-size:12px;color:#4A6080;">${escapeHtml(t("chip.noMemoryRead", "Keine Speicherbereiche gelesen."))}</div>`;
  return list.map((region) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 7px;border-radius:7px;background:#111D30;">
      <span style="font-size:10.5px;color:#4A6080;font-family:var(--mono);font-weight:800;">${escapeHtml(compactRegionLabel(region))}</span>
      <span style="font-size:11px;color:#CBD5E1;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(shortHex(region.currentValue || region.value, ""))}</span>
    </div>
  `).join("");
}

function renderWriteTemplateSelect(attrs = "data-write-template-select") {
  const templates = getSortedTemplates();
  const selectedTemplate = state.target?.kind === "template" ? state.target.id : "";
  const selected = selectedTemplate || templates[0]?.id || "";
  return `
    <select ${attrs} aria-label="${escapeHtml(t("write.targetTemplateLabel", "Zielvorlage"))}"
      style="min-width:240px;padding:9px 12px;background:#111D30;border:1px solid rgba(245,158,11,.32);border-radius:9px;color:#CBD5E1;font-size:12.5px;font-family:inherit;">
      ${templates.length ? "" : `<option value="">${escapeHtml(t("templates.empty", "Keine passenden Vorlagen im Storage gefunden."))}</option>`}
      ${templates.map((template) => `<option value="${escapeHtml(template.id)}" ${selected === template.id ? "selected" : ""}>${escapeHtml(template.name)}</option>`).join("")}
    </select>`;
}

function formatOpenCount(count) {
  return count === 1 ? t("write.openChangeOne", "1 open change") : t("write.openChangeMany", "{count} open changes").replace("{count}", count || 0);
}

async function boot() {
  state.bridgeReady = Boolean(bridge());
  await loadLocale(state.language);
  render();
  if (!state.bridgeReady) return;
  const settingsResponse = await callBridge("get_app_settings");
  state.settings = settingsResponse.settings || state.settings;
  await setLanguage(state.settings.language || "en", false);
  if (!state.settings.first_run_completed || !state.settings.language) {
    state.startupFlow = "language";
    render();
    return;
  }
  if (state.settings.show_startup_check_on_launch !== false) {
    await runStartupCheck();
  } else {
    await refreshConnection();
    state.startupFlow = "done";
  }
  await loadCollections();
  await loadTarget();
  render();
}

async function waitForBridge(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!bridge() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Boolean(bridge());
}

async function bootWhenBridgeReady() {
  if (state.bridgeReady || bootPromise) return;
  bootPromise = (async () => {
    await waitForBridge();
    await boot();
  })();
  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
}

async function refreshConnection() {
  return refreshConnectionState();
}

async function refreshConnectionState(options = {}) {
  const wasLost = state.connection.status === "lost";
  state.connection = checkingConnectionState();
  if (!options.quiet) setStatus(t("connection.checking", "Checking Proxmark3 connection ..."));
  render();
  try {
    const connection = await callBridge("refresh_connection");
    if (options.deferDisconnected && !connection.connected) {
      return connection;
    }
    state.connection = connection;
    setStatus(state.connection.connected ? t("app.ready", "Ready") : state.connection);
    if (state.connection.connected) {
      // Unblock startup error screen so the user can continue
      if (state.startupFlow === "antenna-error" || state.startupFlow === "notFound") {
        state.startupFlow = "antenna-ready";
      }
      // After a mid-session reconnect, force a full re-render of the current
      // screen so any static disabled states (buttons, notes) get cleared
      if (wasLost) {
        renderedScreenKey = "";
      }
    }
  } catch (error) {
    const failedConnection = { status: "disconnected", connected: false, message: error.message };
    if (options.deferDisconnected) return failedConnection;
    state.connection = failedConnection;
    setStatus(error.message);
  }
  render();
  return state.connection;
}

async function runStartupCheck() {
  state.startupFlow = "checking";
  state.startupChecked = false;
  state.antennaOperation = null;
  state.connection = checkingConnectionState();
  setStatus(t("connection.checking", "Checking Proxmark3 connection ..."));
  render();
  let connection = await refreshConnectionState({ deferDisconnected: true, quiet: true });
  if (!connection.connected) {
    await delay(STARTUP_CONNECTION_RETRY_MS);
    connection = await refreshConnectionState({ deferDisconnected: true, quiet: true });
  }
  state.connection = connection;
  state.startupChecked = true;
  if (state.connection.connected) {
    state.startupFlow = "antenna-ready";
    setStatus(t("connection.deviceConnected", "Device connected"));
  } else {
    state.startupFlow = "notFound";
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

async function refreshComparison(options = {}) {
  const requestId = ++comparisonRequestSeq;
  if (!state.currentChip || !state.target) {
    state.comparison = null;
    state.comparisonLoading = false;
    return;
  }
  const requestTargetKey = targetStateKey();
  state.comparison = null;
  state.comparisonLoading = true;
  if (options.renderLoading) render();
  let response;
  try {
    response = await callBridge("compare_current_to_target");
  } catch (error) {
    if (requestId === comparisonRequestSeq && requestTargetKey === targetStateKey()) {
      state.comparison = null;
      state.comparisonLoading = false;
      if (options.renderResult) render();
    }
    throw error;
  }
  if (requestId !== comparisonRequestSeq || requestTargetKey !== targetStateKey()) {
    return;
  }
  state.comparison = response.ok ? response.comparison : null;
  state.comparisonLoading = false;
  if (options.renderResult) render();
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

async function keepCurrentScanBackupStepVisible(operation) {
  if (!operationHasProgressKey(operation, "operation.backupSaving")) return;
  await delay(WRITE_SCAN_BACKUP_STEP_MIN_MS);
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
      state.readOperation = null;
      setStatus(operation.result?.confirmed ? t("read.completedConfirmed", "Read bestätigt") : uiMessage(operation.result || operation, "operation.completed"));
    } else {
      state.readOperation = null;
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
  comparisonRequestSeq += 1;
  state.comparison = null;
  state.comparisonLoading = false;
  state.completedActions = {};
  state.failedRegionId = null;
  state.currentScanOperation = { operation_id: "pending", state: "queued", message_key: "operation.currentChipReading", progress: ["Starting scan ..."], progress_keys: ["operation.scanStarting"] };
  setStatus(t("operation.currentChipReading", "Current chip is being read ..."));
  render();
  const response = await callBridge("start_current_chip_scan");
  state.currentScanOperation = { operation_id: response.operation_id, state: "queued", message_key: "operation.currentChipReading", progress: [] };
  pollOperation(response.operation_id, "currentScanOperation", async (operation) => {
    if (operation.state === "succeeded") {
      await keepCurrentScanBackupStepVisible(operation);
      state.currentChip = operation.result.chip;
      state.currentBackup = operation.result.backup;
      await loadCollections();
      await refreshComparison();
      state.currentScanOperation = null;
      setStatus(t("write.currentChipReady", "Zielchip gelesen"));
    } else {
      state.currentScanOperation = null;
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
    comparisonRequestSeq += 1;
    state.comparison = null;
    state.comparisonLoading = false;
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
    comparisonRequestSeq += 1;
    state.comparison = null;
    state.comparisonLoading = false;
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
        }, STARTUP_ANTENNA_RESULT_MS);
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
  showToast(uiMessage(response, "template.saved"), { variant: "success" });
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
  const selectionId = ++targetSelectionSeq;
  const previousTarget = state.target;
  const previousComparison = state.comparison;
  const previousLoading = state.comparisonLoading;
  const preview = templateTargetPreview(templateId);
  if (preview) {
    state.target = preview;
    resetComparisonForTargetChange({ loading: Boolean(state.currentChip) });
    render();
  }
  const response = await callBridge("set_target_template", templateId);
  if (selectionId !== targetSelectionSeq) return;
  if (!response.ok) {
    state.target = previousTarget;
    state.comparison = previousComparison;
    state.comparisonLoading = previousLoading;
    render();
    showToast(uiMessage(response));
    return;
  }
  state.target = response.target;
  resetComparisonForTargetChange({ loading: Boolean(state.currentChip) });
  render();
  await refreshComparison({ renderLoading: true, renderResult: true });
  if (selectionId !== targetSelectionSeq) return;
  closeModal();
  setActiveView("write");
  setTransientStatus(t("template.usedAsTarget", "Template used as target state"));
}

async function useBackupTarget(backupId) {
  const selectionId = ++targetSelectionSeq;
  const previousTarget = state.target;
  const previousComparison = state.comparison;
  const previousLoading = state.comparisonLoading;
  const preview = backupTargetPreview(backupId);
  if (preview) {
    state.target = preview;
    resetComparisonForTargetChange({ loading: Boolean(state.currentChip) });
    render();
  }
  const response = await callBridge("use_backup_as_target", backupId);
  if (selectionId !== targetSelectionSeq) return;
  if (!response.ok) {
    state.target = previousTarget;
    state.comparison = previousComparison;
    state.comparisonLoading = previousLoading;
    render();
    showToast(uiMessage(response));
    return;
  }
  state.target = response.target;
  resetComparisonForTargetChange({ loading: Boolean(state.currentChip) });
  render();
  await refreshComparison({ renderLoading: true, renderResult: true });
  if (selectionId !== targetSelectionSeq) return;
  closeModal();
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

function modalShell({ title, body, footer = "", labelledBy = "modalTitle", wide = false }) {
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box ${wide ? "is-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(labelledBy)}">
        <div class="modal-head">
          <div class="modal-title" id="${escapeHtml(labelledBy)}">${escapeHtml(title)}</div>
          <button class="modal-close" type="button" data-close-modal aria-label="${escapeHtml(t("action.close", "Schließen"))}">×</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
      </div>
    </div>`;
}

function modalButton(label, attrs = "", tone = "ghost") {
  const cls = tone === "danger" ? "btn" : tone === "warn" ? "btn btn-warn" : tone === "primary" ? "btn btn-primary" : "btn btn-ghost";
  const style = tone === "danger" ? "background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#EF4444;" : "";
  return `<button class="${cls}" type="button" ${attrs} style="${style}">${escapeHtml(label)}</button>`;
}

function modalChipPreview(chip, options = {}) {
  const stroke = options.stroke || "rgba(59,130,246,.66)";
  const size = options.size || 32;
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#111D30;border:1px solid #1E3050;border-radius:9px;">
      ${CHIP_SVG({ size, id: options.id || "modal-chip", stroke, pinStroke: stroke.replace(".66", ".28") })}
      <div style="min-width:0;">
        <div style="font-size:12.5px;font-weight:700;color:#F1F5F9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(chip?.technology || options.title || t("chip.generic", "Chip"))}</div>
        <div style="font-size:10.5px;color:#4A6080;font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(chipDisplayLine(chip || {}) || options.meta || "")}</div>
      </div>
    </div>`;
}

function modalTextField({ id, name, label, value = "", textarea = false, required = false }) {
  const inputStyle = "width:100%;padding:8px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-family:inherit;font-size:13px;";
  return `
    <label style="display:flex;flex-direction:column;gap:5px;">
      <span style="font-size:11px;color:#4A6080;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(label)}</span>
      ${textarea
        ? `<textarea id="${escapeHtml(id)}" name="${escapeHtml(name)}" ${required ? "required" : ""} style="${inputStyle}resize:vertical;min-height:64px;">${escapeHtml(value)}</textarea>`
        : `<input id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" autocomplete="off" ${required ? "required" : ""} style="${inputStyle}" />`}
    </label>`;
}

function metadataRows(rows) {
  return rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;gap:14px;padding:6px 8px;background:#111D30;border-radius:6px;font-size:11.5px;">
      <span style="color:#4A6080;">${escapeHtml(label)}</span>
      <span style="color:#CBD5E1;font-family:var(--mono);text-align:right;word-break:break-all;">${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function modalWarningCopy(itemLabel, details = "") {
  return `
    <div class="modal-info is-danger">
      <div style="font-size:13px;font-weight:700;color:#F1F5F9;">${escapeHtml(itemLabel)}</div>
      ${details ? `<div style="font-size:11.5px;color:#4A6080;margin-top:4px;">${escapeHtml(details)}</div>` : ""}
    </div>
    <div style="margin-top:12px;font-size:12.5px;line-height:1.55;color:#EF4444;">${escapeHtml(t("warning.notReversible", "Diese Aktion kann nicht rückgängig gemacht werden."))}</div>`;
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
  const formId = "saveTemplateForm";
  modalRoot.innerHTML = modalShell({
    title: t("template.saveTitle", "Vorlage speichern"),
    labelledBy: "saveTitle",
    body: `
      <form id="${formId}" style="display:flex;flex-direction:column;gap:14px;" data-save-template-form>
        ${modalChipPreview(chip, { id: "save-template-chip", stroke: "rgba(59,130,246,.66)" })}
        ${modalTextField({ id: "templateName", name: "name", label: t("field.name", "Name"), value: defaultName, required: true })}
        ${modalTextField({ id: "templateDescription", name: "description", label: t("field.description", "Beschreibung"), textarea: true })}
        ${modalTextField({ id: "templateCategory", name: "category", label: t("template.categoryNote", "Kategorie / Notiz") })}
      </form>
    `,
    footer: `${modalButton(t("action.cancel", "Abbrechen"), "data-close-modal", "ghost")}<button class="btn btn-primary" type="submit" form="${formId}">${escapeHtml(t("action.save", "Speichern"))}</button>`,
  });
  modalRoot.querySelector("input")?.focus();
}

function openEditTemplateModal(templateId) {
  clearPopover();
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  state.activeModal = { type: "editTemplate", id: templateId };
  modalRoot.hidden = false;
  const formId = "editTemplateForm";
  modalRoot.innerHTML = modalShell({
    title: t("template.editTitle", "Vorlage bearbeiten"),
    labelledBy: "editTitle",
    body: `
      <form id="${formId}" style="display:flex;flex-direction:column;gap:14px;" data-edit-template-form data-template-id="${escapeHtml(template.id)}">
        ${modalChipPreview(template.chip, { id: `edit-${template.id}`, stroke: "rgba(59,130,246,.66)", meta: template.uid || "" })}
        ${modalTextField({ id: "editName", name: "name", label: t("field.name", "Name"), value: template.name, required: true })}
        ${modalTextField({ id: "editDescription", name: "description", label: t("field.description", "Beschreibung"), value: template.description || "", textarea: true })}
        ${modalTextField({ id: "editCategory", name: "category", label: t("template.categoryNote", "Kategorie / Notiz"), value: template.category || "" })}
      </form>
    `,
    footer: `${modalButton(t("action.cancel", "Abbrechen"), "data-close-modal", "ghost")}<button class="btn btn-primary" type="submit" form="${formId}">${escapeHtml(t("action.update", "Aktualisieren"))}</button>`,
  });
  modalRoot.querySelector("input")?.focus();
}

function openConfirmDeleteTemplate(templateId) {
  clearPopover();
  const template = state.templates.find((item) => item.id === templateId);
  state.activeModal = { type: "deleteTemplate", id: templateId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = modalShell({
    title: t("template.confirmDelete", "Vorlage löschen?"),
    labelledBy: "deleteTemplateTitle",
    body: modalWarningCopy(template?.name || t("template.unknown", "Unbekannte Vorlage"), [template?.technology, template?.uid].filter(Boolean).join(" · ")),
    footer: `${modalButton(t("action.cancel", "Abbrechen"), "data-close-modal", "ghost")}${modalButton(t("action.delete", "Löschen"), `data-confirm-delete-template="${escapeHtml(templateId)}"`, "danger")}`,
  });
}

function openConfirmDeleteBackup(backupId) {
  clearPopover();
  const backup = state.backups.find((item) => item.id === backupId);
  state.activeModal = { type: "deleteBackup", id: backupId };
  modalRoot.hidden = false;
  modalRoot.innerHTML = modalShell({
    title: t("backup.confirmDelete", "Backup löschen?"),
    labelledBy: "deleteBackupTitle",
    body: modalWarningCopy(backup?.technology || t("backup.unknown", "Unbekanntes Backup"), [backup?.created_display, backup?.uid].filter(Boolean).join(" · ")),
    footer: `${modalButton(t("action.cancel", "Abbrechen"), "data-close-modal", "ghost")}${modalButton(t("action.delete", "Löschen"), `data-confirm-delete-backup="${escapeHtml(backupId)}"`, "danger")}`,
  });
}

function openBackupDetails(backupId) {
  clearPopover();
  const backup = state.backups.find((item) => item.id === backupId);
  if (!backup) return;
  state.activeModal = { type: "backupDetails", id: backupId };
  const chip = backup.chip || {};
  const p4 = (chip.memoryRegions || []).find((region) => regionPage(region) === 4);
  modalRoot.hidden = false;
  modalRoot.innerHTML = modalShell({
    title: t("backup.detailsTitle", "Backup-Details"),
    labelledBy: "backupDetailsTitle",
    wide: true,
    body: `
      <div style="display:grid;grid-template-columns:150px 1fr;gap:18px;align-items:start;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
          ${CHIP_SVG({ size: 72, id: `detail-${backup.id}`, stroke: String(backup.frequency || "").toLowerCase().includes("hf") ? "rgba(129,140,248,.66)" : "rgba(59,130,246,.66)" })}
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">${(chip.memoryRegions || []).slice(0, 8).map((region) => `<span style="width:24px;height:10px;border-radius:3px;background:${regionPage(region) === 0 ? "#1E3050" : "rgba(59,130,246,.35)"};"></span>`).join("")}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${metadataRows([
            [t("chip.type", "Tech"), backup.technology],
            [t("chip.frequency", "Freq"), backupFrequencyLabel(backup)],
            ["UID", backup.uid],
            ["CFG", chip.config],
            ["P4", p4?.value],
            [t("label.source", "Quelle"), backup.source || "PM3 Reader"],
          ])}
        </div>
      </div>
    `,
    footer: `${modalButton(t("action.close", "Schließen"), "data-close-modal", "ghost")}${modalButton(t("write.useAsTarget", "Als Zielzustand"), `data-use-backup-target="${escapeHtml(backupId)}"`, "warn")}`,
  });
}

function closeModal() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
  state.activeModal = null;
}

function rerenderActiveModal() {
  const modal = state.activeModal;
  if (!modal) return;
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
  state.activeModal = null;
  if (modal.type === "saveTemplate") openSaveTemplateModal();
  if (modal.type === "editTemplate") openEditTemplateModal(modal.id);
  if (modal.type === "deleteTemplate") openConfirmDeleteTemplate(modal.id);
  if (modal.type === "deleteBackup") openConfirmDeleteBackup(modal.id);
  if (modal.type === "backupDetails") openBackupDetails(modal.id);
  if (modal.type === "help") openHelpModal(modal.topic);
  if (modal.type === "settings") openSettingsModal();
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

function helpTopicEntries() {
  return [
    ["notDetected", t("help.notDetected.title", "Chip nicht erkannt")],
    ["readFails", t("help.readFails.title", "Lesen schlägt fehl")],
    ["signalUnstable", t("help.signalUnstable.title", "Signal instabil")],
    ["antennaFails", t("help.antennaFails.title", "Antennentest fehlgeschlagen")],
    ["saveFails", t("help.saveFails.title", "Vorlage kann nicht gespeichert werden")],
    ["writeVerifyFails", t("help.writeVerifyFails.title", "Schreiben fehlgeschlagen")],
  ];
}

function resolveHelpTopic(topic) {
  const validTopics = helpTopicEntries().map(([key]) => key);
  return validTopics.includes(topic) ? topic : validTopics[0];
}

function renderHelpTopicList(key) {
  return helpTopicEntries().map(([topicKey, label]) => `
    <button type="button" data-help-topic="${escapeHtml(topicKey)}" style="padding:7px 10px;border-radius:7px;text-align:left;background:${topicKey === key ? "rgba(59,130,246,.12)" : "transparent"};border:1px solid ${topicKey === key ? "rgba(59,130,246,.28)" : "transparent"};color:${topicKey === key ? "#3B82F6" : "#4A6080"};font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">${escapeHtml(label)}</button>
  `).join("");
}

function renderHelpTopicContent(key) {
  return `
    <div style="font-size:13px;font-weight:700;color:#F1F5F9;margin-bottom:9px;">${escapeHtml(t(`help.${key}.title`, "Hilfe"))}</div>
    <div style="font-size:12px;color:#4A6080;line-height:1.7;">${escapeHtml(t(`help.${key}.body`, ""))}</div>
    <div style="margin-top:12px;padding:10px 12px;background:#111D30;border-radius:8px;border:1px solid #1E3050;">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:6px;">${escapeHtml(t("help.tips", "Tipps"))}</div>
      <div style="font-size:11.5px;color:#CBD5E1;line-height:1.7;">${escapeHtml(t(`help.${key}.tips`, t("help.defaultTips", "PM3 neu verbinden. Chipposition prüfen. Danach den betroffenen Workflow erneut starten.")))}</div>
    </div>`;
}

function renderHelpModalBody(key) {
  return `
    <div data-help-modal style="display:grid;grid-template-columns:160px 1fr;gap:16px;max-height:360px;">
      <div data-help-topic-list style="display:flex;flex-direction:column;gap:2px;">${renderHelpTopicList(key)}</div>
      <div data-help-topic-content style="overflow-y:auto;">${renderHelpTopicContent(key)}</div>
    </div>`;
}

function replaceModalHtml(selector, html) {
  const element = modalRoot.querySelector(selector);
  if (element && element.dataset.html !== html) {
    element.dataset.html = html;
    element.innerHTML = html;
  }
}

function updateHelpModalTopic(topic) {
  const key = resolveHelpTopic(topic);
  state.helpTopic = key;
  state.activeModal = { type: "help", topic: key };
  if (modalRoot.hidden || !modalRoot.querySelector("[data-help-modal]")) return false;
  replaceModalHtml("[data-help-topic-list]", renderHelpTopicList(key));
  replaceModalHtml("[data-help-topic-content]", renderHelpTopicContent(key));
  return true;
}

function openHelpModal(topic) {
  const key = resolveHelpTopic(topic);
  if (state.activeModal?.type === "help" && updateHelpModalTopic(key)) return;
  state.helpTopic = key;
  state.activeModal = { type: "help", topic: key };
  modalRoot.hidden = false;
  modalRoot.innerHTML = modalShell({
    title: t("dialogs.help", "Hilfe"),
    labelledBy: "helpTitle",
    wide: true,
    body: renderHelpModalBody(key),
    footer: modalButton(t("action.close", "Schließen"), "data-close-modal", "ghost"),
  });
}

function openSettingsModal() {
  clearPopover();
  state.activeModal = { type: "settings" };
  const pm3Path = state.settings?.last_known_pm3_path || "";
  modalRoot.hidden = false;
  modalRoot.innerHTML = modalShell({
    title: t("settings.title", "Einstellungen"),
    labelledBy: "settingsTitle",
    body: `
      <div style="display:flex;flex-direction:column;gap:18px;">
        <section>
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("settings.general", "Allgemein"))}</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
              <div>
                <div style="font-size:13px;color:#F1F5F9;">${escapeHtml(t("language.label", "Sprache"))}</div>
                <div style="font-size:11px;color:#4A6080;">${escapeHtml(t("settings.languageHint", "Oberflächensprache"))}</div>
              </div>
              <select data-language-select style="padding:6px 10px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#CBD5E1;font-size:12.5px;">
                <option value="de" ${state.language === "de" ? "selected" : ""}>Deutsch</option>
                <option value="en" ${state.language === "en" ? "selected" : ""}>English</option>
              </select>
            </div>
            <div style="height:1px;background:#1E3050;"></div>
            <label style="display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;">
              <div>
                <div style="font-size:13px;color:#F1F5F9;">${escapeHtml(t("settings.startupAntenna", "Antennentest beim Start"))}</div>
                <div style="font-size:11px;color:#4A6080;">${escapeHtml(t("settings.startupAntennaHint", "Automatisch bei jedem Start"))}</div>
              </div>
              <input type="checkbox" data-startup-on-launch ${state.settings.show_startup_check_on_launch !== false ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none;" />
              <span style="width:38px;height:22px;border-radius:11px;background:${state.settings.show_startup_check_on_launch !== false ? "rgba(59,130,246,.3)" : "#111D30"};border:1px solid ${state.settings.show_startup_check_on_launch !== false ? "rgba(59,130,246,.5)" : "#1E3050"};position:relative;display:inline-block;">
                <span style="position:absolute;top:3px;${state.settings.show_startup_check_on_launch !== false ? "right:3px" : "left:3px"};width:16px;height:16px;border-radius:50%;background:${state.settings.show_startup_check_on_launch !== false ? "#3B82F6" : "#4A6080"};"></span>
              </span>
            </label>
          </div>
        </section>
        <section>
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#4A6080;margin-bottom:8px;">${escapeHtml(t("settings.connection", "Verbindung"))}</div>
          <label style="display:flex;flex-direction:column;gap:5px;">
            <span style="font-size:11px;color:#4A6080;">${escapeHtml(t("settings.pm3Path", "PM3-Gerätepfad"))}</span>
            <input type="text" value="${escapeHtml(pm3Path)}" data-pm3-path-input placeholder="${escapeHtml(t("settings.pm3PathPlaceholder", "z.B. C:\\Tools\\proxmark3\\client"))}" style="width:100%;padding:8px 12px;background:#111D30;border:1px solid #1E3050;border-radius:7px;color:#F1F5F9;font-size:12.5px;font-family:var(--mono);" />
          </label>
        </section>
        <div style="padding:10px 12px;background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.2);border-radius:9px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <img src="${escapeHtml(GITHUB_PROFILE.avatarUrl)}" alt="${escapeHtml(GITHUB_PROFILE.login)}" referrerpolicy="no-referrer"
              style="width:36px;height:36px;border-radius:9px;object-fit:cover;border:1px solid rgba(59,130,246,.35);background:#111D30;flex-shrink:0;" />
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#3B82F6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">PM3 Studio v1.0.0 · ${escapeHtml(GITHUB_PROFILE.name)}</div>
              <div style="font-size:11px;color:#4A6080;font-family:var(--mono);">@${escapeHtml(GITHUB_PROFILE.login)}</div>
            </div>
          </div>
          <a href="${escapeHtml(GITHUB_PROFILE.url)}" target="_blank" rel="noreferrer" style="font-size:11.5px;color:#3B82F6;text-decoration:none;flex-shrink:0;">GitHub →</a>
        </div>
      </div>
    `,
    footer: `${modalButton(t("action.cancel", "Abbrechen"), "data-close-modal", "ghost")}${modalButton(t("action.save", "Speichern"), "data-save-pm3-path", "primary")}`,
  });
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

function renderToasts() {
  if (!state.toasts.length) {
    toastRoot.hidden = true;
    toastRoot.innerHTML = "";
    return;
  }
  toastRoot.hidden = false;
  toastRoot.innerHTML = `
    <div class="toast-list">
      ${state.toasts.slice(0, 3).map((toast) => {
        const variant = toast.variant || "info";
        const icon = variant === "success" ? "✓" : variant === "error" ? "!" : "i";
        return `<div class="toast is-${escapeHtml(variant)}" role="status">
          <div class="toast-icon">${escapeHtml(icon)}</div>
          <div>
            <div class="toast-title">${escapeHtml(toast.title)}</div>
            ${toast.subtext ? `<div class="toast-sub">${escapeHtml(toast.subtext)}</div>` : ""}
          </div>
          <button class="toast-close" type="button" data-dismiss-toast="${escapeHtml(toast.id)}" aria-label="${escapeHtml(t("action.close", "Schließen"))}">×</button>
        </div>`;
      }).join("")}
    </div>`;
}

function dismissToast(id) {
  state.toasts = state.toasts.filter((toast) => toast.id !== id);
  renderToasts();
}

function showToast(message, options = {}) {
  const title = typeof message === "string" ? message : uiMessage(message);
  const variant = options.variant || "info";
  const subtext = options.subtext || "";
  const now = Date.now();
  const duplicate = state.toasts.find((toast) => (
    toast.title === title
    && toast.variant === variant
    && toast.subtext === subtext
    && now - (toast.createdAt || 0) < 1500
  ));
  if (duplicate) {
    duplicate.createdAt = now;
    renderToasts();
    return duplicate.id;
  }
  const id = `toast_${now}_${Math.random().toString(16).slice(2)}`;
  state.toasts = [{ id, title, variant, subtext, createdAt: now }, ...state.toasts].slice(0, 3);
  renderToasts();
  window.setTimeout(() => dismissToast(id), options.timeout || 4000);
  return id;
}

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;

  const navButton = target.closest("[data-view]");
  if (navButton) {
    setActiveView(navButton.dataset.view);
    return;
  }

  if (target.matches("[data-modal-backdrop]")) {
    closeModal();
    return;
  }

  const dismissToastBtn = target.closest("[data-dismiss-toast]");
  if (dismissToastBtn) {
    dismissToast(dismissToastBtn.dataset.dismissToast);
    return;
  }

  const helpTopicBtn = target.closest("[data-help-topic]");
  if (helpTopicBtn) {
    updateHelpModalTopic(helpTopicBtn.dataset.helpTopic);
    return;
  }

  const openHelpBtn = target.closest("[data-open-help]");
  if (openHelpBtn) {
    openHelpModal(openHelpBtn.dataset.openHelp || state.helpTopic);
    return;
  }

  if (target.closest("[data-exit-app]")) {
    showToast(t("bridgeMissing.exitUnavailable", "App-Beenden ist in dieser Ansicht nicht verfügbar."), { variant: "error" });
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
      if (state.bridgeReady && !state.settings.first_run_completed) {
        const response = await callBridge("complete_first_run");
        state.settings = response.settings || state.settings;
      }
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
  const startCompareBtn = target.closest("[data-start-compare]");
  if (startCompareBtn) {
    const select = appView.querySelector("[data-write-template-select]");
    const templateId = select?.value || "";
    if (!templateId) {
      showToast(t("write.chooseTemplate", "Vorlage auswählen"));
      return;
    }
    await useTemplateTarget(templateId);
    return;
  }
  if (target.closest("[data-write-back]")) {
    state.target = null;
    comparisonRequestSeq += 1;
    state.comparison = null;
    state.comparisonLoading = false;
    state.writeShowDetails = false;
    render();
    return;
  }
  if (target.closest("[data-write-details]")) {
    state.writeShowDetails = !state.writeShowDetails;
    render();
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
  if (target.closest("[data-settings-toggle]") || target.closest("[data-open-settings]")) {
    if (settingsPanel) settingsPanel.hidden = true;
    try {
      const res = await callBridge("get_pm3_path");
      if (res?.path) state.settings.last_known_pm3_path = res.path;
    } catch {
      // Keep the last persisted path when the bridge is unavailable.
    }
    openSettingsModal();
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
  if (target.closest("[data-import-backups]")) {
    showToast(t("backup.importUnavailable", "Backup-Import ist noch nicht angebunden."), {
      variant: "info",
      subtext: t("backup.importUnavailableBody", "Bestehende Backups werden automatisch aus dem lokalen Storage geladen."),
    });
    return;
  }
  if (target.closest("[data-save-pm3-path]")) {
    const pathInput = modalRoot.querySelector("[data-pm3-path-input]") || settingsPanel?.querySelector("[data-pm3-path-input]");
    const newPath = pathInput?.value?.trim() || "";
    if (!newPath) { showToast(t("settings.pathRequired", "Bitte einen Pfad eingeben.")); return; }
    try {
      const res = await callBridge("update_pm3_path", { path: newPath });
      if (res?.ok) {
        showToast(t("settings.pathSavedChecking", "Pfad gespeichert. Verbindung wird geprüft ..."));
        if (settingsPanel) settingsPanel.hidden = true;
        closeModal();
        await refreshConnection();
        render();
      } else {
        showToast(res?.message || t("settings.pathSaveFailed", "Pfad konnte nicht gespeichert werden."));
      }
    } catch (err) {
      showToast(err.message || t("settings.pathSaveError", "Fehler beim Speichern des Pfads."));
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
    if (state.activeModal?.type === "settings") openSettingsModal();
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
      comparisonRequestSeq += 1;
      state.comparison = null;
      state.comparisonLoading = false;
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
    if (event.target.dataset.submitting === "true") return;
    event.target.dataset.submitting = "true";
    try {
      await saveTemplate(event.target);
    } finally {
      delete event.target.dataset.submitting;
    }
    return;
  }
  if (event.target.matches("[data-edit-template-form]")) {
    event.preventDefault();
    if (event.target.dataset.submitting === "true") return;
    event.target.dataset.submitting = "true";
    try {
      await updateTemplate(event.target);
    } finally {
      delete event.target.dataset.submitting;
    }
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
  bootWhenBridgeReady,
  applyInitialConnection(connection) {
    state.bridgeReady = true;
    state.connection = connection || state.connection;
    if (!connection) {
      render();
      return;
    }
    if (!connection.connected && !state.startupChecked && STARTUP_FLOW_STATES.has(state.startupFlow)) {
      state.connection = checkingConnectionState();
      renderedScreenKey = "";
      render();
      return;
    }
    if (state.connection.connected && STARTUP_FLOW_STATES.has(state.startupFlow) && state.startupFlow !== "language") {
      state.startupFlow = "antenna-ready";
    } else if (!state.connection.connected && STARTUP_FLOW_STATES.has(state.startupFlow)) {
      state.startupFlow = "notFound";
    }
    renderedScreenKey = "";
    render();
  },
};

loadLocale(state.language).then(() => {
  applyStaticTranslations();
  renderedScreenKey = "";
  render();
}).catch(() => {
  // Keep built-in fallback strings if the static locale request is unavailable.
});

window.addEventListener("pywebviewready", bootWhenBridgeReady, { once: true });
window.setTimeout(bootWhenBridgeReady, 50);

render();
