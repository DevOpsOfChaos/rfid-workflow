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

Current command discovery is incomplete because only `COM1` was visible through Windows serial-port enumeration. The expected Proxmark COM ports, previously COM16 or COM11, were not visible during this run. A later fixed `COM16` startup also failed when the device enumerated differently, so the default startup model must not force a port.

The corrected local startup model is Batch/MSYS based. The recommended mode for this system is `client_setup_bash`. Direct `proxmark3.exe` calls are still modeled as `direct_exe`, but for this installation they are not the reliable primary launch path.

Recommended auto-port startup:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Optional fixed-port debug startup:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

Port diagnosis:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
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
- `bash pm3 --list` for port diagnosis before an interactive session
- `hf search`
- `lf search`
- `lf hitag hts rdbl`
- `lf hitag hts dump`
- Help commands ending in `-h`, such as `lf hitag hts -h`

Captured `lf search` can include unrelated false-positive lines, such as Indala output, before the stable Hitag details. The parser treats false-positive notes separately and classifies the tag as a Hitag candidate when UID, TYPE/Chipset, and the `lf hitag hts` hint are present.

Captured Hitag S256 Plain workflow values:

- Original UID: `FA F9 91 79`.
- Blank UID: `D2 DF E4 94`.
- UID page 0 is read-only and must not be written in Normal Mode.
- Original config page 1: `C9 28 00 AA`.
- Blank-before config page 1: `C9 00 00 AA`.
- Written blank config page 1: `C9 28 00 AA`.
- Original/written pages 4-7 match: `FF F8 06 97`, `8C 66 C1 80`, `03 6E F7 00`, `00 00 00 00`.
- Manual cabinet test succeeded despite UID mismatch, so this specific cabinet apparently did not check only UID.

## Write Commands Requiring Workflow Gates

- `lf hitag hts wrbl`

## High-risk or Out-of-scope Command Families

- Config writes, especially page 1.
- Lock, crypto, password, authentication changes.
- Brute-force, attack, sniff, simulation, clone, and restore workflows.
- Do not enable crypto/authentication/password/lock options when the original is Plain/No Auth.
- Page 1 config belongs last in the planned write order after pages 4-7.

## Manual Startup for Discovery

Variant with the existing Batch launcher:

```powershell
cd C:\Tools\proxmark3
.\<NameDerStartdatei>.bat
```

Recommended variant through the client folder, using auto port detection:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3"
```

Forced COM port through the client folder, for debug only:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16"
```

List possible serial ports:

```powershell
cmd /k "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list"
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
