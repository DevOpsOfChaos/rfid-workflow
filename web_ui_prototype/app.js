const appView = document.getElementById("appView");
const statusText = document.getElementById("statusText");
const modalRoot = document.getElementById("modalRoot");
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
    memoryRange: "Blöcke: 4-7",
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
      pages: "Block 4-7",
      scannedAt: "2026-06-21 14:29",
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
      pages: "Block 4-7",
      scannedAt: "2026-06-21 14:32",
      secondScan: "identisch",
    },
  },
};

const targets = [
  {
    id: "tpl-garage",
    type: "Vorlage",
    label: "Garage - Master",
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
        pages: "Block 4-7",
        scannedAt: "2026-06-18 18:11",
        secondScan: "Vorlage geprüft",
      },
    },
  },
  {
    id: "tpl-workshop",
    type: "Vorlage",
    label: "Werkstatt - Ersatzchip",
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
        pages: "Block 4-7",
        scannedAt: "2026-06-20 09:44",
        secondScan: "Vorlage geprüft",
      },
    },
  },
  {
    id: "backup-today",
    type: "Backup",
    label: "Backup · 2026-06-21 14:32",
    chip: cloneChip(chipCatalog.currentWrite),
  },
  {
    id: "backup-older",
    type: "Backup",
    label: "Backup · 2026-06-18 19:07",
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
        pages: "Sektorübersicht",
        scannedAt: "2026-06-18 19:07",
        secondScan: "Backup",
      },
    },
  },
];

const state = {
  activeView: "read",
  readMode: "Auto",
  readState: "idle",
  scanIndex: -1,
  currentReadChip: null,
  currentWriteChip: null,
  targetId: "",
  appliedKeys: [],
  workingKey: "",
  completedActions: [],
  savedTemplates: [],
  backupCreated: false,
  status: "Bereit · Chip auflegen",
  activePopover: null,
};

let scanTimer = null;
let writeTimer = null;

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

function setStatus(message) {
  state.status = message;
  statusText.textContent = message;
}

