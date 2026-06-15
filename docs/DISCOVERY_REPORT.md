# Discovery Report

Date: 2026-06-13

## Paths

- User-provided Proxmark path: `C:\Tools\proxmark3`
- Client folder: `C:\Tools\proxmark3\client`
- Direct executable present during discovery: `C:\Tools\proxmark3\client\proxmark3.exe`
- Target repository folder: `D:\LocalRepos\RFID-GUI`

## Local Environment

- Python: `Python 3.14.5`
- Python launcher: `Python 3.14.5`
- Git: `git version 2.53.0.windows.1`
- PowerShell: `7.6.1`

## COM Ports

Windows serial-port enumeration returned:

- `COM1` - Kommunikationsanschluss

Expected previous Proxmark ports `COM16` or `COM11` were not visible during the original automated enumeration. The current user-provided working Proxmark port is `COM16`.

## Proxmark Client Discovery

`proxmark3.exe` exists, but the user's installation is not primarily started by calling `proxmark3.exe COMx` directly. The corrected startup path is the Batch/MSYS flow used by the existing launcher one level above `client`:

```bat
cd "%~dp0client"
call setup.bat
bash pm3
```

With a fixed port, the equivalent manual startup from PowerShell is:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

The previous direct `proxmark3.exe` help/version attempts returned exit code 1 with no captured output. For this setup, those results should be treated as evidence that direct executable invocation is not a reliable primary launch path, not as proof that the Proxmark installation itself is broken.

No RFID write, clone, restore, simulation, or attack commands were executed.

## Captured Read-only Output Summary

The repository now contains fixtures from real local Proxmark output supplied for parser development. These are captured text outputs, not newly executed commands from this change.

- Startup banner: UART port `COM16`, target `PM3 GENERIC`.
- Client banner: `Iceman/master/v4.21611-321-gc7b95a94e 2026-05-31 00:48:46`.
- `hw version` client: `Iceman/master/v4.21611-321-gc7b95a94e-suspect 2026-05-31 00:48:46 9cb15bd3b`.
- Client compiler: `MinGW-w64 16.1.0`.
- Platform: `Windows (64b) / x86_64`.
- Firmware/model: `PM3 GENERIC`.
- ARM compiler: `GCC 13.3.0`.
- Flash usage: `73%`.
- Lua script support: `present`.
- Python script support: `absent`.

`hw tune` captured antenna values:

- LF 125.00 kHz: `20.21 V`, status `ok`.
- LF 134.83 kHz: `13.34 V`, status `ok`.
- LF optimal: `115.38 kHz` at `25.70 V`.
- HF 13.56 MHz: `36.28 V`, status `ok`.
- Parser rating: `OK`.

## Open Questions

- Is the Proxmark currently connected and visible in Device Manager?
- Which COM port is active now?
- What is the exact filename of the existing Batch launcher in `C:\Tools\proxmark3`?
- Does the Batch/MSYS flow expose a stable interactive console that can be automated safely, or should the GUI keep the operator in control for manual discovery?
- Should the app target Python 3.12 specifically even though Python 3.14.5 is currently installed?

## Recommended Implementation Steps

1. Model launch configuration with `client_setup_bash` as the recommended mode for this setup.
2. Capture real `hw version`, `hw tune`, `lf search`, and Hitag S output for parser fixtures.
3. Build a robust interactive Proxmark process adapter only after the Batch/MSYS console behavior has been tested with connected hardware.
4. Implement the Normal Mode UI around read-only discovery before enabling any write-gated workflow execution.
