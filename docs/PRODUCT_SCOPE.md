# Product Scope

## Phase 1 Normal Mode

- Select local `proxmark3.exe`.
- Select or detect COM port.
- Run `hw version`, `hw tune`, `hf search`, and `lf search`.
- Present antenna and detection results in plain language.
- Read Hitag S256 profiles and save JSON profiles with write rules.
- Plan profile writes for compatible blanks.
- Verify after every planned future write step.
- Save an operator-readable result log.

## Later Scope

- Structured command browser.
- Terminal panel.
- Script runner.
- Risk labels for broader command coverage.
- Audit-log persistence, likely JSONL first and SQLite once query needs are real.

## Explicitly Out of Scope for MVP

- Bundling Proxmark3.
- General RFID copying UX.
- Attack workflows.
- Brute-force workflows.
- Simulation or restore workflows.

