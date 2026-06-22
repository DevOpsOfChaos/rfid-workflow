# Public Export Audit

This repository is private until a separate public-export review is complete.

RFID Workflow requires a separately installed and flashed Proxmark3 setup. The app is a frontend for that local setup; it does not replace the Proxmark3 client or firmware.

## Workflow

1. Create a fresh staging directory outside runtime data folders.
2. Copy only files explicitly approved for public export into that staging directory.
3. Run the audit against the staging directory:

   ```powershell
   python tools/public_repo_audit.py C:\path\to\public-staging --private-patterns .public-audit-private-patterns.txt
   ```

4. Create a fresh clone of the intended public repository and run the audit there too:

   ```powershell
   python tools/public_repo_audit.py C:\path\to\fresh-public-clone --tracked --private-patterns .public-audit-private-patterns.txt
   ```

5. Create a future public-import commit only after both audits return exit code `0`.

## Exit Codes

`0` means no findings.

`1` means findings or forbidden files were detected.

`2` means invalid arguments or an audit failure.

The audit only reports. It does not delete files, rewrite history, clean directories, or modify the target.
