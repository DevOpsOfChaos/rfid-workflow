const appView = document.getElementById("appView");
const statusText = document.getElementById("statusText");
const modalRoot = document.getElementById("modalRoot");
const toastRoot = document.getElementById("toastRoot");
const settingsPanel = document.querySelector("[data-settings-panel]");

const scanSteps = [
  "PM3 bereit",
  "Suche LF ...",
  "Chip gefunden",
  "Chiptyp wird bestimmt ...",
  "Öffentliche Daten werden gelesen ...",
  "Zweiter Scan wird geprüft ...",
  "Scan bestätigt",
];

const chipCatalog = {
  readHitag: {
    technology: "Hitag S256",
    frequency: "LF",
    uid: "83F5E494",
    config: "C92800AA",
    memoryRange: "Block 4-7",
    memoryRegions: [
      { label: "Block 4", value: "FFF80697", writable: true },
      { label: "Block 5", value: "8C66C180", writable: true },
      { label: "Block 6", value: "036EF700", writable: true },
      { label: "Block 7", value: "00000000", writable: true },
    ],
    details: {
      chipFamily: "PCF 7952",
      frequency: "LF",
      uid: "83F5E494",
      config: "C92800AA",
      dataRate: "Manchester",
      mode: "TTF",
      scannedAt: "21.06.2026 · 14:29",
      secondScan: "identisch",
    },
  },
  currentWrite: {
    technology: "Hitag S256",
    frequency: "LF",
    uid: "83F5E494",
    config: "C90000AA",
    memoryRange: "Block 4-7",
    memoryRegions: [
      { label: "Block 4", value: "F0F80690", writable: true },
      { label: "Block 5", value: "8C66C180", writable: true },
      { label: "Block 6", value: "036EF700", writable: true },
      { label: "Block 7", value: "11111111", writable: true },
    ],
    details: {
      chipFamily: "PCF 7952",
      frequency: "LF",
      uid: "83F5E494",
      config: "C90000AA",
      dataRate: "Manchester",
      mode: "TTF",
      scannedAt: "21.06.2026 · 14:32",
      secondScan: "identisch",
    },
  },
};

const state = {
  activeView: "read",
  readMode: "Auto",
  readState: "idle",
  scanIndex: -1,
  currentReadChip: null,
  currentWriteChip: null,
  targetId: "tpl-garage",
  appliedKeys: [],
  workingAction: null,
  completedActions: [],
  backupCreated: false,
  status: "Bereit · Chip auflegen",
  activePopover: null,
  pendingUndo: null,
  templates: [
    {
      id: "tpl-garage",
      name: "Garage – Master",
      description: "Zugang Garage",
      note: "Garage",
      createdDate: "21.06.2026",
      createdTime: "14:32",
      chip: {
        technology: "Hitag S256",
        frequency: "LF",
        uid: "FAF99179",
        config: "C92800AA",
        memoryRange: "Block 4-7",
        memoryRegions: [
          { label: "Block 4", value: "FFF80697", writable: true },
          { label: "Block 5", value: "8C66C181", writable: true },
          { label: "Block 6", value: "036EF700", writable: true },
          { label: "Block 7", value: "00000000", writable: true },
        ],
        details: {
          chipFamily: "PCF 7952",
          frequency: "LF",
          uid: "FAF99179",
          config: "C92800AA",
          dataRate: "Manchester",
          mode: "TTF",
          scannedAt: "18.06.2026 · 18:11",
          secondScan: "Vorlage geprüft",
        },
      },
    },
    {
      id: "tpl-workshop",
      name: "Werkstatt – Ersatzchip",
      description: "Ersatz für Werkstattzugang",
      note: "Werkstatt",
      createdDate: "20.06.2026",
      createdTime: "09:44",
      chip: {
        technology: "Hitag S256",
        frequency: "LF",
        uid: "A1C04F9E",
        config: "C92800AA",
        memoryRange: "Block 4-7",
        memoryRegions: [
          { label: "Block 4", value: "FFF80697", writable: true },
          { label: "Block 5", value: "8C66C1FF", writable: false },
          { label: "Block 6", value: "036EF700", writable: true },
          { label: "Block 7", value: "11111111", writable: true },
        ],
        details: {
          chipFamily: "PCF 7952",
          frequency: "LF",
          uid: "A1C04F9E",
          config: "C92800AA",
          dataRate: "Manchester",
          mode: "TTF",
          scannedAt: "20.06.2026 · 09:44",
          secondScan: "Vorlage geprüft",
        },
      },
    },
  ],
  backups: [
    {
      id: "backup-before-write",
      createdDate: "21.06.2026",
      createdTime: "14:32",
      source: "Vor dem Schreiben",
      chip: cloneChip(chipCatalog.currentWrite),
    },
    {
      id: "backup-hf",
      createdDate: "18.06.2026",
      createdTime: "19:07",
      source: "Archiv",
      chip: {
        technology: "MIFARE Classic",
        frequency: "HF",
        uid: "04A17C2B",
        config: "Sektorzugriff",
        memoryRange: "Sektoren",
        memoryRegions: [
          { label: "Sector 1", value: "A0A1A2A3", writable: false },
          { label: "Sector 2", value: "B0B1B2B3", writable: false },
        ],
        details: {
          chipFamily: "ISO14443A",
          frequency: "HF",
          uid: "04A17C2B",
          config: "MIFARE Classic",
          dataRate: "106 kbit/s",
          mode: "Reader",
          scannedAt: "18.06.2026 · 19:07",
          secondScan: "Backup",
        },
      },
    },
  ],
};

