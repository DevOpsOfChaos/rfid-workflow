# Windows Installation

This is the non-developer installation path.

## Installieren

1. Copy the project folder to the Windows computer.
2. Double-click `Install-RFID-GUI.bat`.
3. If Windows asks for permission to run PowerShell, allow it.
4. If Python is missing, install Python 3.12 or newer from the page that opens.
   Enable `Add python.exe to PATH`, then run `Install-RFID-GUI.bat` again.
5. Start the app from the desktop shortcut `RFID GUI starten`.

The installer creates a local `.venv-gui` folder inside the project. It does not
install Python packages globally and does not require administrator rights.

## Starten

Use one of these:

- Desktop shortcut: `RFID GUI starten`
- Repository file: `Start-RFID-GUI.bat`

If the local GUI environment is missing, the start file runs the installer
first.

## Proxmark3/Iceman

The app expects a separately installed Proxmark3/Iceman client. The default
path is:

```text
C:\Tools\proxmark3\client
```

If that folder exists, the installer saves it automatically. Otherwise the app
can still start, but hardware workflows will show a connection/setup message
until the PM3 path is configured.

The Proxmark must also be visible in Windows Device Manager as a serial COM
device. Windows 10/11 often installs the driver automatically. If no COM port
appears, install the driver from your Proxmark/Iceman package or build archive.
Driver installation can require administrator rights.

Recommended manual PM3 startup for diagnosis:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Port diagnosis:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
```

More setup detail: [PROXMARK_SETUP.md](PROXMARK_SETUP.md)

## Diagnose

Run this from the project folder:

```powershell
.\scripts\doctor.ps1
```

The doctor checks Python, the local GUI environment, GUI imports, and PM3
connection basics.

## Deinstallieren

Close the app, delete the project folder, and delete the desktop shortcut.

User data is stored under:

```text
%LOCALAPPDATA%\PM3Workflow
```

Delete that folder only if templates, backups, and local settings should also
be removed.
