# CLI Usage

The CLI is currently fixture-only. It is for validating parser, profile, and discovery-service behavior without hardware access.

## Fixture Summary

```powershell
python -m pm3_workflow_gui.cli fixture-summary --fixture-dir tests/fixtures/pm3
```

This loads the default COM16 discovery fixture set and prints a compact summary:

- launch mode and COM port
- PM3 target/client/firmware
- LF/HF antenna status
- tag frequency and type guesses
- verification status when available
- recommended next manual step
- risk notes

Scenario JSON files can also be used:

```powershell
python -m pm3_workflow_gui.cli fixture-summary --scenario tests/fixtures/scenarios/hitag_s256_blank_after_write.json
```

Available scenarios:

- `hitag_s256_original_discovery.json`
- `hitag_s256_blank_before_write.json`
- `hitag_s256_blank_after_write.json`

The CLI does not communicate with Proxmark3, does not start `bash pm3`, and does not execute write commands. Write execution remains deliberately blocked.
