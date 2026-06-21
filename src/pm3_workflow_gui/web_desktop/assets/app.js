const appView = document.getElementById("appView");
const statusText = document.getElementById("statusText");
const deviceStatus = document.getElementById("deviceStatus");
const modalRoot = document.getElementById("modalRoot");
const toastRoot = document.getElementById("toastRoot");
const settingsPanel = document.querySelector("[data-settings-panel]");

const TERMINAL_STATES = new Set(["succeeded", "failed", "verification_failed", "connection_lost"]);

const state = {
  activeView: "read",
  readMode: "auto",
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

function setStatus(message) {
  statusText.textContent = message || "Bereit";
}

function renderHeader() {
  const connection = state.connection;
  deviceStatus.classList.toggle("is-checking", connection.status === "checking");
  deviceStatus.classList.toggle("is-offline", !connection.connected && connection.status !== "checking");
  deviceStatus.classList.toggle("is-lost", connection.status === "lost");
  if (connection.connected) {
    deviceStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span>PM3 verbunden · ${escapeHtml(connection.port || "auto")} · ${escapeHtml(connection.target || "PM3")}`;
    return;
  }
  const text = connection.status === "lost" ? "Verbindung verloren" : connection.status === "checking" ? "Verbindung wird geprüft ..." : "Kein Proxmark erkannt";
  deviceStatus.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${escapeHtml(text)}`;
}

function render() {
  renderHeader();
  clearPopover();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });
  if (!state.bridgeReady) {
    appView.innerHTML = renderBridgeMissing();
    return;
  }
  if (state.activeView === "read") appView.innerHTML = renderReadView();
  if (state.activeView === "write") appView.innerHTML = renderWriteView();
  if (state.activeView === "templates") appView.innerHTML = renderTemplatesView();
  if (state.activeView === "backups") appView.innerHTML = renderBackupsView();
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

function renderReadView() {
  if (state.readOperation && !TERMINAL_STATES.has(state.readOperation.state)) return renderReadScanning();
  if (state.lastScan?.status === "signal_unstable") return renderReadUnstable();
  if (state.lastScan?.chip) return renderReadResult();
  return renderReadStart();
}

function renderReadStart() {
  const connected = state.connection.connected;
  return `
    <section class="screen" aria-labelledby="readTitle">
      <div class="empty-start">
        <div class="scan-card">
          <div class="scan-icon" aria-hidden="true"></div>
          <h1 id="readTitle">Chip lesen</h1>
          <p>Erstelle eine geprüfte Vorlage aus einem RFID- oder NFC-Chip.</p>
          <div class="segmented" role="tablist" aria-label="Scan-Frequenz">
            ${["auto", "lf", "hf"].map((mode) => `
              <button class="segment ${state.readMode === mode ? "is-active" : ""}" type="button" data-read-mode="${mode}">
                ${mode.toUpperCase()}
              </button>
            `).join("")}
          </div>
          <div class="scan-actions">
            <button class="button" type="button" data-read-scan ${connected ? "" : "disabled"}>Chip scannen</button>
            ${connected ? "" : `<button class="button button-secondary" type="button" data-refresh-connection>Verbindung erneut prüfen</button>`}
          </div>
          ${connected ? "" : `<p>${escapeHtml(state.connection.message || "Bitte PM3 verbinden und erneut prüfen.")}</p>`}
        </div>
      </div>
    </section>
  `;
}

function renderReadScanning() {
  const operation = state.readOperation;
  const progress = operation?.progress?.length ? operation.progress : [operation?.message || "Operation läuft ..."];
  return `
    <section class="screen" aria-labelledby="scanTitle">
      <div class="scan-state">
        <div class="scan-visual" aria-hidden="true">
          <div class="antenna"><div class="chip-mini"></div></div>
        </div>
        <div>
          <h1 id="scanTitle">Chip wird gelesen</h1>
          <p class="screen-subtitle">Statuswechsel kommen aus dem Python-OperationManager.</p>
          <div class="scan-step-list">
            ${progress.map((step, index) => `
              <div class="scan-step ${index < progress.length - 1 ? "is-done" : "is-active"}">
                <span class="step-bullet">${index < progress.length - 1 ? "✓" : index + 1}</span>
                <span>${escapeHtml(step)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
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
            <span>${escapeHtml(state.lastScan.message || "Das Signal reicht noch nicht für eine sichere Vorlage.")}</span>
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
  const scan = state.lastScan;
  const chip = scan.chip;
  const subtitle = scan.confirmed
    ? `${chip.frequency || ""} · stabil gelesen · zweiter Scan bestätigt`
    : `${chip.frequency || ""} · ${scan.message || "nicht als Vorlage bestätigt"}`;
  return `
    <section class="screen" aria-labelledby="resultTitle">
      <div class="result-summary">
        <div>
          <h1 id="resultTitle" class="screen-title">${escapeHtml(chip.technology || scan.title)}</h1>
          <p class="screen-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="result-actions">
          <button class="info-button" type="button" data-info-chip="lastScan" aria-label="Details anzeigen">i</button>
          <button class="button" type="button" data-open-save-template ${scan.canSave ? "" : "disabled"}>Als Vorlage speichern</button>
        </div>
      </div>
      <div class="result-grid">
        <div class="panel">
          ${renderChipCard(chip, { infoKey: "lastScan" })}
        </div>
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Speicherbereiche</h2>
              <div class="meta-line">nur tatsächlich gelesene Bereiche</div>
            </div>
          </div>
          <div class="data-overview">
            ${renderDataRows(chip.memoryRegions)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderWriteView() {
  return `
    <section class="screen" aria-labelledby="writeTitle">
      <div class="screen-head">
        <div>
          <h1 id="writeTitle" class="screen-title">Schreiben</h1>
          <p class="screen-subtitle">Aktueller Chip, Änderungen und Zielzustand bleiben getrennt.</p>
        </div>
      </div>
      <div class="write-layout">
        ${renderCompatibilityBar()}
        <div class="write-columns">
          ${renderCurrentChipColumn()}
          ${renderWriteActions()}
          ${renderTargetColumn()}
        </div>
      </div>
    </section>
  `;
}

function renderCompatibilityBar() {
  if (state.comparison) {
    return `<div class="compat-bar is-${state.comparison.status === "danger" ? "danger" : "success"}">${escapeHtml(state.comparison.message)}</div>`;
  }
  if (!state.currentChip) return `<div class="compat-bar is-neutral">Aktuellen Chip scannen</div>`;
  if (!state.target) return `<div class="compat-bar is-neutral">Zielzustand auswählen</div>`;
  return `<div class="compat-bar is-neutral">Vergleich nicht verfügbar</div>`;
}

function renderCurrentChipColumn() {
  const operation = state.currentScanOperation;
  const busy = operation && !TERMINAL_STATES.has(operation.state);
  const backupText = state.currentBackup ? `Backup erstellt · ${state.currentBackup.created_display}` : "noch nicht gescannt";
  return `
    <div class="panel write-column">
      <div class="panel-header">
        <div>
          <h2>Aktueller Chip</h2>
          <div class="meta-line">${escapeHtml(backupText)}</div>
        </div>
        <button class="button button-secondary button-small" type="button" data-write-scan ${state.connection.connected && !busy ? "" : "disabled"}>
          ${busy ? "Scan läuft ..." : "Aktuellen Chip scannen"}
        </button>
      </div>
      ${state.currentChip ? renderChipCard(state.currentChip, { infoKey: "currentChip" }) : renderEmptyChip("Noch kein Chip gelesen")}
    </div>
  `;
}

function renderTargetColumn() {
  return `
    <div class="panel write-column">
      <div class="panel-header">
        <div>
          <h2>Zielzustand</h2>
          <div class="meta-line">${state.target ? escapeHtml(`Quelle: ${state.target.source}`) : "nicht ausgewählt"}</div>
        </div>
      </div>
      ${renderTargetSelector()}
      ${state.target?.chip ? renderChipCard(state.target.chip, { infoKey: "target" }) : renderEmptyChip("Zielzustand auswählen")}
    </div>
  `;
}

function renderTargetSelector() {
  const selectedTemplate = state.target?.kind === "template" ? state.target.id : "";
  return `
    <div class="target-control">
      <label class="field-label" for="targetSelect">Vorlage</label>
      <select class="target-select" id="targetSelect" data-target-select>
        <option value="">Vorlage auswählen</option>
        ${state.templates.map((template) => `
          <option value="${escapeHtml(template.id)}" ${selectedTemplate === template.id ? "selected" : ""}>${escapeHtml(template.name)}</option>
        `).join("")}
      </select>
      <button class="link-action" type="button" data-open-backup-targets>↶ Backup als Zielzustand verwenden</button>
    </div>
  `;
}

function renderWriteActions() {
  return `
    <div class="panel write-column">
      <div class="panel-header">
        <div>
          <h2>Änderungen</h2>
          <div class="meta-line">UID bleibt Referenz</div>
        </div>
      </div>
      ${renderChangeList()}
    </div>
  `;
}

function renderChangeList() {
  if (!state.currentChip) return `<div class="no-actions">Scanne zuerst den aktuellen Chip. Danach wird automatisch ein Backup erstellt, falls der Adapter den Chip vollständig lesen kann.</div>`;
  if (!state.target) return `<div class="no-actions">Wähle rechts eine Vorlage oder ein Backup als Zielzustand.</div>`;
  if (!state.comparison) return `<div class="no-actions">Vergleich konnte für diese Kombination nicht berechnet werden.</div>`;
  if (state.comparison.status === "danger") return `<div class="no-actions">Dieser Zielzustand passt nicht zum aktuellen Chip.</div>`;
  const actions = state.comparison.actions || [];
  if (!actions.length) return `<div class="no-actions">Keine schreibbaren Unterschiede vorhanden.</div>`;
  return `
    <div>
      <div class="difference-count">${escapeHtml(formatOpenCount(state.comparison.writable_difference_count))}</div>
      <div class="change-list">
        ${actions.map(renderChangeRow).join("")}
      </div>
    </div>
  `;
}

function renderChangeRow(action) {
  const operation = state.writeOperations[action.region_id];
  const running = operation && !TERMINAL_STATES.has(operation.state);
  const done = operation?.state === "succeeded";
  const failed = operation && TERMINAL_STATES.has(operation.state) && operation.state !== "succeeded";
  const status = running ? operation.message : done ? `✓ ${action.label} übernommen` : failed ? operation.message : action.reason || "";
  return `
    <div class="change-row ${running ? "is-working" : ""} ${done ? "is-done" : ""}">
      <div class="change-label">${escapeHtml(action.label)}</div>
      <div>
        <div class="change-values">
          <span>${escapeHtml(action.fromValue)}</span>
          <span aria-hidden="true">→</span>
          <span>${escapeHtml(action.toValue)}</span>
        </div>
        ${status ? `<div class="change-status">${escapeHtml(status)}</div>` : ""}
      </div>
      ${action.enabled ? `
        <button class="button button-secondary button-small" type="button" data-write-action="${escapeHtml(action.region_id)}" ${state.connection.connected && !running ? "" : "disabled"}>Übernehmen</button>
      ` : `<span class="blocked-label">Gesperrt</span>`}
    </div>
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
        <button class="button button-secondary" type="button" data-import-templates>Alte Vorlagen importieren</button>
      </div>
      <div class="management-list">
        ${state.templates.length ? state.templates.map(renderTemplateItem).join("") : `<div class="no-actions">Keine Vorlagen im Storage gefunden.</div>`}
      </div>
    </section>
  `;
}

function renderTemplateItem(template) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(template.name)}</h2>
        <div class="item-meta">${escapeHtml(template.technology)} · ${escapeHtml(template.frequency)}</div>
        <div class="item-meta">Erstellt: ${escapeHtml(template.created_display || "")}</div>
        ${template.description ? `<p>Beschreibung: ${escapeHtml(template.description)}</p>` : ""}
        ${template.category ? `<p>Kategorie / Notiz: ${escapeHtml(template.category)}</p>` : ""}
      </div>
      <div class="item-actions">
        <button class="button button-secondary button-small" type="button" data-edit-template="${escapeHtml(template.id)}">Bearbeiten</button>
        <button class="button button-secondary button-small" type="button" data-duplicate-template="${escapeHtml(template.id)}">Duplizieren</button>
        <button class="button button-secondary button-small" type="button" data-delete-template="${escapeHtml(template.id)}">Löschen</button>
        <button class="button button-small" type="button" data-use-template-target="${escapeHtml(template.id)}">Als Zielzustand verwenden</button>
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
      </div>
      <div class="management-list">
        ${state.backups.length ? state.backups.map(renderBackupItem).join("") : `<div class="no-actions">Keine Backups im Storage gefunden.</div>`}
      </div>
    </section>
  `;
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
        <button class="button button-secondary button-small" type="button" data-delete-backup="${escapeHtml(backup.id)}">Löschen</button>
      </div>
    </article>
  `;
}

function renderChipCard(chip, options = {}) {
  const regions = Array.isArray(chip.memoryRegions) ? chip.memoryRegions : [];
  return `
    <article class="chip-card">
      <div class="chip-top">
        <div>
          <h2 class="chip-name">${escapeHtml(chip.technology || "Chip erkannt")}</h2>
          ${chip.frequency ? `<span class="chip-frequency">${escapeHtml(chip.frequency)}</span>` : ""}
        </div>
        <button class="info-button" type="button" data-info-chip="${escapeHtml(options.infoKey || "")}" aria-label="Details anzeigen">i</button>
      </div>
      <div class="chip-body">
        <div class="chip-core" aria-hidden="true"><div class="chip-core-inner"></div></div>
        <div class="chip-facts">
          ${(chip.fields || []).slice(0, 4).map((field) => `
            <div class="fact">
              <span class="fact-label">${escapeHtml(field.label)}</span>
              <span class="fact-value">${escapeHtml(field.value || "")}</span>
            </div>
          `).join("")}
        </div>
      </div>
      ${regions.length ? `
        <div class="segment-block">
          <div class="segment-title">Speichersegmente</div>
          <div class="memory-segments" aria-label="Speichersegmente">
            ${regions.map((region) => `<div class="memory-segment">${escapeHtml(region.value || "")}</div>`).join("")}
          </div>
        </div>
      ` : ""}
    </article>
  `;
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
  await refreshConnection();
  await loadCollections();
  await loadTarget();
  render();
}

async function refreshConnection() {
  state.connection = { status: "checking", connected: false, message: "Verbindung wird geprüft ..." };
  setStatus("Verbindung wird geprüft ...");
  render();
  try {
    state.connection = await callBridge("refresh_connection");
    setStatus(state.connection.connected ? "Bereit · Chip auflegen" : state.connection.message);
  } catch (error) {
    state.connection = { status: "disconnected", connected: false, message: error.message };
    setStatus(error.message);
  }
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

async function startReadScan() {
  if (!state.connection.connected) return;
  state.lastScan = null;
  const response = await callBridge("start_scan", state.readMode);
  state.readOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus("Scan gestartet");
  render();
  pollOperation(response.operation_id, "readOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.lastScan = operation.result;
      setStatus(operation.result?.message || operation.message);
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
  state.currentChip = null;
  state.currentBackup = null;
  state.comparison = null;
  const response = await callBridge("start_current_chip_scan");
  state.currentScanOperation = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus("Aktueller Chip wird gelesen ...");
  render();
  pollOperation(response.operation_id, "currentScanOperation", async (operation) => {
    if (operation.state === "succeeded") {
      state.currentChip = operation.result.chip;
      state.currentBackup = operation.result.backup;
      await loadCollections();
      await refreshComparison();
      setStatus(operation.result.message);
    } else {
      setStatus(operation.message);
      if (operation.state === "connection_lost") {
        state.connection = { status: "lost", connected: false, message: operation.message };
      }
    }
  });
}

async function startWriteAction(regionId) {
  const response = await callBridge("start_write_region", regionId);
  state.writeOperations[regionId] = { operation_id: response.operation_id, state: "queued", progress: [] };
  setStatus("Schreibaktion gestartet");
  render();
  pollWriteOperation(response.operation_id, regionId);
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
    const current = await callBridge("get_current_chip");
    state.currentChip = current.chip;
    state.currentBackup = current.backup;
    state.comparison = operation.result?.comparison || null;
    showToast(operation.result?.message || "Schreibaktion verifiziert");
  }
  if (operation.state === "connection_lost") {
    state.connection = { status: "lost", connected: false, message: operation.message };
  }
  setStatus(operation.message);
  render();
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
  setStatus("Vorlage gespeichert");
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
  setStatus("Vorlage aktualisiert");
  render();
}

async function useTemplateTarget(templateId) {
  const response = await callBridge("set_target_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  state.target = response.target;
  await refreshComparison();
  setStatus("Vorlage als Zielzustand verwendet");
  setActiveView("write");
}

async function useBackupTarget(backupId) {
  const response = await callBridge("use_backup_as_target", backupId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  state.target = response.target;
  await refreshComparison();
  setStatus("Backup als Zielzustand verwendet");
  setActiveView("write");
}

async function deleteTemplate(templateId) {
  const response = await callBridge("delete_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setStatus("Vorlage gelöscht");
  render();
}

async function duplicateTemplate(templateId) {
  const response = await callBridge("duplicate_template", templateId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  await loadCollections();
  setStatus("Vorlage dupliziert");
  render();
}

async function deleteBackup(backupId) {
  const response = await callBridge("delete_backup", backupId);
  if (!response.ok) {
    showToast(response.message);
    return;
  }
  await loadCollections();
  await loadTarget();
  await refreshComparison();
  setStatus("Backup gelöscht");
  render();
}

async function importTemplates() {
  const response = await callBridge("import_existing_templates");
  await loadCollections();
  showToast(response.message || "Import abgeschlossen");
  setStatus(response.message || "Import abgeschlossen");
  render();
}

function setActiveView(view) {
  clearPopover();
  state.activeView = view;
  render();
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

function closeModal() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
}

function openBackupTargetPopover(trigger) {
  clearPopover();
  const rect = trigger.getBoundingClientRect();
  const shellRect = document.querySelector("[data-app-shell]").getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover";
  popover.setAttribute("role", "dialog");
  popover.style.top = `${Math.min(rect.bottom + 8, shellRect.bottom - 250)}px`;
  popover.style.left = `${Math.max(shellRect.left + 12, Math.min(rect.left, shellRect.right - 340))}px`;
  popover.innerHTML = `
    <h3>Backup wählen</h3>
    <div class="popover-list">
      ${state.backups.length ? state.backups.map((backup) => `
        <button class="popover-option" type="button" data-use-backup-target="${escapeHtml(backup.id)}">
          <strong>${escapeHtml(backup.technology)}</strong>
          <span>${escapeHtml(backup.created_display || "")} · UID ${escapeHtml(backup.uid || "")}</span>
        </button>
      `).join("") : `<div class="no-actions">Keine Backups vorhanden.</div>`}
    </div>
  `;
  document.body.appendChild(popover);
  state.activePopover = popover;
}

function openInfoPopover(trigger) {
  clearPopover();
  const details = detailsForKey(trigger.dataset.infoChip);
  if (!details) return;
  const rect = trigger.getBoundingClientRect();
  const shellRect = document.querySelector("[data-app-shell]").getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover";
  popover.setAttribute("role", "dialog");
  popover.style.top = `${Math.min(rect.bottom + 8, shellRect.bottom - 292)}px`;
  popover.style.left = `${Math.max(shellRect.left + 12, Math.min(rect.left - 250, shellRect.right - 334))}px`;
  popover.innerHTML = `
    <h3>Details</h3>
    <div class="detail-list">
      ${Object.entries(details).map(([label, value]) => `
        <div class="detail-row">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(value)}</span>
        </div>
      `).join("")}
    </div>
  `;
  document.body.appendChild(popover);
  state.activePopover = popover;
}

function detailsForKey(key) {
  if (key === "lastScan") return state.lastScan?.chip?.details;
  if (key === "currentChip") return state.currentChip?.details;
  if (key === "target") return state.target?.chip?.details;
  return null;
}

function showStatusModal() {
  const connection = state.connection;
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pm3StatusTitle">
      <h2 id="pm3StatusTitle">PM3-Status</h2>
      <div class="detail-list">
        <div class="detail-row"><span>Status</span><span>${escapeHtml(connection.connected ? "verbunden" : connection.status)}</span></div>
        <div class="detail-row"><span>Port</span><span>${escapeHtml(connection.port || "nicht verfügbar")}</span></div>
        <div class="detail-row"><span>Gerät</span><span>${escapeHtml(connection.target || "nicht verfügbar")}</span></div>
        <div class="detail-row"><span>Client</span><span>${escapeHtml(connection.client_version || "nicht verfügbar")}</span></div>
        <div class="detail-row"><span>Meldung</span><span>${escapeHtml(connection.message || "")}</span></div>
      </div>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>Schließen</button>
      </div>
    </div>
  `;
}

function showAboutModal() {
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
      <h2 id="aboutTitle">RFID Workflow</h2>
      <p class="screen-subtitle">Lokale pywebview-Anwendung über die echte Python-PM3-Bridge. Es werden keine Demo-Hardwarezustände erzeugt.</p>
      <div class="modal-actions">
        <button class="button button-secondary" type="button" data-close-modal>Schließen</button>
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

let toastTimer = null;
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
    setStatus(`Scanmodus ${state.readMode.toUpperCase()}`);
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
    await deleteTemplate(deleteTemplateButton.dataset.deleteTemplate);
    return;
  }
  const deleteBackupButton = target.closest("[data-delete-backup]");
  if (deleteBackupButton) {
    await deleteBackup(deleteBackupButton.dataset.deleteBackup);
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

window.addEventListener("pywebviewready", boot, { once: true });
window.setTimeout(() => {
  if (!state.bridgeReady) boot();
}, 800);

render();
