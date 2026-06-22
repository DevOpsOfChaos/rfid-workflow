# Backups and Templates

The future application is intended to manage templates and backups locally. This repository must never contain real examples of either.

## Local-only principle

Templates, backups, comparisons, and audit information are expected to remain in local user-controlled storage. The final local storage structure, retention policy, and optional encryption behavior will be documented when application source is imported.

## Public repository boundary

Never commit or attach:

- real templates;
- backups;
- UIDs from real access tokens;
- dumps;
- BIN/EML files;
- keys;
- audit logs; or
- screenshots containing real card data.

The root `.gitignore` blocks common local folders and file extensions, but ignore rules are not a security boundary. Review every staged file before committing.

## Synthetic fixtures

Tests and documentation may use synthetic fixtures only. A synthetic fixture must be invented for testing and must not be generated from, derived from, or reversible to a real transponder.

## Future verification behavior

For a supported workflow, the future application is intended to preserve an explicit before/after comparison and perform a re-read verification after a supported change. These are product intentions, not current executable features.
