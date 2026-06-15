# CLI Usage

The CLI is currently read-only. It validates parser, profile, capture-provider, and discovery-service behavior without executing hardware commands.

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
python -m pm3_workflow_gui.cli scenario-summary --scenario tests/fixtures/scenarios/hitag_s256_blank_after_write.json
```

Available scenarios:

- `hitag_s256_original_discovery.json`
- `hitag_s256_blank_before_write.json`
- `hitag_s256_blank_after_write.json`

## Log Summary

Summarize an existing Proxmark session log:

```powershell
python -m pm3_workflow_gui.cli log-summary --log tests/fixtures/pm3/session_log_discovery_sample.txt
```

Summarize the newest `.txt` log in a directory:

```powershell
python -m pm3_workflow_gui.cli latest-log-summary --log-dir "C:\Tools\proxmark3\client\.proxmark3\logs"
```

To create a useful manual log, start Proxmark with the supported local path:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

Then run read-only discovery commands such as:

```text
hw version
hw tune
hf search -h
lf search -h
lf search
lf hitag hts
lf hitag hts rdbl -p 0 -c 8
```

Session logs are typically under:

```text
C:\Tools\proxmark3\client\.proxmark3\logs
```

The log parser looks for prompt lines like `[usb] pm3 --> hw version`, excludes those prompt lines from output, stores repeated commands, and reports missing sections instead of failing.

The CLI does not start `bash pm3`, does not open a live interactive session, and does not execute write commands. Write execution remains deliberately blocked.
