# PM3 Graph Viewer Local Test

Date: 2026-06-21

Environment:

- PM3 client: `C:\Tools\proxmark3\client\proxmark3.exe`
- Detected port: `COM16`
- Client reports `QT GUI support............ present`

Wrapper check:

```powershell
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --list'
```

Result:

```text
1: COM16
```

The wrapper help path is not usable on this host:

```powershell
cmd /c "cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 --help"
```

Result:

```text
pm3: line 255: cat: command not found
```

Help commands tested through the working direct client path:

```powershell
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && proxmark3.exe -c "data plot --help"'
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && proxmark3.exe -c "hw tune --help"'
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && proxmark3.exe -c "lf read --help"'
```

Safe graph candidates tested on `COM16`:

```powershell
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && proxmark3.exe COM16 -c "hw tune"'
cmd /c 'cd /d C:\Tools\proxmark3\client && call setup.bat && proxmark3.exe COM16 -c "lf read;data plot"'
```

Observed results:

- `hw tune` measured LF/HF antenna characteristics and printed LF tuning graph text.
- `lf read;data plot` captured `38503` samples and executed `data plot`.
- Process/window polling found no durable separate PM3/Qt graph window after either command.
- The test used only the registered graph/read commands and no free PM3 shell.

Required status:

```text
funktionierender_befehl: none confirmed for a durable separate PM3/Qt graph window
vorheriger_messbefehl: lf read
startmethode: proxmark3.exe COM16 -c "lf read;data plot"
öffnet_separates_fenster: nein
```

GUI behavior:

- The graph launcher service exists with a fixed read-only allowlist.
- The GUI keeps `Frequenzdiagramm öffnen` disabled until a local workflow is explicitly marked as confirmed.
- The GUI does not fake a plot and does not show simulated measurements.