let scanTimer = null;
let writeTimer = null;
let toastTimer = null;
let idCounter = 1;

function cloneChip(chip) {
  return JSON.parse(JSON.stringify(chip));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003C");
}

function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function setStatus(message) {
  state.status = message;
  statusText.textContent = message;
}

function resetWriteProgress() {
  state.appliedKeys = [];
  state.workingAction = null;
  state.completedActions = [];
}

function setActiveView(view) {
  clearPopover();
  state.activeView = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  render();
  appView.focus({ preventScroll: true });
}

function render() {
  clearPopover();
  if (state.activeView === "read") appView.innerHTML = renderReadView();
  if (state.activeView === "write") appView.innerHTML = renderWriteView();
  if (state.activeView === "templates") appView.innerHTML = renderTemplatesView();
  if (state.activeView === "backups") appView.innerHTML = renderBackupsView();
}

function renderReadView() {
  if (state.readState === "scanning") return renderReadScanning();
  if (state.readState === "unstable") return renderReadUnstable();
  if (state.readState === "result") return renderReadResult();
  return `
    <section class="screen" aria-labelledby="readTitle">
      <div class="empty-start">
        <div class="scan-card">
          <div class="scan-icon" aria-hidden="true"></div>
          <h1 id="readTitle">Chip lesen</h1>
          <p>Geprüften Zustand lesen und bei Bedarf als Vorlage speichern.</p>
          <div class="segmented" role="tablist" aria-label="Scan-Frequenz">
            ${["Auto", "LF", "HF"].map((mode) => `
              <button class="segment ${state.readMode === mode ? "is-active" : ""}" type="button" data-read-mode="${mode}">
                ${mode}
              </button>
            `).join("")}
          </div>
          <div class="scan-actions">
            <button class="button" type="button" data-read-scan="success">Chip scannen</button>
            <button class="button button-quiet" type="button" data-read-scan="unstable">Signalproblem anzeigen</button>
          </div>
        </div>
      </div>
    </section>
  `;
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
          <p class="screen-subtitle">Der zweite Scan bestätigt die gelesenen Werte automatisch.</p>
          <div class="scan-step-list">
            ${scanSteps.map((step, index) => `
              <div class="scan-step ${index < state.scanIndex ? "is-done" : ""} ${index === state.scanIndex ? "is-active" : ""}">
                <span class="step-bullet">${index < state.scanIndex ? "✓" : index + 1}</span>
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
        <div class="signal-panel">
          <h1 id="unstableTitle">Signal gefunden</h1>
          <div class="signal-banner">
            <strong>Chip leicht verschieben oder drehen</strong>
            <span>Das Signal reicht noch nicht für eine sichere Vorlage.</span>
          </div>
          <div class="scan-actions">
            <button class="button" type="button" data-unstable-continue>Weiter messen</button>
            <button class="button button-secondary" type="button" data-read-scan="success">Erneut scannen</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderReadResult() {
  const chip = state.currentReadChip || chipCatalog.readHitag;
  return `
    <section class="screen" aria-labelledby="resultTitle">
      <div class="result-summary">
        <div>
          <h1 id="resultTitle" class="screen-title">${escapeHtml(chip.technology)}</h1>
          <p class="screen-subtitle">${escapeHtml(chip.frequency)} · stabil gelesen · zweiter Scan bestätigt</p>
        </div>
        <div class="result-actions">
          <button class="info-button" type="button" data-info="read-result" aria-label="Details anzeigen">i</button>
          <button class="button" type="button" data-open-save-template>Als Vorlage speichern</button>
        </div>
        <script type="application/json" data-details="read-result">${jsonScript(detailsForChip(chip))}</script>
      </div>
      <div class="result-grid">
        <div class="panel panel-fit">
          ${renderChipCard(chip, { id: "read-result" })}
        </div>
        <div class="panel panel-fit">
          <div class="panel-header">
            <div>
              <h2>Speicherbereiche</h2>
              <div class="meta-line">relevante Daten</div>
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
  const target = getSelectedTarget();
  const comparison = compareChips(state.currentWriteChip, target?.chip);
  return `
    <section class="screen" aria-labelledby="writeTitle">
      <div class="screen-head">
        <div>
          <h1 id="writeTitle" class="screen-title">Schreiben</h1>
          <p class="screen-subtitle">Aktueller Chip, Änderungen und Zielzustand bleiben getrennt.</p>
        </div>
      </div>
      <div class="write-layout">
        ${comparison ? renderCompatibilityBar(comparison) : `<div class="compat-bar is-neutral">Zielzustand bereit · aktuellen Chip scannen</div>`}
        <div class="write-columns">
          ${renderCurrentChipColumn(comparison)}
          ${renderWriteActions(comparison)}
          ${renderTargetColumn(target, comparison)}
        </div>
      </div>
    </section>
  `;
}

function renderCurrentChipColumn(comparison) {
  return `
    <div class="panel write-column">
      <div class="panel-header panel-header-inline">
        <div>
          <h2>Aktueller Chip</h2>
          <div class="meta-line">${state.backupCreated ? "Backup erstellt · 14:32" : "noch nicht gescannt"}</div>
        </div>
        <button class="button button-secondary button-small" type="button" data-write-scan>Aktuellen Chip scannen</button>
      </div>
      ${state.currentWriteChip ? `
        ${renderChipCard(state.currentWriteChip, {
          id: "current-write",
          comparison,
          side: "current",
          appliedKeys: state.appliedKeys,
        })}
        <div class="chip-note">Backup erstellt · 21.06.2026 14:32</div>
      ` : renderCurrentChipEmpty()}
    </div>
  `;
}

function renderTargetColumn(target, comparison) {
  return `
    <div class="panel write-column">
      <div class="panel-header">
        <div>
          <h2>Zielzustand</h2>
          <div class="meta-line">${target ? formatTargetSource(target) : "nicht ausgewählt"}</div>
        </div>
      </div>
      ${renderTargetSelector(target)}
      ${target ? renderChipCard(target.chip, {
        id: "target-write",
        comparison,
        side: "target",
      }) : renderTargetEmpty()}
    </div>
  `;
}

function renderCurrentChipEmpty() {
  return `
    <div class="empty-state empty-state-compact">
      <div class="empty-chip" aria-hidden="true"></div>
      <strong>Noch kein Chip gelesen</strong>
    </div>
  `;
}

function renderTargetEmpty() {
  return `
    <div class="empty-state empty-state-compact">
      <div class="empty-chip" aria-hidden="true"></div>
      <strong>Zielzustand auswählen</strong>
    </div>
  `;
}

function renderTargetSelector(target) {
  const templateValue = target?.kind === "template" ? target.id : "";
  return `
    <div class="target-control">
      <label class="field-label" for="targetSelect">Vorlage</label>
      <select class="target-select" id="targetSelect" data-target-select>
        <option value="">Vorlage wählen</option>
        ${state.templates.map((template) => `
          <option value="${escapeHtml(template.id)}" ${templateValue === template.id ? "selected" : ""}>${escapeHtml(template.name)}</option>
        `).join("")}
      </select>
      <button class="link-action" type="button" data-open-backup-targets>↶ Backup als Zielzustand verwenden</button>
    </div>
  `;
}

function renderWriteActions(comparison) {
  return `
    <div class="panel write-column action-panel">
      <div class="panel-header">
        <div>
          <h2>Änderungen</h2>
          <div class="meta-line">UID bleibt Referenz</div>
        </div>
      </div>
      ${renderChangeList(comparison)}
    </div>
  `;
}

function renderChangeList(comparison) {
  if (!state.currentWriteChip) {
    return `<div class="no-actions">Scanne zuerst den aktuellen Chip. Danach wird automatisch ein Backup erstellt.</div>`;
  }
  if (!getSelectedTarget()) {
    return `<div class="no-actions">Wähle rechts eine Vorlage oder ein Backup als Zielzustand.</div>`;
  }
  if (!comparison || comparison.status === "danger") {
    return `<div class="no-actions">Dieser Zielzustand passt nicht zum aktuellen Chip.</div>`;
  }

  const openWritable = comparison.differences.filter((diff) => diff.writable).length;
  const rows = [
    ...comparison.differences.map((diff) => renderChangeRow(diff)),
    ...state.completedActions.map((action) => renderCompletedChangeRow(action)),
  ].join("");

  return `
    <div class="action-stack">
      <div class="difference-count">${formatOpenCount(openWritable)}</div>
      <div class="change-list">
        ${rows || `<div class="no-actions">Aktueller Chip entspricht dem Zielzustand.</div>`}
      </div>
    </div>
  `;
}

function renderChangeRow(diff) {
  const working = state.workingAction?.key === diff.key ? state.workingAction.phase : "";
  const status = working === "writing"
    ? `${diff.label} wird übernommen ...`
    : working === "verifying"
      ? `${diff.label} wird geprüft ...`
      : "";
  return `
    <div class="change-row ${working ? "is-working" : ""} ${diff.writable ? "" : "is-blocked"}">
      <div class="change-label">${escapeHtml(diff.label)}</div>
      <div>
        <div class="change-values">
          <span>${escapeHtml(diff.fromValue)}</span>
          <span aria-hidden="true">→</span>
          <span>${escapeHtml(diff.toValue)}</span>
        </div>
        ${status ? `<div class="change-status">${escapeHtml(status)}</div>` : !diff.writable ? `<div class="change-status">Nicht übernehmbar</div>` : ""}
      </div>
      ${diff.writable ? `
        <button class="button button-secondary button-small" type="button" data-write-action="${escapeHtml(diff.key)}" ${state.workingAction ? "disabled" : ""}>
          Übernehmen
        </button>
      ` : `<span class="blocked-label">Gesperrt</span>`}
    </div>
  `;
}

function renderCompletedChangeRow(action) {
  return `
    <div class="change-row is-done">
      <div class="change-label">${escapeHtml(action.label)}</div>
      <div>
        <div class="change-values">
          <span>${escapeHtml(action.fromValue)}</span>
          <span aria-hidden="true">→</span>
          <span>${escapeHtml(action.toValue)}</span>
        </div>
        <div class="change-status">✓ ${escapeHtml(action.label)} übernommen</div>
      </div>
      <span class="done-label">Übernommen</span>
    </div>
  `;
}

function renderCompatibilityBar(comparison) {
  if (comparison.status === "danger") {
    return `<div class="compat-bar is-danger">Nicht kompatibel · Zielzustand passt nicht zum aktuellen Chip</div>`;
  }
  if (comparison.status === "warn") {
    return `<div class="compat-bar is-warn">Teilweise kompatibel · ${formatTransferableAreas(comparison.writableCount)}</div>`;
  }
  return `<div class="compat-bar is-success">Kompatibel · ${formatTransferableChanges(comparison.writableCount)}</div>`;
}

function formatOpenCount(count) {
  return count === 1 ? "1 offene Änderung" : `${count} offene Änderungen`;
}

function formatTransferableChanges(count) {
  return count === 1 ? "1 übernehmbare Änderung" : `${count} übernehmbare Änderungen`;
}

function formatTransferableAreas(count) {
  return count === 1 ? "1 Bereich kann übernommen werden" : `${count} Bereiche können übernommen werden`;
}

function renderChipCard(chip, options = {}) {
  const comparison = options.comparison;
  const configDifferent = comparison?.configDifferent && options.side === "current";
  const configApplied = options.appliedKeys?.includes("config");
  return `
    <article class="chip-card">
      <div class="chip-top">
        <div>
          <h2 class="chip-name">${escapeHtml(chip.technology)}</h2>
          <span class="chip-frequency">${escapeHtml(chip.frequency)}</span>
        </div>
      </div>
      <div class="chip-body">
        <div class="chip-core" aria-hidden="true"><div class="chip-core-inner"></div></div>
        <div class="chip-facts">
          <div class="fact">
            <span class="fact-label">UID</span>
            <span class="fact-value">${escapeHtml(chip.uid)}</span>
          </div>
          <div class="fact">
            <span class="fact-label">Config</span>
            <span class="fact-value ${configApplied ? "is-applied" : configDifferent ? "is-different" : ""}">${escapeHtml(chip.config || "n/a")}</span>
          </div>
          <div class="fact">
            <span class="fact-label">Frequenz</span>
            <span class="fact-value">${escapeHtml(chip.frequency)}</span>
          </div>
        </div>
      </div>
      ${renderMemorySegments(chip, options)}
    </article>
  `;
}

function renderMemorySegments(chip, options) {
  const regions = Array.isArray(chip.memoryRegions) ? chip.memoryRegions : [];
  if (!regions.length) return "";
  const comparison = options.comparison;
  return `
    <div class="segment-block">
      <div class="segment-title">Speichersegmente</div>
      <div class="memory-segments" aria-label="Speichersegmente">
        ${regions.map((region) => {
          const key = `region:${region.label}`;
          const different = comparison?.regionDiffKeys?.includes(key) && options.side === "current";
          const applied = options.appliedKeys?.includes(key);
          const blocked = !region.writable;
          return `
            <span class="memory-segment ${applied ? "is-applied" : different ? "is-different" : blocked ? "is-reference" : ""}" aria-label="${escapeHtml(region.label)}">
              ${escapeHtml(segmentLabel(region.label))}
            </span>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function segmentLabel(label) {
  const match = String(label).match(/\d+/);
  return match ? match[0] : String(label).slice(0, 3);
}

function renderDataRows(regions) {
  if (!regions?.length) {
    return `<div class="data-row"><strong>UID</strong><span>nur Referenz</span></div>`;
  }
  return regions.map((region) => `
    <div class="data-row">
      <strong>${escapeHtml(region.label)}</strong>
      <span>${escapeHtml(region.value)}</span>
    </div>
  `).join("");
}

function renderTemplatesView() {
  return `
    <section class="screen" aria-labelledby="templatesTitle">
      <div class="screen-head">
        <div>
          <h1 id="templatesTitle" class="screen-title">Vorlagen</h1>
          <p class="screen-subtitle">Vorlagen verwalten und direkt als Zielzustand fürs Schreiben setzen.</p>
        </div>
        <button class="button button-secondary" type="button" data-import-templates>Vorhandene Vorlagen importieren</button>
      </div>
      <div class="management-list">
        ${state.templates.map(renderTemplateItem).join("")}
      </div>
    </section>
  `;
}

function renderTemplateItem(template) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(template.name)}</h2>
        <div class="item-meta">${escapeHtml(template.chip.technology)} · ${escapeHtml(template.chip.frequency)}</div>
        <div class="item-meta">Erstellt: ${escapeHtml(template.createdDate)} · ${escapeHtml(template.createdTime)}</div>
        <p>Beschreibung: ${escapeHtml(template.description || "keine Beschreibung")}</p>
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
          <p class="screen-subtitle">Gesicherte Zustände als Ziel verwenden oder aus der Mock-Liste entfernen.</p>
        </div>
      </div>
      <div class="management-list">
        ${state.backups.map(renderBackupItem).join("")}
      </div>
    </section>
  `;
}

function renderBackupItem(backup) {
  return `
    <article class="management-item">
      <div class="management-main">
        <h2>${escapeHtml(backup.chip.technology)}</h2>
        <div class="item-meta">UID: ${escapeHtml(backup.chip.uid)}</div>
        <div class="item-meta">Erstellt: ${escapeHtml(backup.createdDate)} · ${escapeHtml(backup.createdTime)}</div>
        <p>Quelle: ${escapeHtml(backup.source)}</p>
      </div>
      <div class="item-actions">
        <button class="button button-small" type="button" data-use-backup-target="${escapeHtml(backup.id)}">Als Zielzustand verwenden</button>
        <button class="button button-secondary button-small" type="button" data-delete-backup="${escapeHtml(backup.id)}">Löschen</button>
      </div>
    </article>
  `;
}

function getSelectedTarget() {
  const template = state.templates.find((item) => item.id === state.targetId);
  if (template) {
    return {
      id: template.id,
      kind: "template",
      label: template.name,
      createdDate: template.createdDate,
      createdTime: template.createdTime,
      chip: template.chip,
    };
  }
  const backup = state.backups.find((item) => item.id === state.targetId);
  if (backup) {
    return {
      id: backup.id,
      kind: "backup",
      label: `${backup.createdDate} ${backup.createdTime}`,
      createdDate: backup.createdDate,
      createdTime: backup.createdTime,
      chip: backup.chip,
    };
  }
  return null;
}

function formatTargetSource(target) {
  if (target.kind === "backup") return `Quelle: Backup · ${target.createdDate} ${target.createdTime}`;
  return `Quelle: Vorlage · ${target.label}`;
}

function detailsForChip(chip) {
  const details = chip.details || {};
  return {
    Chipfamilie: details.chipFamily || chip.technology,
    Frequenz: details.frequency || chip.frequency,
    UID: details.uid || chip.uid,
    Config: details.config || chip.config || "n/a",
    Datenrate: details.dataRate || "n/a",
    Modus: details.mode || "n/a",
    Scanzeitpunkt: details.scannedAt || "n/a",
    "Zweiter Scan identisch": details.secondScan || "n/a",
  };
}

function compareChips(currentChip, targetChip) {
  if (!currentChip || !targetChip) return null;
  if (currentChip.technology !== targetChip.technology || currentChip.frequency !== targetChip.frequency) {
    return {
      status: "danger",
      writableCount: 0,
      differences: [],
      regionDiffKeys: [],
      configDifferent: false,
    };
  }

  const differences = [];
  const regionDiffKeys = [];
  const currentRegions = new Map((currentChip.memoryRegions || []).map((region) => [region.label, region]));
  const targetRegions = targetChip.memoryRegions || [];

  if ((currentChip.config || "") !== (targetChip.config || "")) {
    differences.push({
      key: "config",
      label: "Konfiguration",
      fromValue: currentChip.config || "n/a",
      toValue: targetChip.config || "n/a",
      writable: true,
      apply: () => {
        currentChip.config = targetChip.config;
        if (currentChip.details) currentChip.details.config = targetChip.config;
      },
    });
  }

  targetRegions.forEach((targetRegion) => {
    const currentRegion = currentRegions.get(targetRegion.label);
    const key = `region:${targetRegion.label}`;
    if (!currentRegion || currentRegion.value === targetRegion.value) return;
    regionDiffKeys.push(key);
    differences.push({
      key,
      label: targetRegion.label,
      fromValue: currentRegion.value,
      toValue: targetRegion.value,
      writable: Boolean(currentRegion.writable && targetRegion.writable),
      apply: () => {
        currentRegion.value = targetRegion.value;
      },
    });
  });

  const writableCount = differences.filter((diff) => diff.writable).length;
  const nonWritableDiff = differences.some((diff) => !diff.writable);
  return {
    status: nonWritableDiff ? "warn" : "success",
    writableCount,
    differences,
    regionDiffKeys,
    configDifferent: (currentChip.config || "") !== (targetChip.config || ""),
  };
}

function startReadScan(kind) {
  clearTimeout(scanTimer);
  state.readState = "scanning";
  state.scanIndex = 0;
  state.currentReadChip = null;
  setStatus("Chip wird gelesen ...");
  render();
  const stopAt = kind === "unstable" ? 2 : scanSteps.length - 1;

  const advance = () => {
    if (state.scanIndex >= stopAt) {
      if (kind === "unstable") {
        state.readState = "unstable";
        setStatus("Signal gefunden · Chip leicht verschieben oder drehen");
        render();
        return;
      }
      state.readState = "result";
      state.scanIndex = -1;
      state.currentReadChip = cloneChip(chipCatalog.readHitag);
      setStatus("Scan bestätigt");
      render();
      return;
    }
    state.scanIndex += 1;
    if (state.scanIndex === 5) setStatus("Zweiter Scan wird geprüft ...");
    render();
    scanTimer = setTimeout(advance, 520);
  };
  scanTimer = setTimeout(advance, 520);
}

function continueUnstableScan() {
  state.readState = "scanning";
  state.scanIndex = 3;
  setStatus("Chip wird gelesen ...");
  render();
  const advance = () => {
    if (state.scanIndex >= scanSteps.length - 1) {
      state.readState = "result";
      state.scanIndex = -1;
      state.currentReadChip = cloneChip(chipCatalog.readHitag);
      setStatus("Scan bestätigt");
      render();
      return;
    }
    state.scanIndex += 1;
    if (state.scanIndex === 5) setStatus("Zweiter Scan wird geprüft ...");
    render();
    scanTimer = setTimeout(advance, 520);
  };
  scanTimer = setTimeout(advance, 520);
}

function startWriteScan() {
  clearTimeout(writeTimer);
  setStatus("Aktueller Chip wird gelesen ...");
  state.currentWriteChip = null;
  state.backupCreated = false;
  resetWriteProgress();
  render();
  writeTimer = setTimeout(() => {
    state.currentWriteChip = cloneChip(chipCatalog.currentWrite);
    state.backupCreated = true;
    ensureWriteBackup();
    setStatus("Backup erstellt · 21.06.2026 14:32");
    render();
  }, 650);
}

function ensureWriteBackup() {
  const existing = state.backups.find((backup) => backup.id === "backup-before-write");
  if (existing) {
    existing.chip = cloneChip(chipCatalog.currentWrite);
    return;
  }
  state.backups.unshift({
    id: "backup-before-write",
    createdDate: "21.06.2026",
    createdTime: "14:32",
    source: "Vor dem Schreiben",
    chip: cloneChip(chipCatalog.currentWrite),
  });
}

function applyWriteAction(key) {
  const target = getSelectedTarget();
  const comparison = compareChips(state.currentWriteChip, target?.chip);
  const diff = comparison?.differences.find((item) => item.key === key);
  if (!diff || !diff.writable || state.workingAction) return;

  const completed = {
    key: diff.key,
    label: diff.label,
    fromValue: diff.fromValue,
    toValue: diff.toValue,
  };

  state.workingAction = { key, phase: "writing" };
  setStatus(`${diff.label} wird übernommen ...`);
  render();

  writeTimer = setTimeout(() => {
    state.workingAction = { key, phase: "verifying" };
    setStatus(`${diff.label} wird geprüft ...`);
    render();
    writeTimer = setTimeout(() => {
      diff.apply();
      state.appliedKeys.push(key);
      state.completedActions.unshift(completed);
      state.workingAction = null;
      setStatus(`✓ ${diff.label} übernommen`);
      render();
    }, 560);
  }, 560);
}

function openSaveTemplateModal() {
  modalRoot.hidden = false;
  modalRoot.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="saveTitle">
      <h2 id="saveTitle">Vorlage speichern</h2>
      <form class="form-grid" data-save-template-form>
        <div class="form-field">
          <label for="templateName">Name</label>
          <input id="templateName" name="name" value="Hitag S256 Vorlage" autocomplete="off" required />
        </div>
        <div class="form-field">
          <label for="templateDescription">Beschreibung</label>
          <textarea id="templateDescription" name="description">Zweiter Scan bestätigt</textarea>
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
          <textarea id="editDescription" name="description">${escapeHtml(template.description)}</textarea>
        </div>
        <div class="form-field">
          <label for="editNote">Kategorie / Notiz</label>
          <input id="editNote" name="note" value="${escapeHtml(template.note || "")}" autocomplete="off" />
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

function saveTemplate(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim() || "Unbenannte Vorlage";
  const description = String(formData.get("description") || "").trim();
  const chip = cloneChip(state.currentReadChip || chipCatalog.readHitag);
  const template = {
    id: makeId("tpl"),
    name,
    description,
    note: "",
    createdDate: "21.06.2026",
    createdTime: "14:35",
    chip,
  };
  state.templates.unshift(template);
  state.targetId = template.id;
  closeModal();
  setStatus("Vorlage gespeichert");
  showToast("Vorlage gespeichert");
  render();
}

function updateTemplate(form) {
  const template = state.templates.find((item) => item.id === form.dataset.templateId);
  if (!template) return;
  const formData = new FormData(form);
  template.name = String(formData.get("name") || "").trim() || "Unbenannte Vorlage";
  template.description = String(formData.get("description") || "").trim();
  template.note = String(formData.get("note") || "").trim();
  closeModal();
  setStatus("Vorlage aktualisiert");
  render();
}

function duplicateTemplate(templateId) {
  const index = state.templates.findIndex((item) => item.id === templateId);
  if (index < 0) return;
  const source = state.templates[index];
  const copy = {
    ...source,
    id: makeId("tpl"),
    name: `${source.name} Kopie`,
    createdDate: "21.06.2026",
    createdTime: "14:40",
    chip: cloneChip(source.chip),
  };
  state.templates.splice(index + 1, 0, copy);
  setStatus("Vorlage dupliziert");
  render();
}

function deleteTemplate(templateId) {
  const index = state.templates.findIndex((item) => item.id === templateId);
  if (index < 0) return;
  const [removed] = state.templates.splice(index, 1);
  if (state.targetId === templateId) {
    state.targetId = state.templates[0]?.id || state.backups[0]?.id || "";
    resetWriteProgress();
  }
  setStatus("Vorlage gelöscht");
  render();
  showToast("Vorlage gelöscht", () => {
    state.templates.splice(index, 0, removed);
    setStatus("Vorlage wiederhergestellt");
    render();
  });
}

function deleteBackup(backupId) {
  const index = state.backups.findIndex((item) => item.id === backupId);
  if (index < 0) return;
  const [removed] = state.backups.splice(index, 1);
  if (state.targetId === backupId) {
    state.targetId = state.templates[0]?.id || state.backups[0]?.id || "";
    resetWriteProgress();
  }
  setStatus("Backup gelöscht");
  render();
  showToast("Backup gelöscht", () => {
    state.backups.splice(index, 0, removed);
    setStatus("Backup wiederhergestellt");
    render();
  });
}

function useTarget(targetId, message) {
  state.targetId = targetId;
  resetWriteProgress();
  setStatus(message);
  setActiveView("write");
}

function openBackupTargetPopover(trigger) {
  clearPopover();
  const rect = trigger.getBoundingClientRect();
  const shellRect = document.querySelector("[data-app-shell]").getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover backup-popover";
  popover.setAttribute("role", "dialog");
  popover.style.top = `${Math.min(rect.bottom + 8, shellRect.bottom - 250)}px`;
  popover.style.left = `${Math.max(shellRect.left + 12, Math.min(rect.left, shellRect.right - 340))}px`;
  popover.innerHTML = `
    <h3>Backup wählen</h3>
    <div class="popover-list">
      ${state.backups.length ? state.backups.map((backup) => `
        <button class="popover-option" type="button" data-use-backup-target="${escapeHtml(backup.id)}">
          <strong>${escapeHtml(backup.chip.technology)}</strong>
          <span>${escapeHtml(backup.createdDate)} · ${escapeHtml(backup.createdTime)} · UID ${escapeHtml(backup.chip.uid)}</span>
        </button>
      `).join("") : `<div class="no-actions">Keine Backups vorhanden.</div>`}
    </div>
  `;
  document.body.appendChild(popover);
  state.activePopover = popover;
}

function openInfoPopover(trigger) {
  clearPopover();
  const id = trigger.dataset.info;
  const script = appView.querySelector(`script[data-details="${CSS.escape(id)}"]`);
  if (!script) return;
  const details = JSON.parse(script.textContent);
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

function clearPopover() {
  if (state.activePopover) {
    state.activePopover.remove();
    state.activePopover = null;
  }
}

function showToast(message, undoCallback = null) {
  clearTimeout(toastTimer);
  state.pendingUndo = undoCallback;
  toastRoot.hidden = false;
  toastRoot.innerHTML = `
    <div class="toast" role="status">
      <span>${escapeHtml(message)}</span>
      ${undoCallback ? `<button type="button" data-toast-undo>Rückgängig</button>` : ""}
    </div>
  `;
  toastTimer = setTimeout(() => {
    toastRoot.hidden = true;
    toastRoot.innerHTML = "";
    state.pendingUndo = null;
  }, 3600);
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;

  const navButton = target.closest("[data-view]");
  if (navButton) {
    setActiveView(navButton.dataset.view);
    return;
  }

  const settingsToggle = target.closest("[data-settings-toggle]");
  if (settingsToggle) {
    settingsPanel.hidden = !settingsPanel.hidden;
    return;
  }

  if (!target.closest("[data-settings-panel]") && !target.closest("[data-settings-toggle]")) {
    settingsPanel.hidden = true;
  }

  const readMode = target.closest("[data-read-mode]");
  if (readMode) {
    state.readMode = readMode.dataset.readMode;
    setStatus(`Scanmodus ${state.readMode}`);
    render();
    return;
  }

  const readScan = target.closest("[data-read-scan]");
  if (readScan) {
    startReadScan(readScan.dataset.readScan);
    return;
  }

  if (target.closest("[data-unstable-continue]")) {
    continueUnstableScan();
    return;
  }

  if (target.closest("[data-open-save-template]")) {
    openSaveTemplateModal();
    return;
  }

  if (target.closest("[data-close-modal]")) {
    closeModal();
    return;
  }

  if (target.closest("[data-write-scan]")) {
    startWriteScan();
    return;
  }

  const writeAction = target.closest("[data-write-action]");
  if (writeAction) {
    applyWriteAction(writeAction.dataset.writeAction);
    return;
  }

  const info = target.closest("[data-info]");
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
    useTarget(useBackup.dataset.useBackupTarget, "Backup als Zielzustand verwendet");
    return;
  }

  const useTemplate = target.closest("[data-use-template-target]");
  if (useTemplate) {
    useTarget(useTemplate.dataset.useTemplateTarget, "Vorlage als Zielzustand verwendet");
    return;
  }

  const editTemplate = target.closest("[data-edit-template]");
  if (editTemplate) {
    openEditTemplateModal(editTemplate.dataset.editTemplate);
    return;
  }

  const duplicate = target.closest("[data-duplicate-template]");
  if (duplicate) {
    duplicateTemplate(duplicate.dataset.duplicateTemplate);
    return;
  }

  const deleteTemplateButton = target.closest("[data-delete-template]");
  if (deleteTemplateButton) {
    deleteTemplate(deleteTemplateButton.dataset.deleteTemplate);
    return;
  }

  const deleteBackupButton = target.closest("[data-delete-backup]");
  if (deleteBackupButton) {
    deleteBackup(deleteBackupButton.dataset.deleteBackup);
    return;
  }

  if (target.closest("[data-import-templates]")) {
    setStatus("Import wird mit der Python-Integration ergänzt.");
    showToast("Import wird mit der Python-Integration ergänzt.");
    return;
  }

  if (target.closest("[data-toast-undo]")) {
    const undo = state.pendingUndo;
    toastRoot.hidden = true;
    toastRoot.innerHTML = "";
    state.pendingUndo = null;
    if (undo) undo();
    return;
  }

  if (!target.closest(".popover")) clearPopover();
});

document.addEventListener("change", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  if (target.matches("[data-target-select]")) {
    state.targetId = target.value;
    resetWriteProgress();
    setStatus(target.value ? "Vorlage als Zielzustand verwendet" : "Bereit · Zielzustand auswählen");
    render();
  }
});

document.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  if (event.target.matches("[data-save-template-form]")) {
    event.preventDefault();
    saveTemplate(event.target);
  }
  if (event.target.matches("[data-edit-template-form]")) {
    event.preventDefault();
    updateTemplate(event.target);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    clearPopover();
    settingsPanel.hidden = true;
  }
});

setStatus(state.status);
render();
