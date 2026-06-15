# Architecture

## External Proxmark Process

The GUI uses a user-selected external Proxmark3/Iceman installation. The repository must not copy Proxmark3 binaries, source, scripts, or firmware.

The current target setup is rooted at `C:\Tools\proxmark3` with client files in `C:\Tools\proxmark3\client`. It starts through a Batch/MSYS flow: change into `client`, call `setup.bat`, then run `bash pm3`. Auto port detection is the recommended default:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

A forced port remains a debug override only:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

Port diagnosis is modeled as read-only:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
```

Direct `proxmark3.exe COMx` startup remains modeled for installations where it works, but it is not the reliable primary path for this setup.

## Session Layer

`pm3.session` owns launch configuration and conservative process execution boundaries. `Pm3LaunchConfig` models these startup modes:

- `direct_exe`: direct executable startup, for example `proxmark3.exe COM16`.
- `proxspace_bat`: existing ProxSpace/Proxmark Batch launcher in the Proxmark root.
- `client_setup_bash`: `cmd.exe /k "cd /d <client_dir> && call setup.bat && bash pm3"` when `com_port=None`, letting the Proxmark script auto-detect the port.
- `client_setup_bash` with `com_port="COMx"`: `cmd.exe /k "cd /d <client_dir> && call setup.bat && bash pm3 -p <COMx>"`, a forced-port debug override.

For the current installation, `client_setup_bash` is the recommended mode. The existing `ProxmarkSession` class is only a small non-interactive wrapper for direct `proxmark3.exe` execution. It should not be stretched to pretend it can robustly automate an interactive MSYS shell without a tested adapter.

The first read-only discovery foundation is parser-first. The project stores captured command output under `tests/fixtures/pm3/` and parses it into structured values. This avoids claiming a stable interactive automation layer before the Batch/MSYS console behavior has been tested directly.

## Service Facade Layer

`services.discovery_facade` is the stable boundary for future UI code. It accepts raw text from fixtures now and can accept captured session output later. The facade owns the orchestration across parser, profile, and workflow modules and returns `UiDiscoverySummary` fields that are already shaped for display:

- connection state, launch mode, COM port, target, client, and firmware
- LF/HF antenna status
- tag frequency/type guesses
- verification status when a reference profile is supplied
- short risk notes and the recommended next manual step

The future PySide6 GUI should call this service layer. It should not directly run parser regexes or construct Proxmark command strings.

## Capture Provider Layer

`services.capture` defines read-only sources that all feed `DiscoveryFacade`:

- `FixtureCaptureProvider`: loads either the default fixture directory or a scenario JSON.
- `ManualTextCaptureProvider`: accepts already pasted text blocks from a caller.
- `Pm3LogCaptureProvider`: reads an existing Proxmark session log and extracts command outputs.
- `InteractivePm3Provider`: stub only. It documents the future boundary for live PM3 capture but does not start processes.

Log splitting is defensive. Prompt lines like `[usb] pm3 --> hw version` start a new section, the prompt line is excluded from captured output, command text is normalized for lookup, and repeated commands are stored as multiple captures with latest-output helpers. Incomplete logs are allowed; missing sections are reported instead of crashing.

Capture also classifies command context. Hardware/status commands (`hw version`, `hw tune`) are separate from Help/Capability commands (`hf search -h`, `lf search -h`, `lf hitag hts`, and Hitag help variants), real Discovery commands (`hf search`, `lf search`, `lf search -u`), and real Read commands such as `lf hitag hts rdbl -p 0 -c 8`. This prevents a help-only log from being treated as evidence that an LF tag was found.

Interactive Windows automation is deliberately deferred. The current setup enters MSYS/bash through `setup.bat` and `bash pm3`, so a robust adapter needs explicit TTY testing. Pretending `subprocess` is enough would produce fragile behavior.

## Command and Risk Layer

`pm3.commands` stores known command definitions. `pm3.risk` classifies commands into read-only, write, high-risk configuration, lock/crypto, and attack/brute-force categories.

## Parser Layer

`pm3.parsers` extracts stable data from Proxmark output. Parsers must be tested against real captured output before being trusted in write-gated workflows.

Current parser coverage:

- Startup banner: COM port, target, client, bootrom, and OS versions.
- `hw version`: client compiler/platform, firmware/model, ARM versions, flash usage, Lua support, and Python script support.
- `hw tune`: LF/HF voltages, peak values, antenna status, and a simple `OK`/`WARN`/`FAIL` rating.
- Command help: usage line, option lines, and registry-backed risk level.
- `hf search`: no-tag/unsupported/unknown status.
- `lf search`: UID, type, chipset, hint, and false-positive notes. Hitag hints are preserved even when Indala false-positive lines are present.
- `lf hitag hts rdbl`: Hitag S tag information, compact page data, UID page, config page, permissions, and Plain/No Auth Hitag S256 detection.

Help output is parsed only as capability information. Hardware OK means antenna health, not tag detection. Tag frequency and type guesses require real `hf search`/`lf search` discovery output or a real read output.

## Workflow Layer

`workflows.hitag_s256` builds safe workflow plans and verifies parsed reads against a profile. The implementation deliberately returns planned steps instead of executing writes.

Verification rules:

- Page 0 UID is stored but not written.
- UID mismatch is not fatal when all non-UID profile pages match.
- Pages 1-7 are verified for the known profile; at minimum page 1 config and pages 4-7 must match.
- Page 1 config is treated as high risk and is planned last.
- Crypto, password, lock, restore, simulation, clone, brute-force, and autopwn flows are not automatically enabled.

`workflows.discovery` is a read-only aggregation layer. It combines launch configuration and parser outputs into a summary such as `Hitag S256 Plain tag detected` plus the next recommended manual step. It does not automate the interactive Proxmark shell.

## Profile Layer

`profiles.schema` defines structured JSON-compatible profiles and write rules. Profiles store the data and the policy needed to decide what may be written: `write_uid=false`, `write_config_last=true`, and the default known write order `(4, 5, 6, 7, 1)`.

## UI Layer

The future PySide6 UI should expose Normal Mode first. Expert Mode belongs behind a later explicit scope decision. PySide6 was not installed or tested as part of the parser/discovery fixture work; with Python 3.14.5 on this machine, UI dependency work should be isolated in a virtual environment instead of checked globally.

No PySide6 dependency is installed by this phase. Installing GUI dependencies against global Python 3.14.5 would be premature; the facade gives the GUI a stable target for the next isolated venv step.

## Audit and Logs

Audit logging should record launch mode, planned start command, command, timestamp, risk level, operator action, return code, parsed result, and verification outcome.
