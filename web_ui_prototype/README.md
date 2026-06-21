# Web UI Prototype

Isolierter HTML/CSS/JavaScript-Prototyp für die visuellen Hauptabläufe der RFID-GUI.

## Start

```powershell
cd D:\LocalRepos\RFID-GUI
py -3.14 -m http.server 8765 --directory web_ui_prototype
```

Dann im Browser öffnen:

```text
http://localhost:8765
```

## Umfang

- Lesen mit Scan-Start, Scan-Fortschritt, instabilem Signal, zweitem Scan und Vorlage-speichern-Dialog.
- Schreiben mit aktuellem Chip, automatischem Backup-Hinweis, Vorlage/Backup als Zielzustand, Kompatibilitätsstatus und einzelnen Mock-Schreibaktionen.
- Vorlagenverwaltung mit Bearbeiten, Duplizieren, Löschen mit Rückgängig und Zielzustand-Auswahl.
- Backupverwaltung mit Zielzustand-Auswahl und Löschen mit Rückgängig.
- Mock-Daten liegen in `app.js` und sind technologie-neutral aufgebaut.

## Grenzen

Dieser Prototyp spricht keine Hardware an, schreibt keine bestehenden Vorlagenordner und ersetzt die PySide6-Oberfläche nicht.
