# PM3 Workflow GUI

Authorized Windows-first workflow GUI for Proxmark3/Iceman provisioning work.

This project is not an RFID copier and does not bundle Proxmark3. It is intended to make approved, auditable Proxmark3 workflows understandable and repeatable for internal use.

## MVP scope

- Configure a local external Proxmark3/Iceman installation and launch mode.
- Connect to a selected COM port.
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
  `C:\Tools\proxmark3\client`, run `setup.bat`, then run `bash pm3 -p COM16`
  or `bash pm3 -p COM11`.
- `proxspace_bat`: start an existing `.bat`/`.cmd` launcher from the
  Proxmark root, for example from `C:\Tools\proxmark3`.
- `direct_exe`: direct executable startup such as
  `C:\Tools\proxmark3\client\proxmark3.exe COM16`.

For the current installation, direct `proxmark3.exe` calls are not considered
the reliable primary startup path. The supported path to test manually is the
Batch/MSYS flow:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

The code currently prepares launch configuration and diagnostic command
rendering plus parsers for captured read-only Proxmark output. It does not
claim robust automation of the interactive Proxmark shell.

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
guess, verification state, and the recommended next manual step. It is a parser
and service diagnostic only; it does not communicate with the Proxmark client.

Scenario bundles live under `tests/fixtures/scenarios/` and can be loaded with:

```powershell
python -m pm3_workflow_gui.cli scenario-summary --scenario tests/fixtures/scenarios/hitag_s256_original_discovery.json
```

Existing PM3 session logs can be summarized without running Proxmark:

```powershell
python -m pm3_workflow_gui.cli log-summary --log tests/fixtures/pm3/session_log_discovery_sample.txt
python -m pm3_workflow_gui.cli latest-log-summary --log-dir "C:\Tools\proxmark3\client\.proxmark3\logs"
```

Interactive PM3 automation is intentionally not implemented yet. Windows,
MSYS, bash, and Proxmark TTY behavior need separate testing before the app
should drive a live session.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\python -m pytest -q
```

No Proxmark3 source code or binaries should be committed to this repository.
