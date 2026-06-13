# Architecture

## External Proxmark Process

The GUI uses a user-selected external `proxmark3.exe`. The repository must not copy Proxmark3 binaries, source, scripts, or firmware.

## Session Layer

`pm3.session` validates the configured executable and owns process execution. The current scaffold supports conservative single-command execution. A future Windows adapter may need a persistent process if Proxmark3 interactive behavior is more reliable than `-c` invocations.

## Command and Risk Layer

`pm3.commands` stores known command definitions. `pm3.risk` classifies commands into read-only, write, high-risk configuration, lock/crypto, and attack/brute-force categories.

## Parser Layer

`pm3.parsers` extracts stable data from Proxmark output. Parsers must be tested against real captured output before being trusted in write-gated workflows.

## Workflow Layer

`workflows.hitag_s256` builds safe workflow plans. The initial implementation deliberately returns planned steps instead of executing writes.

## Profile Layer

`profiles.schema` defines structured JSON-compatible profiles and write rules. Profiles should store the data and the policy needed to decide what may be written.

## UI Layer

The future PySide6 UI should expose Normal Mode first. Expert Mode belongs behind a later explicit scope decision.

## Audit and Logs

Audit logging should record executable path, command, timestamp, risk level, operator action, return code, parsed result, and verification outcome.

