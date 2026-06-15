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

Expected previous Proxmark ports `COM16` or `COM11` were not visible during the original automated enumeration. Later manual use showed that a fixed `COM16` startup can fail when the device enumerates differently, so the recommended path no longer forces a COM port.

## Proxmark Client Discovery

`proxmark3.exe` exists, but the user's installation is not primarily started by calling `proxmark3.exe COMx` directly. The corrected startup path is the Batch/MSYS flow used by the existing launcher one level above `client`:

```bat
cd "%~dp0client"
call setup.bat
bash pm3
```

The recommended manual startup from PowerShell lets the Proxmark script auto-detect the port:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Forced-port startup remains useful only as a debug override:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

For port diagnosis, use the client script list mode:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
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

## Captured Hitag S256 Workflow Fixtures

Additional supplied fixtures document a successful manual workflow on an owned cabinet tag and blank. These are captured outputs and notes, not commands executed by this change.

Original tag:

- Type: `Hitag S 256`.
- UID: `FA F9 91 79`.
- Plain/No Auth, config unlocked, key/PWD unlocked.
- TTF: Manchester, `2 kBit`, pages 4-7.
- Config page 1: `C9 28 00 AA`.
- Data pages 4-7: `FF F8 06 97`, `8C 66 C1 80`, `03 6E F7 00`, `00 00 00 00`.

Blank before writing:

- UID: `D2 DF E4 94`.
- Config page 1: `C9 00 00 AA`.
- TTF mode disabled / RTF mode, `4 kBit`.
- Page 7 marker: `57 5F 4F 4B`.

Blank after the manual workflow:

- UID remained `D2 DF E4 94`.
- Config page 1 matched original: `C9 28 00 AA`.
- Pages 4-7 matched original.
- TTF mode matched original: pages 4-7 at `2 kBit`.
- The blank was manually tested successfully at the owned cabinet.

Conclusion for this one workflow: page 0 UID is read-only and was not copied. The successful test despite UID mismatch indicates this specific cabinet did not rely exclusively on the UID. That is not a universal claim about other locks.

## Read-only Facade and CLI

The repository now includes a read-only discovery facade for UI and CLI callers. It parses fixture or future session text consistently and emits a UI-shaped summary with:

- connected state, launch mode, COM port, target, client version, and firmware
- LF/HF antenna status
- discovery data status
- tag frequency and type guesses
- risk notes
- recommended next manual step
- optional profile verification status

Hardware and Help/Capability output are deliberately not treated as tag discovery. `hw tune` can prove antenna status, and `hf search -h`/`lf search -h`/`lf hitag hts` can prove command availability, but those outputs do not prove that an HF or LF tag was present. A help-only hardware log must remain `Discovery data: not captured`, `Tag frequency: unknown`, and `Tag type: unknown`.

Tag-type statements require real discovery or read evidence: `hf search`, `lf search`, `lf search -u`, or read output such as `lf hitag hts rdbl -p 0 -c 8`.

The fixture CLI is:

```powershell
python -m pm3_workflow_gui.cli fixture-summary --fixture-dir tests/fixtures/pm3
```

Scenario and log CLIs are:

```powershell
python -m pm3_workflow_gui.cli scenario-summary --scenario tests/fixtures/scenarios/hitag_s256_original_discovery.json
python -m pm3_workflow_gui.cli log-summary --log tests/fixtures/pm3/session_log_discovery_sample.txt
python -m pm3_workflow_gui.cli latest-log-summary --log-dir "C:\Tools\proxmark3\client\.proxmark3\logs"
```

This CLI is not hardware automation. It reads fixture files, scenario files, or existing PM3 logs and does not run Proxmark commands.

## Capture Providers

The supported read-only sources are now:

- Fixtures from `tests/fixtures/pm3`.
- Scenario JSON bundles from `tests/fixtures/scenarios`.
- Manual text blocks supplied by a caller.
- Existing Proxmark session logs from `C:\Tools\proxmark3\client\.proxmark3\logs`.

`InteractivePm3Provider` remains a stub. Live automation through Windows `cmd`, MSYS setup, bash, and the Proxmark interactive client is a separate engineering problem and is intentionally not forced in this phase.

## Open Questions

- Is the Proxmark currently connected and visible in Device Manager?
- Which COM port is active now?
- What is the exact filename of the existing Batch launcher in `C:\Tools\proxmark3`?
- Does the Batch/MSYS flow expose a stable interactive console that can be automated safely, or should the GUI keep the operator in control for manual discovery?
- Should the app target Python 3.12 specifically even though Python 3.14.5 is currently installed?

## Recommended Implementation Steps

1. Model launch configuration with `client_setup_bash` and `com_port=None` as the recommended auto-detect mode for this setup.
2. Capture real `hw version`, `hw tune`, `lf search`, and Hitag S output for parser fixtures.
3. Keep future UI code behind `services.discovery_facade` instead of calling parsers directly.
4. Use log summaries to validate real manual discovery sessions before adding live process control.
5. Build a robust interactive Proxmark process adapter only after the Batch/MSYS console behavior has been tested with connected hardware.
6. Implement the Normal Mode UI around read-only discovery before enabling any write-gated workflow execution.
