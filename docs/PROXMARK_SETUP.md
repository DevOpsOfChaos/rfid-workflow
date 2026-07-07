# Proxmark3/Iceman Setup

This app requires a separate working Proxmark3/Iceman installation. It does not
install, bundle, flash, or license Proxmark3 for you.

## Expected Path

Recommended Windows path:

```text
C:\Tools\proxmark3\client
```

The installer auto-saves that path when it exists. To use another location:

```powershell
.\scripts\install-windows.ps1 -Pm3ClientDir "D:\Tools\proxmark3\client"
```

## Windows Driver Check

Plug in the Proxmark and open Device Manager.

Expected result:

- Windows 10/11 usually shows it under `Ports (COM & LPT)` as a USB serial COM
  device.
- If no COM port appears, install the driver from the Proxmark/Iceman package or
  the Proxmark build archive you use.
- Windows 7 usually needs manual driver installation.

The app does not install drivers. Driver installation can require administrator
rights.

## Manual PM3 Test

From PowerShell:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
```

If that lists no port, the GUI cannot use the PM3 either. Fix USB, driver, or
firmware first.

Start the PM3 client manually:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Do not force `COM16` unless you are diagnosing a known port. The app is built
around auto-port detection.
