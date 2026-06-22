# Technical Integrity

This project is a PM3 frontend for owned or otherwise authorized RFID/NFC transponders.

Core workflow rules:

- Read before every real change when the adapter can read the target.
- Execute one targeted operation at a time.
- Read again after the operation.
- Verify the expected value.
- Stop on mismatch, missing data, unstable signal, or device loss.
- Keep templates, dumps, backups, and audit records separate.
- Do not print keys, passwords, or other access data in normal status messages.

Capabilities are declared per technology and per concrete chip state. The UI should describe technical availability, for example `hardwareseitig nicht schreibbar`, `benötigt bekannte Zugangsdaten`, or `für diesen Chiptyp wurde noch kein Adapter implementiert`.

The normal UI does not expose a free PM3 terminal. Expert mode exposes registered tools with controlled parameters and technical details.
