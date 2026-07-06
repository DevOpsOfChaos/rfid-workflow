# Auftrag an Claude Design: Fehlende PM3-Studio-Designs

## Ziel

Ergänze das bestehende High-Fidelity-Handoff `PM3 Studio Redesign - Standalone.html` um die Flächen, die in der realen pywebview-App existieren, aber im aktuellen Designpaket nicht vollständig spezifiziert sind. Das bestehende Designsystem muss unverändert bleiben:

- Hintergrund `#080D18`
- Panels `#0D1525` / `#111D30`
- Border `#1E3050`
- Accent Blau `#3B82F6`
- Erfolg `#22C55E`
- Warnung `#F59E0B`
- Fehler `#EF4444`
- Schrift `DM Sans`, Mono `JetBrains Mono`
- Sidebar 192px, Header 50px, Statusbar 28px

## Fehlende Screens

### 1. Backups

Die App hat einen eigenen `Backups`-Screen. Im Handoff gibt es dafür noch keinen dedizierten Screen, nur Vorlagenkarten und Backup-Zielauswahl im Schreibfluss.

Benötigt:

- Vollständiger Backups-Screen im bestehenden App-Shell-Layout.
- Such-Header wie bei `Vorlagen`, aber mit Backup-spezifischem Sort-Dropdown.
- Backup-Karten im gleichen Qualitätsniveau wie Vorlagen, aber klar unterscheidbar:
  - Chip-SVG oben
  - Speicherblock-Leiste
  - Technologie, UID, Zeitpunkt, Quelle
  - Aktionen: `Als Zielzustand verwenden`, `Details`, `Löschen`
- Empty State für keine Backups.
- Bestätigungsdialog für Löschen.
- Detaildialog mit Rohdaten und Metadaten.

### 2. Startup / Bridge-Zustände

Die reale App hat Startzustände, die im Handoff nur indirekt abgedeckt sind:

- Sprache wählen
- PM3-Verbindung wird geprüft
- PM3 nicht gefunden
- Antennentest vor Programmstart
- Desktop-Bridge fehlt

Benötigt:

- High-Fidelity-Screens für alle Zustände im bestehenden Designsystem.
- Keine Marketing-Hero-Flächen, sondern funktionale App-Zustände.
- Für Antennentest dieselben `antRing`-Animationen wie im Selbsttest.
- Für Fehlerzustände klare, reduzierte Fehlerkarte mit PM3-Pfad-Hinweis und Buttons.

### 3. Globale Overlays

Der Handoff erwähnt `Muster/Dialoge`, aber die realen App-Overlays brauchen konkrete Varianten:

- Vorlage speichern
- Vorlage bearbeiten
- Vorlage löschen
- Backup löschen
- Backupdetails
- Hilfe-Dialoge
- Toasts
- Einstellungen-Panel in der Sidebar

Benötigt:

- Ein Designboard mit allen Overlay-Varianten.
- Fokus auf Desktop-Dichte, 8-16px Radien, keine verschachtelten Karten.
- Buttons, Inputs, Selects und Danger-Aktionen exakt im PM3-Studio-Stil.

## Abgabeformat

Bitte als aktualisierten interaktiven HTML-Handoff liefern, nicht nur als Bild. Die reale Implementierung übernimmt danach wieder Werte und Struktur in `app.js` / `styles.css`; der Handoff darf nicht direkt als Produktionscode gedacht sein.
