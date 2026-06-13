# PM3 Workflow GUI

Authorized Windows-first workflow GUI for Proxmark3/Iceman provisioning work.

This project is not an RFID copier and does not bundle Proxmark3. It is intended to make approved, auditable Proxmark3 workflows understandable and repeatable for internal use.

## MVP scope

- Configure a local external `proxmark3.exe` path.
- Connect to a selected COM port.
- Run read-only hardware and transponder discovery.
- Read, store, plan writes for, and verify Hitag S256 profiles.
- Keep risk labels and audit-friendly logs around every workflow step.

Out of scope for v1: brute force, attacks, unauthorized access workflows, cloning framing, simulation, restore flows, and bundling Proxmark3/Iceman.

## Requirements

- Windows
- Python 3.12+ target runtime
- Separately installed Proxmark3/Iceman client

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .[dev]
.\.venv\Scripts\python -m pytest -q
```

No Proxmark3 source code or binaries should be committed to this repository.

