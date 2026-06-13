# Discovery Report

Date: 2026-06-13

## Paths

- User-provided Proxmark path: `C:\Tools\proxmark3`
- Found Proxmark executable: `C:\Tools\proxmark3\client\proxmark3.exe`
- Target repository folder: `D:\LocalRepos\RFID-GUI`

## Local Environment

- Python: `Python 3.14.5`
- Python launcher: `Python 3.14.5`
- Git: `git version 2.53.0.windows.1`
- PowerShell: `7.6.1`

## COM Ports

Windows serial-port enumeration returned:

- `COM1` - Kommunikationsanschluss

Expected previous Proxmark ports `COM16` or `COM11` were not visible during this run.

## Proxmark Client Discovery

`proxmark3.exe` exists, but command help/version attempts from Codex returned exit code 1 with no captured output. No successful Proxmark version output was obtained in this automated run.

No RFID write, clone, restore, simulation, or attack commands were executed.

## Open Questions

- Is the Proxmark currently connected and visible in Device Manager?
- Which COM port is active now?
- Does this Proxmark build require interactive console mode instead of `-c` for reliable output capture on this machine?
- Should the app target Python 3.12 specifically even though Python 3.14.5 is currently installed?

## Recommended Implementation Steps

1. Build a robust Proxmark process adapter and test it against a connected device.
2. Capture real `hw version`, `hw tune`, `lf search`, and Hitag S output for parser fixtures.
3. Implement the Normal Mode UI around read-only discovery before enabling any write-gated workflow execution.

