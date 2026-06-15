# Architecture

## External Proxmark Process

The GUI uses a user-selected external Proxmark3/Iceman installation. The repository must not copy Proxmark3 binaries, source, scripts, or firmware.

The current target setup is rooted at `C:\Tools\proxmark3` with client files in `C:\Tools\proxmark3\client`. It starts through a Batch/MSYS flow: change into `client`, call `setup.bat`, then run `bash pm3`. With a fixed port the command is:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

Direct `proxmark3.exe COMx` startup remains modeled for installations where it works, but it is not the reliable primary path for this setup.

## Session Layer

`pm3.session` owns launch configuration and conservative process execution boundaries. `Pm3LaunchConfig` models these startup modes:

- `direct_exe`: direct executable startup, for example `proxmark3.exe COM16`.
- `proxspace_bat`: existing ProxSpace/Proxmark Batch launcher in the Proxmark root.
- `client_setup_bash`: `cmd.exe /k "cd /d <client_dir> && call setup.bat && bash pm3 -p <COM>"`.

For the current installation, `client_setup_bash` is the recommended mode. The existing `ProxmarkSession` class is only a small non-interactive wrapper for direct `proxmark3.exe` execution. It should not be stretched to pretend it can robustly automate an interactive MSYS shell without a tested adapter.

The first read-only discovery foundation is parser-first. The project stores captured command output under `tests/fixtures/pm3/` and parses it into structured values. This avoids claiming a stable interactive automation layer before the Batch/MSYS console behavior has been tested directly.

## Command and Risk Layer

`pm3.commands` stores known command definitions. `pm3.risk` classifies commands into read-only, write, high-risk configuration, lock/crypto, and attack/brute-force categories.

## Parser Layer

`pm3.parsers` extracts stable data from Proxmark output. Parsers must be tested against real captured output before being trusted in write-gated workflows.

Current parser coverage:

- Startup banner: COM port, target, client, bootrom, and OS versions.
- `hw version`: client compiler/platform, firmware/model, ARM versions, flash usage, Lua support, and Python script support.
- `hw tune`: LF/HF voltages, peak values, antenna status, and a simple `OK`/`WARN`/`FAIL` rating.
- Command help: usage line, option lines, and registry-backed risk level.

## Workflow Layer

`workflows.hitag_s256` builds safe workflow plans. The initial implementation deliberately returns planned steps instead of executing writes.

## Profile Layer

`profiles.schema` defines structured JSON-compatible profiles and write rules. Profiles should store the data and the policy needed to decide what may be written.

## UI Layer

The future PySide6 UI should expose Normal Mode first. Expert Mode belongs behind a later explicit scope decision. PySide6 was not installed or tested as part of the parser/discovery fixture work; with Python 3.14.5 on this machine, UI dependency work should be isolated in a virtual environment instead of checked globally.

## Audit and Logs

Audit logging should record launch mode, planned start command, command, timestamp, risk level, operator action, return code, parsed result, and verification outcome.