function setActiveView(view) {
  state.activeView = view;
  state.activePopover = null;
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
  if (state.activeView === "analysis") appView.innerHTML = renderAnalysisView();
  if (state.activeView === "templates") appView.innerHTML = renderListView("Vorlagen", getTemplateList());
  if (state.activeView === "backups") appView.innerHTML = renderListView("Backups", getBackupList());
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
          <p>Erstelle eine geprüfte Vorlage aus einem RFID- oder NFC-Chip.</p>
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
          <p class="screen-subtitle">Der zweite Scan wird automatisch zur Bestätigung verwendet.</p>
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
      <div class="screen-head">
        <div>
          <h1 id="resultTitle" class="screen-title">${escapeHtml(chip.technology)}</h1>
          <p class="screen-subtitle">${escapeHtml(chip.frequency)} · stabil gelesen · zweiter Scan bestätigt</p>
        </div>
      </div>
      <div class="result-grid">
        <div class="panel panel-fill">
          ${renderChipCard(chip, { id: "read-result", showState: false })}
        </div>
        <div class="panel panel-fill">
          <div class="panel-header">
            <div>
              <h2>Speicherbereiche</h2>
              <div class="meta-line">geprüfte Werte</div>
            </div>
          </div>
          <div class="data-overview">
            ${renderDataRows(chip.memoryRegions)}
          </div>
          <div class="toolbar-bottom">
            <button class="button" type="button" data-open-save-template>Als Vorlage speichern</button>
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
          <p class="screen-subtitle">Aktuellen Chip sichern, Zielzustand wählen und Unterschiede einzeln übernehmen.</p>
        </div>
      </div>
      <div class="write-layout">
        ${comparison ? renderCompatibilityBar(comparison) : `<div class="compat-bar" style="visibility:hidden">Bereit</div>`}
        <div class="write-columns">
          <div class="panel write-column">
            <div class="panel-header">
              <div>
                <h2>Aktueller Chip</h2>
                <div class="meta-line">${state.backupCreated ? "Backup erstellt · 2026-06-21 14:32" : "noch nicht gesichert"}</div>
              </div>
            </div>
            ${state.currentWriteChip ? renderChipCard(state.currentWriteChip, {
              id: "current-write",
              comparison,
              side: "current",
              appliedKeys: state.appliedKeys,
            }) : renderCurrentChipEmpty()}
          </div>
          <div class="panel write-column">
            <div class="panel-header">
              <div>
                <h2>Aktionen</h2>
                <div class="meta-line">UID bleibt Referenz</div>
              </div>
            </div>
            ${renderWriteActions(comparison)}
          </div>
          <div class="panel write-column">
            <div class="panel-header">
              <div>
                <h2>Zielzustand</h2>
                <div class="meta-line">Vorlage oder Backup</div>
              </div>
            </div>
            ${renderTargetSelector()}
            ${target ? renderChipCard(target.chip, {
              id: "target-write",
              comparison,
              side: "target",
            }) : renderTargetEmpty()}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCurrentChipEmpty() {
  return `
    <div class="empty-state">
      <div class="empty-chip" aria-hidden="true"></div>
      <strong>Noch kein Chip gelesen</strong>
      <button class="button" type="button" data-write-scan>Aktuellen Chip scannen</button>
    </div>
  `;
}

function renderTargetEmpty() {
  return `
    <div class="empty-state">
      <div class="empty-chip" aria-hidden="true"></div>
      <strong>Zielzustand auswählen</strong>
    </div>
  `;
}

function renderTargetSelector() {
  const templateTargets = targets.filter((target) => target.type === "Vorlage");
  const backupTargets = targets.filter((target) => target.type === "Backup");
  const option = (target) => `<option value="${escapeHtml(target.id)}" ${state.targetId === target.id ? "selected" : ""}>${escapeHtml(target.label)}</option>`;
  return `
    <div class="select-stack">
      <label class="field-label" for="targetSelect">Vorlage auswählen</label>
      <select class="target-select" id="targetSelect" data-target-select>
        <option value="">Keine Auswahl</option>
        ${templateTargets.map(option).join("")}
      </select>
      <div class="or-label">oder</div>
      <label class="field-label" for="backupSelect">Backup auswählen</label>
      <select class="target-select" id="backupSelect" data-backup-select>
        <option value="">Keine Auswahl</option>
        ${backupTargets.map(option).join("")}
      </select>
    </div>
  `;
}

function renderWriteActions(comparison) {
  if (!state.currentWriteChip) {
    return `<div class="no-actions">Scanne zuerst den aktuellen Chip. Danach wird automatisch ein Backup erstellt.</div>`;
  }
  if (!getSelectedTarget()) {
    return `<div class="no-actions">Wähle rechts eine Vorlage oder ein Backup als Zielzustand.</div>`;
  }
  if (!comparison || comparison.status === "danger") {
    return `<div class="no-actions">Für diesen Zielzustand gibt es keine sinnvolle Schreibaktion.</div>`;
  }
  const pending = comparison.differences.filter((diff) => !state.appliedKeys.includes(diff.key) && diff.writable);
  return `
    <div class="action-stack">
      <div class="difference-count">${formatDifferenceCount(pending.length)}</div>
      ${pending.length ? `
        <div class="action-list">
          ${pending.map((diff) => `
            <button class="write-action ${state.workingKey === diff.key ? "is-working" : ""}" type="button" data-write-action="${escapeHtml(diff.key)}" ${state.workingKey ? "disabled" : ""}>
              <span>${escapeHtml(state.workingKey === diff.key ? `${diff.actionLabel.replace(" übernehmen", "")} läuft` : diff.actionLabel)}</span>
            </button>
          `).join("")}
        </div>
      ` : `<div class="no-actions">Aktueller Chip entspricht dem Zielzustand.</div>`}
      ${state.completedActions.length ? `
        <div class="done-list">
          ${state.completedActions.map((label) => `<div class="done-row">${escapeHtml(label)} übernommen</div>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderCompatibilityBar(comparison) {
  if (comparison.status === "danger") {
    return `<div class="compat-bar is-danger">Nicht kompatibel · Zielzustand passt nicht zu diesem Chiptyp</div>`;
  }
  if (comparison.status === "warn") {
    return `<div class="compat-bar is-warn">Teilweise kompatibel · ${formatTransferableCount(comparison.writableCount)}</div>`;
  }
  return `<div class="compat-bar is-success">Kompatibel · ${escapeHtml(comparison.technology)} erkannt · ${formatWritableDifferenceCount(comparison.writableCount)}</div>`;
}

function formatDifferenceCount(count) {
  return count === 1 ? "1 Unterschied" : `${count} Unterschiede`;
}

function formatWritableDifferenceCount(count) {
  return count === 1 ? "1 schreibbarer Unterschied" : `${count} schreibbare Unterschiede`;
}

function formatTransferableCount(count) {
  return count === 1 ? "1 Bereich kann übernommen werden" : `${count} Bereiche können übernommen werden`;
}

function renderChipCard(chip, options = {}) {
  const details = detailsForChip(chip);
  const rows = renderMemoryRows(chip, options);
  const configClass = options.comparison?.configDifferent && options.side === "current" ? "is-different" : "";
  return `
    <article class="chip-card">
      <div class="chip-top">
        <div>
          <h2 class="chip-name">${escapeHtml(chip.technology)}</h2>
          <span class="chip-frequency">${escapeHtml(chip.frequency)} · ${escapeHtml(chip.memoryRange || "Daten")}</span>
        </div>
        <button class="info-button" type="button" data-info="${escapeHtml(options.id || chip.uid)}" aria-label="Technische Details anzeigen">i</button>
      </div>
      <div class="chip-body">
        <div class="chip-core" aria-hidden="true"><div class="chip-core-inner"></div></div>
        <div class="chip-facts">
          <div class="fact">
            <span class="fact-label">UID</span>
            <span class="fact-value">${escapeHtml(chip.uid)}</span>
          </div>
          <div class="fact ${configClass ? "" : ""}">
            <span class="fact-label">Config</span>
            <span class="fact-value">${escapeHtml(chip.config || "n/a")}</span>
          </div>
          <div class="fact fact-readonly">
            <span class="fact-label">Referenz</span>
            <span class="fact-value">UID nicht schreiben</span>
          </div>
        </div>
      </div>
      ${rows}
      <script type="application/json" data-details="${escapeHtml(options.id || chip.uid)}">${JSON.stringify(details)}</script>
    </article>
  `;
}

function renderMemoryRows(chip, options) {
  const regions = Array.isArray(chip.memoryRegions) ? chip.memoryRegions : [];
  if (!regions.length) {
    return `
      <div class="memory-list">
        <div class="memory-row is-reference">
          <span class="memory-label">Daten</span>
          <span class="memory-value">${escapeHtml(chip.uid)}</span>
          <span class="memory-state">Referenz</span>
        </div>
      </div>
    `;
  }
  const comparison = options.comparison;
  return `
    <div class="memory-list">
      ${regions.map((region) => {
        const key = `region:${region.label}`;
        const isDifferent = Boolean(comparison?.regionDiffKeys?.includes(key));
        const isApplied = Boolean(options.appliedKeys?.includes(key));
        const stateClass = isApplied ? "is-applied" : isDifferent && options.side === "current" ? "is-different" : !region.writable ? "is-reference" : "";
        const stateLabel = isApplied ? "übernommen" : !region.writable ? "Referenz" : isDifferent && options.side === "current" ? "anders" : "";
        return `
          <div class="memory-row ${stateClass}">
            <span class="memory-label">${escapeHtml(region.label)}</span>
            <span class="memory-value">${escapeHtml(region.value)}</span>
            <span class="memory-state">${escapeHtml(stateLabel)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
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

function renderAnalysisView() {
  return `
    <section class="screen" aria-labelledby="analysisTitle">
      <div class="screen-head">
        <div>
          <h1 id="analysisTitle" class="screen-title">Analyse</h1>
          <p class="screen-subtitle">Schlanke Hilfen für Position, Antenne und technische Details.</p>
        </div>
      </div>
      <div class="analysis-grid">
        ${renderAnalysisCard("position", "Position optimieren", "Signalstärke durch kurze Messung und klare Handlung prüfen.")}
        ${renderAnalysisCard("antenna", "Antenne prüfen", "LF/HF-Bereitschaft und stabile Kopplung anzeigen.")}
        ${renderAnalysisCard("details", "Technische Details anzeigen", "Gelesene Eigenschaften des letzten Chips kompakt öffnen.")}
      </div>
    </section>
  `;
}

function renderAnalysisCard(id, title, body) {
  return `
    <article class="analysis-card">
      <div class="analysis-icon" aria-hidden="true">${id === "position" ? "⌖" : id === "antenna" ? "∿" : "i"}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      <button class="button button-secondary" type="button" data-analysis-action="${escapeHtml(id)}">Öffnen</button>
    </article>
  `;
}

function renderListView(title, items) {
  return `
    <section class="screen" aria-labelledby="listTitle">
      <div class="screen-head">
        <div>
          <h1 id="listTitle" class="screen-title">${escapeHtml(title)}</h1>
          <p class="screen-subtitle">Mock-Daten für die visuelle Prüfung des Prototyps.</p>
        </div>
      </div>
      <div class="list-page">
        ${items.map((item) => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(item.meta)}</span>
            </div>
            <span>${escapeHtml(item.kind)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function getTemplateList() {
  const builtIn = targets.filter((target) => target.type === "Vorlage").map((target) => ({
    label: target.label,
    meta: `${target.chip.technology} · UID ${target.chip.uid}`,
    kind: "Vorlage",
  }));
  return [
    ...builtIn,
    ...state.savedTemplates.map((template) => ({
      label: template.name,
      meta: template.description || "gerade gespeichert",
      kind: "Vorlage",
    })),
  ];
}

function getBackupList() {
  return targets.filter((target) => target.type === "Backup").map((target) => ({
    label: target.label,
    meta: `${target.chip.technology} · UID ${target.chip.uid}`,
    kind: "Backup",
  }));
}

function getSelectedTarget() {
  return targets.find((target) => target.id === state.targetId);
}

function detailsForChip(chip) {
  const details = chip.details || {};
  return {
    Chipfamilie: details.chipFamily || chip.technology,
    Frequenz: details.frequency || chip.frequency,
    UID: details.uid || chip.uid,
    Konfiguration: details.config || chip.config || "n/a",
    Datenrate: details.dataRate || "n/a",
    Modus: details.mode || "n/a",
    "Alle gelesenen Seiten": details.pages || chip.memoryRange || "n/a",
    Scanzeitpunkt: details.scannedAt || "n/a",
    "Zweiter Scan identisch": details.secondScan || "n/a",
  };
}

function compareChips(currentChip, targetChip) {
  if (!currentChip || !targetChip) return null;
  if (currentChip.technology !== targetChip.technology || currentChip.frequency !== targetChip.frequency) {
    return {
      status: "danger",
      technology: currentChip.technology,
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
      actionLabel: "Konfiguration übernehmen",
      writable: true,
      apply: () => {
        currentChip.config = targetChip.config;
        currentChip.details.config = targetChip.config;
      },
    });
  }

  targetRegions.forEach((targetRegion) => {
    const currentRegion = currentRegions.get(targetRegion.label);
    const key = `region:${targetRegion.label}`;
    if (!currentRegion) return;
    if (currentRegion.value !== targetRegion.value) {
      regionDiffKeys.push(key);
      differences.push({
        key,
        actionLabel: `${targetRegion.label} übernehmen`,
        writable: Boolean(currentRegion.writable && targetRegion.writable),
        apply: () => {
          currentRegion.value = targetRegion.value;
        },
      });
    }
  });

  const writableCount = differences.filter((diff) => diff.writable && !state.appliedKeys.includes(diff.key)).length;
  const nonWritableDiff = differences.some((diff) => !diff.writable);
  return {
    status: nonWritableDiff ? "warn" : "success",
    technology: currentChip.technology,
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
    scanTimer = setTimeout(advance, 560);
  };
  scanTimer = setTimeout(advance, 560);
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
    scanTimer = setTimeout(advance, 560);
  };
  scanTimer = setTimeout(advance, 560);
}

function startWriteScan() {
  clearTimeout(writeTimer);
  setStatus("Aktueller Chip wird gelesen ...");
  state.currentWriteChip = null;
  state.backupCreated = false;
  state.appliedKeys = [];
  state.completedActions = [];
  render();
  writeTimer = setTimeout(() => {
    state.currentWriteChip = cloneChip(chipCatalog.currentWrite);
    state.backupCreated = true;
    setStatus("Backup erstellt · 2026-06-21 14:32");
    render();
  }, 850);
}

function applyWriteAction(key) {
  const target = getSelectedTarget();
  const comparison = compareChips(state.currentWriteChip, target?.chip);
  const diff = comparison?.differences.find((item) => item.key === key);
  if (!diff || !diff.writable || state.workingKey) return;

  state.workingKey = key;
  setStatus(`${diff.actionLabel.replace(" übernehmen", "")} wird geschrieben ...`);
  render();

  writeTimer = setTimeout(() => {
    setStatus(`${diff.actionLabel.replace(" übernehmen", "")} wird geprüft ...`);
    writeTimer = setTimeout(() => {
      diff.apply();
      state.appliedKeys.push(key);
      state.completedActions.unshift(diff.actionLabel.replace(" übernehmen", ""));
      state.workingKey = "";
      setStatus(`${diff.actionLabel.replace(" übernehmen", "")} erfolgreich übernommen`);
      render();
    }, 620);
  }, 620);
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

function closeModal() {
  modalRoot.hidden = true;
  modalRoot.innerHTML = "";
}

function saveTemplate(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim() || "Unbenannte Vorlage";
  const description = String(formData.get("description") || "").trim();
  state.savedTemplates.push({ name, description, chip: cloneChip(state.currentReadChip || chipCatalog.readHitag) });
  closeModal();
  setStatus("Vorlage gespeichert");
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
  popover.style.top = `${Math.min(rect.bottom + 8, shellRect.bottom - 310)}px`;
  popover.style.left = `${Math.min(rect.left - 250, shellRect.right - 334)}px`;
  popover.innerHTML = `
    <h3>Technische Details</h3>
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

document.addEventListener("click", (event) => {
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

  const analysisAction = target.closest("[data-analysis-action]");
  if (analysisAction) {
    const messages = {
      position: "Position optimieren · Messung vorbereitet",
      antenna: "Antenne prüfen · LF/HF bereit",
      details: "Technische Details anzeigen",
    };
    setStatus(messages[analysisAction.dataset.analysisAction] || "Bereit");
    return;
  }

  if (!target.closest(".popover")) clearPopover();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-target-select]")) {
    state.targetId = target.value;
    state.appliedKeys = [];
    state.completedActions = [];
    setStatus(target.value ? "Vorlage ausgewählt" : "Bereit · Zielzustand auswählen");
    render();
  }
  if (target.matches("[data-backup-select]")) {
    state.targetId = target.value;
    state.appliedKeys = [];
    state.completedActions = [];
    setStatus(target.value ? "Backup ausgewählt" : "Bereit · Zielzustand auswählen");
    render();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-save-template-form]")) {
    event.preventDefault();
    saveTemplate(event.target);
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
