# RFID Workflow GUI

Windows-first GUI for authorized Proxmark3/Iceman RFID workflows.

This tool is for approved, auditable RFID work. It does not bundle Proxmark3,
does not flash firmware, and is not a general RFID copying tool.

## Einfacher Windows-Start

For a normal user, use the files in the repository root:

1. Double-click `Install-RFID-GUI.bat`.
2. Wait until the installer finishes.
3. Start the app with the new desktop shortcut `RFID GUI starten`, or double-click `Start-RFID-GUI.bat`.

On the first start, `Start-RFID-GUI.bat` also installs the local GUI
environment if it is missing.

Requirements:

- Windows 10/11
- Python 3.12 or newer
- Separately installed Proxmark3/Iceman client
- Working Proxmark USB driver / COM port

If Python is missing, the installer opens the official Python download page.
Install Python, enable `Add python.exe to PATH`, then run
`Install-RFID-GUI.bat` again.

Detailed user instructions: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md)
Proxmark setup and driver notes: [docs/PROXMARK_SETUP.md](docs/PROXMARK_SETUP.md)

## What The App Does

- Finds a local Proxmark3/Iceman setup and checks the connection.
- Runs controlled read and discovery workflows.
- Stores templates and backups under the current Windows user profile.
- Plans and verifies supported Hitag S256 profile writes.
- Keeps workflow results understandable for non-developers.

Write workflows are constrained by the application. The live scan path only
uses allowlisted Proxmark commands.

## What Is Out Of Scope

- Bundling Proxmark3/Iceman
- Brute force, attacks, or unauthorized access workflows
- Arbitrary PM3 terminal command input
- Selling, redistributing, or modifying this project

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\python -m pytest -q
```

GUI dependencies are kept separate from the development environment:

```powershell
.\scripts\install-windows.ps1 -Dev
.\Start-RFID-GUI.bat
```

Useful technical docs:

- [CLI usage](docs/CLI_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GUI MVP notes](docs/GUI_READONLY_MVP.md)
- [License notes](docs/LICENSE_NOTES.md)
- [Proxmark setup](docs/PROXMARK_SETUP.md)
- [Security checklist](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

This repository is source-available, not open source.

You may use the tool as provided. You may not copy it except as needed for
installation or backup, modify it, redistribute it, sublicense it, or sell it.
See [LICENSE](LICENSE).
