# RFID Workflow

RFID Workflow is an independent Windows desktop frontend for authorized RFID
and NFC work with a locally installed RRG/Iceman Proxmark3 setup. It provides
guided, safety-oriented workflows around selected Proxmark3 operations instead
of exposing a general-purpose Proxmark terminal.

Project status: development preview.

The application source is public. Release artifacts are not available yet.

RFID Workflow is an independent desktop frontend for a locally installed
RRG/Iceman Proxmark3 setup. It is not affiliated with or endorsed by
RfidResearchGroup.

## Current Scope

- Configure a local external Proxmark3/Iceman installation and launch mode.
- Use the local PM3 wrapper auto-port detection by default.
- Run read-only hardware and transponder discovery.
- Exercise parser, facade, and UI flows from synthetic fixtures.
- Summarize existing PM3 logs without running Proxmark.
- Provide a read-only GUI MVP over the same capture providers and facade.
- Model Hitag S256 read, planning, and verification logic from synthetic fixtures.

Out of scope for the current preview: brute force, attacks, unauthorized access
workflows, cloning framing, simulation, restore flows, bundling Proxmark3/Iceman,
or executing real hardware write operations.

## Requirements

- Windows
- Python 3.12 or newer
- Separately installed RRG/Iceman Proxmark3 client for live read-only scans

## CLI Usage

The fixture-backed facade can be exercised without touching hardware:

```powershell
python -m pm3_workflow_gui.cli fixture-summary --fixture-dir tests/fixtures/pm3
```

Scenario bundles can be loaded from `tests/fixtures/scenarios/`:

```powershell
python -m pm3_workflow_gui.cli scenario-summary --scenario tests/fixtures/scenarios/hitag_s256_original_discovery.json
```

Existing PM3 session logs can be summarized without running Proxmark:

```powershell
python -m pm3_workflow_gui.cli log-summary --log tests/fixtures/pm3/session_log_discovery_sample.txt
```

The live read-only scan path runs only allowlisted commands through the PM3
wrapper: `hw version`, `hw tune`, `hf search`, and `lf search`. It is not a
Proxmark terminal and it does not accept arbitrary command text.

```powershell
python -m pm3_workflow_gui.cli live-scan
```

## GUI Preview

The GUI can be launched as a read-only viewer over the same capture providers:

```powershell
python -m pm3_workflow_gui.ui.app
```

Install optional GUI dependencies only in a local virtual environment:

```powershell
python -m venv .venv-gui
.\.venv-gui\Scripts\python -m pip install --upgrade pip
.\.venv-gui\Scripts\python -m pip install -e .[gui]
.\.venv-gui\Scripts\python -m pm3_workflow_gui.ui.app
```

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\python -m pytest -q
```

No Proxmark3 source code, firmware, binaries, local runtime data, real
RFID/NFC templates, dumps, keys, screenshots, logs, or private configuration
belong in this repository.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [CLI usage](docs/CLI_USAGE.md)
- [Windows installation](docs/INSTALL_WINDOWS.md)
- [First-run flow](docs/FIRST_RUN.md)
- [PM3 setup and flashing](docs/PM3_SETUP_AND_FLASHING.md)
- [Compatibility matrix](docs/COMPATIBILITY.md)
- [Supported technologies](docs/SUPPORTED_TECHNOLOGIES.md)
- [Hitag S256 workflow](docs/HITAG_S256_WORKFLOW.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Public repository audit](docs/PUBLIC_REPOSITORY_AUDIT.md)

## License

RFID Workflow is licensed under the [MIT License](LICENSE).
