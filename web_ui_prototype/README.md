# Archivierte Web-UI-Designvorlage

Dieser Ordner ist nur noch eine alte Designvorlage. Er ist nicht die echte Anwendung,
spricht keine Hardware an und darf keine PM3-Zustände als produktive Wahrheit
darstellen.

Die echte Web-Desktop-Anwendung startet über pywebview:

```powershell
cd D:\LocalRepos\RFID-GUI
.\.venv-gui\Scripts\python.exe -m pm3_workflow_gui.web_desktop.app
```

## Umfang

- Frühere visuelle Skizze für Lesen, Schreiben, Vorlagen und Backups.
- Enthält Mock-Daten in `app.js`.
- Wird von `pm3_workflow_gui.web_desktop` nicht importiert oder geladen.

## Grenzen

Keine produktive Startanleitung, keine Hardwareintegration, kein Storage-Write.
