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

The corrected local startup model is Batch/MSYS based. The recommended mode for this system is `client_setup_bash`. Direct `proxmark3.exe` calls are still modeled as `direct_exe`, but for this installation they are not the reliable primary launch path.

Working fixed-port startup:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

## Captured Read-only Values

Captured startup and `hw version` output show:

- UART port: `COM16`.
- Target/firmware: `PM3 GENERIC`.
- Client: `Iceman/master/v4.21611-321-gc7b95a94e-suspect 2026-05-31 00:48:46 9cb15bd3b`.
- Client compiler: `MinGW-w64 16.1.0`.
- Platform: `Windows (64b) / x86_64`.
- Bootrom: `Iceman/master/v4.21611-321-gc7b95a94e-suspect 2026-05-31 00:47:41 9cb15bd3b`.
- OS: `Iceman/master/v4.21611-321-gc7b95a94e-suspect 2026-05-31 00:47:52 9cb15bd3b`.
- ARM compiler: `GCC 13.3.0`.
- Flash usage: `73%`.
- Lua script support: `present`.
- Python script support: `absent`.

Captured `hw tune` output:

- LF 125.00 kHz: `20.21 V`, ok.
- LF 134.83 kHz: `13.34 V`, ok.
- LF optimal: `115.38 kHz`, `25.70 V`.
- LF frequency bandwidth: `6.2`.
- LF peak voltage: `7.5`.
- HF 13.56 MHz: `36.28 V`, ok.
- HF peak voltage: `10.5`.
- Parser antenna rating: `OK`.

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
