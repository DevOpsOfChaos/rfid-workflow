# Read-only GUI MVP

The GUI MVP is a display layer over existing read-only capture providers and
`DiscoveryFacade`. Its live scan path runs only fixed read-only PM3 commands
through the local wrapper. It does not expose a PM3 terminal and does not
generate write commands.

## Start

Install the GUI only in the local project virtual environment:

```powershell
cd <PROJECT_ROOT>
.\scripts\install-windows.ps1
.\Start-RFID-GUI.ps1
```

Alternatively, after activating `.venv-gui`, install the optional GUI extra:

```powershell
python -m pip install -e .[gui]
.\Start-RFID-GUI.ps1
```

If pywebview is missing, the app exits with:

```text
pywebview ist nicht installiert. Bitte die Projekt-GUI-Venv verwenden: .\.venv-gui\Scripts\python.exe -m pip install pywebview
```

## Data Sources

The left panel can load:

- demo scenarios: Original Hitag, blank before write, blank after write
- demo logs: help-only, lost-device, successful blank read
- a user-selected PM3 `.txt` log
- the latest log from `C:\Tools\proxmark3\client\.proxmark3\logs`
- live scan via `Scan NFC/RFID tag`

The demo entries are backed by repository fixtures so the UI can be exercised
without hardware. Live scan uses PM3 auto-port detection and does not require
COM16.

## What It Shows

The right panel shows:

- session status and reconnect requirement
- target, client, COM port, firmware, LF/HF antenna status
- discovery data status, tag frequency, tag type, verification status
- next step and risk notes
- debug lists for recognized PM3 commands, ignored host commands, and missing sections

`lf hitag hts reader -@` UID output is treated as Hitag/LF candidate evidence.
`lf hitag hts rdbl -p 0 -c 8` is still required before the UI reports
`Hitag S256 Plain`.

## Operator Notes

Run CLI commands in a separate PowerShell, not inside the PM3 console. If host
commands accidentally appear in a PM3 log, the GUI shows them under ignored host
commands and excludes them from recognized PM3 commands.

If the session state is `device_lost`, stop. Reconnect USB and restart PM3 with:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

During live scan, if the PM3 cannot be found, the GUI covers the complete
program window with a USB reconnect message. It keeps polling `bash pm3 --list`
and removes the message only after the wrapper reports a PM3 port again.

## Explicit Non-goals

- no interactive PM3 terminal
- no pywebview dependency in core tests
- no arbitrary raw PM3 command input
- no unverified bulk write workflow
- no arbitrary command execution behind buttons
