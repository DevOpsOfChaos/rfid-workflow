# PM3 Workflow GUI

Authorized Windows-first workflow GUI for Proxmark3/Iceman provisioning work.

This project is not an RFID copier and does not bundle Proxmark3. It is intended to make approved, auditable Proxmark3 workflows understandable and repeatable for internal use.

## MVP scope

- Configure a local external Proxmark3/Iceman installation and launch mode.
- Use the local PM3 wrapper auto-port detection; do not require COM16.
- Run read-only hardware and transponder discovery.
- Read, store, plan writes for, and verify Hitag S256 profiles.
- Keep risk labels and audit-friendly logs around every workflow step.

Out of scope for v1: brute force, attacks, unauthorized access workflows, cloning framing, simulation, restore flows, and bundling Proxmark3/Iceman.

## Requirements

- Windows
- Python 3.12+ target runtime
- Separately installed Proxmark3/Iceman client

## Proxmark launch modes

This repository now models multiple Windows launch modes because local
Proxmark installations are not all started the same way.

- `client_setup_bash` (recommended for the current setup): start from
  `C:\Tools\proxmark3\client`, run `setup.bat`, then run `bash pm3` and let
  the Proxmark script auto-detect the port. In config terms this is
  `com_port=None`.
- `client_setup_bash` with `com_port="COM16"`: same startup path, but forced
  with `bash pm3 -p COM16`. This is a debug override, not the default.
- `proxspace_bat`: start an existing `.bat`/`.cmd` launcher from the
  Proxmark root, for example from `C:\Tools\proxmark3`.
- `direct_exe`: direct executable startup such as
  `C:\Tools\proxmark3\client\proxmark3.exe COM16`.

For the current installation, direct `proxmark3.exe` calls are not considered
the reliable primary startup path. The supported path to test manually is the
Batch/MSYS flow with auto port detection:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Optional forced-port debug startup:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

Port diagnosis, without starting a tag workflow:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
```

The live path uses the local PM3 wrapper for auto-port detection. It does not
force COM16. If no PM3 is found, the GUI shows a full-window USB reconnect
message and keeps it visible until `bash pm3 --list` reports a device again.

Captured discovery fixtures currently cover:

- Startup banner on `COM16`, target `PM3 GENERIC`.
- `hw version` for Iceman `v4.21611-321-gc7b95a94e-suspect`.
- `hw tune` with LF 125 kHz `20.21 V`, LF 134.83 kHz `13.34 V`, and HF
  13.56 MHz `36.28 V`; parsed antenna rating is `OK`.
- Help output for `hf search`, `lf search`, and `lf hitag hts` read/write/dump
  command families.
- LF Hitag S256 detection and `lf hitag hts rdbl` captures for the original
  tag, a blank before writing, and the same blank after the manual workflow.

The known manual workflow showed that the original UID `FA F9 91 79` and blank
UID `D2 DF E4 94` differ. Page 0 is read-only and Normal Mode must not try to
write it. The successful cabinet test despite the UID difference means this
specific cabinet did not rely exclusively on UID matching. It does not prove
that other systems behave the same way.

No hardware write operation is implemented or executed by the test suite.

## Fixture CLI

The read-only facade can be exercised from fixtures without touching hardware:

```powershell
python -m pm3_workflow_gui.cli fixture-summary --fixture-dir tests/fixtures/pm3
```

The CLI reports launch mode, COM port, PM3 target/client, antenna status, tag
guess, discovery-data status, verification state, and the recommended next
manual step. It is a parser and service diagnostic only; it does not communicate
with the Proxmark client.

Hardware and help output are not tag detection. `hw tune` can show that the
antennas look OK, and `hf search -h` / `lf search -h` can show command
availability, but only real `hf search`, `lf search`, `lf search -u`, or
read output such as `lf hitag hts rdbl -p 0 -c 8` can support tag frequency or
tag type guesses.

Scenario bundles live under `tests/fixtures/scenarios/` and can be loaded with:

```powershell
python -m pm3_workflow_gui.cli scenario-summary --scenario tests/fixtures/scenarios/hitag_s256_original_discovery.json
```

Existing PM3 session logs can be summarized without running Proxmark:

```powershell
python -m pm3_workflow_gui.cli log-summary --log tests/fixtures/pm3/session_log_discovery_sample.txt
python -m pm3_workflow_gui.cli latest-log-summary --log-dir "C:\Tools\proxmark3\client\.proxmark3\logs"
```

Safe live read-only scan:

```powershell
python -m pm3_workflow_gui.cli live-scan
```

The live scan runs only these allowlisted commands through the PM3 wrapper:
`hw version`, `hw tune`, `hf search`, and `lf search`. It is not a Proxmark
terminal and it does not accept arbitrary command text.

## Read-only GUI MVP

The GUI is a read-only viewer over the same capture providers and facade:

```powershell
python -m pm3_workflow_gui.ui.app
```

Install PySide6 only in a local GUI venv, not globally:

```powershell
py -3.14 -m venv .venv-gui
.\.venv-gui\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install PySide6
python -m pm3_workflow_gui.ui.app
```

The GUI can load demo scenarios, open an existing PM3 log, load the latest PM3
log, or run `Scan NFC/RFID tag` through the safe live read-only service. It has
no write functions and no free command input.

Run these CLI commands from a separate PowerShell, not inside the interactive
PM3 console. If host commands such as `cd ...`, `py ...`, `python ...`,
`powershell ...`, or `cmd ...` accidentally appear after a PM3 prompt, the log
capture marks them as ignored host commands and keeps them out of PM3 discovery
results.

Targeted Hitag reads can be valid without a full `hw tune` / `hf search` /
`lf search` sequence. `lf hitag hts reader -@` with UID lines is treated as
Hitag/LF candidate evidence; `lf hitag hts rdbl -p 0 -c 8` is still required
before the summary reports `Hitag S256 Plain`.

The log summary also models unstable Windows/MSYS/USB-CDC sessions. If a log
contains errors such as `UID Request failed!`, `timeout while waiting for
reply`, `Failed to get current device debug level`, or `Communicating with
Proxmark3 device failed`, the facade reports a session state instead of
pretending discovery succeeded. `device_lost` means the app must stop workflow
progress and tell the operator to reconnect USB and restart the PM3 session.

The GUI does not automate an interactive PM3 terminal. Live scan uses short,
separate, allowlisted read-only commands via `bash pm3 -c ...`.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\python -m pytest -q
```

No Proxmark3 source code or binaries should be committed to this repository.
