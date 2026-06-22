# Public Source Export

Public source exports are prepared from a fresh staging tree without private Git history.

Run from the private working repository:

```powershell
.\scripts\prepare-public-export.ps1 `
  -OutputPath <local-export-prefix> `
  -DenylistPath .\.public-audit-private-patterns.txt `
  -ManifestPath .\public-export-manifest.txt
```

The script creates a timestamped sibling directory outside the private repository, copies only files allowed by `public-export-manifest.txt`, runs `tools/public_repo_audit.py`, and writes a SHA-256 file manifest into the staging directory after the audit passes.

The export never copies `.git`, `.public-audit-private-patterns.txt`, runtime data, local data, templates, backups, audit output, logs, virtual environments, IDE folders, screenshots, media, dumps, keys, `.env` files, or build artifacts. It does not run `git init`, configure remotes, push, or write to GitHub.

If the audit finds private patterns, forbidden paths, local Windows paths, screenshots/media, dumps, keys, logs, backup/runtime data, or files outside the manifest, the script exits non-zero and marks the staging directory as failed.
