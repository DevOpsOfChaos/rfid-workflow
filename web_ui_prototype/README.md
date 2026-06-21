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

- Lesen & Vorlagen mit Scan-Start, Scan-Fortschritt, instabilem Signal, zweitem Scan und Vorlage-speichern-Dialog.
- Schreiben mit aktuellem Chip, automatischem Backup-Hinweis, Zielzustand-Auswahl, Kompatibilitätsstatus und einzelnen Mock-Schreibaktionen.
- Schlanke Analyse-Seite ohne Diagramme, PM3-Argumente oder Terminalausgaben.
- Mock-Daten liegen in `app.js` und sind technologie-neutral aufgebaut.

## Grenzen

Dieser Prototyp spricht keine Hardware an. Er führt keine PM3-Kommandos aus, schreibt keine bestehenden Vorlagenordner und ersetzt die PySide6-Oberfläche nicht.
