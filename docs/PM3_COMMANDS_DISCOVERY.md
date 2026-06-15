# PM3 Commands Discovery

Discovery date: 2026-06-13.

Configured Proxmark path checked:

- `C:\Tools\proxmark3`
- Client folder: `C:\Tools\proxmark3\client`
- Direct executable present during discovery: `C:\Tools\proxmark3\client\proxmark3.exe`

Local command help attempts:

- `proxmark3.exe -h`: exit code 1, no captured output.
- `proxmark3.exe --help`: exit code 1, no captured output.
- `proxmark3.exe COM1 -c "hw version"`: exit code 1, no captured output.

Current command discovery is incomplete because only `COM1` was visible through Windows serial-port enumeration. The expected Proxmark COM ports, previously COM16 or COM11, were not visible during this run.

The corrected local startup model is Batch/MSYS based. Direct `proxmark3.exe` calls are still modeled as `direct_exe`, but for this installation they are not the reliable primary launch path.

## Read-only Commands for MVP

- `hw version`
- `hw tune`
- `hf search`
- `lf search`
- `lf hitag hts rdbl`
- `lf hitag hts dump`
- Help commands ending in `-h`, such as `lf hitag hts -h`

## Write Commands Requiring Workflow Gates

- `lf hitag hts wrbl`

## High-risk or Out-of-scope Command Families

- Config writes, especially page 1.
- Lock, crypto, password, authentication changes.
- Brute-force, attack, sniff, simulation, clone, and restore workflows.

## Manual Startup for Discovery

Variant with the existing Batch launcher:

```powershell
cd C:\Tools\proxmark3
.\<NameDerStartdatei>.bat
```

Variant with a fixed COM port through the client folder:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

After the Proxmark menu opens, run these discovery/help commands manually:

```text
hw version
hw tune
hf search -h
lf search -h
lf hitag hts -h
lf hitag hts rdbl -h
lf hitag hts wrbl -h
lf hitag hts dump -h
```
