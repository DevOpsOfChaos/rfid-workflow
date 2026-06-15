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

To create a useful manual log, start Proxmark with the supported local path. The default is auto port detection:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Use a forced port only as an expert/debug override:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

If the port is unclear or a forced port fails, list possible serial ports:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
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

The CLI reports session health before tag guesses. A lost Windows/MSYS/USB-CDC
session is surfaced as:

```text
Session status: device_lost
Reconnect required: yes
Last error: Communicating with Proxmark3 device failed
Next step: Reconnect USB and restart PM3 session
```

After `device_lost`, callers must not continue discovery or read workflows in
the same session. The practical recovery is to unplug/replug USB briefly and
restart PM3 with the auto-port command.

Help and hardware logs are not tag discovery. `hw version` can show that the client is reachable, and `hw tune` can show LF/HF antenna status, but neither means a tag was present or detected. Capability commands such as `hf search -h`, `lf search -h`, `lf hitag hts`, `lf hitag hts rdbl -h`, `lf hitag hts wrbl -h`, and `lf hitag hts dump -h` are kept separate from real discovery commands.

If a log contains only hardware and help output, the CLI reports:

```text
Discovery data: not captured
Tag frequency: unknown
Tag type: unknown
Next step: Run hf search and lf search with the tag present
```

Only real `hf search`, `lf search`, `lf search -u`, or read output such as `lf hitag hts rdbl -p 0 -c 8` can support tag frequency/type guesses.

The CLI does not start `bash pm3`, does not open a live interactive session, and does not execute write commands. Write execution remains deliberately blocked.
