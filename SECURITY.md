# Security And Public Release Checklist

Before publishing or sending this repository, run:

```powershell
git status --short
.\.venv-gui\Scripts\python.exe tools\public_repo_audit.py . --tracked
git ls-files *.key *.pem *.pfx *.p12 *.crt *.cer *.der .env .env.* id_rsa id_dsa id_ecdsa id_ed25519
```

The last command must print nothing.

Never commit:

- RFID dump files, real customer chip data, backups, templates, or logs
- `.env` files
- private keys, certificates, signing files, or SSH keys
- local Proxmark binaries, firmware, ProxSpace folders, or downloaded archives

Use `.public-audit-private-patterns.txt` locally for customer names, real UIDs,
site names, and internal paths that must block export. That file is ignored and
must stay uncommitted.
