# Public Repository Audit

Use this checklist before importing local source, opening a pull request, publishing a release, or attaching diagnostic material.

## Never publish

- real templates;
- backups;
- UIDs from real access tokens;
- dumps;
- BIN/EML files;
- keys;
- audit logs;
- screenshots containing real card data;
- personal paths;
- environment files; or
- local configuration.

This includes Git history, branches, issues, pull requests, comments, discussions, workflow artifacts, release assets, test data, screenshots, archives, and copied terminal output.

## Required audit steps

1. Inspect all staged files and generated artifacts.
2. Search tracked files for forbidden extensions such as `.eml`, `.bin`, `.dump`, and `.key`.
3. Search for `.env` and `.env.*` files.
4. Verify that local folders such as `runtime/`, `local-data/`, `templates/`, `backups/`, `audit/`, and `logs/` are not tracked.
5. Review screenshots and documents manually for card data, UIDs, serials, local paths, usernames, and hidden metadata.
6. Confirm that examples and fixtures are invented synthetic data.
7. Re-check Git history before the first public source import; ignore rules cannot remove data that was committed earlier.
8. Validate that third-party licenses and notices are complete for the actual dependency set.

## If a sensitive artifact is found

Stop publication. Remove the artifact from the pending change and assess whether it entered Git history, issue comments, workflow artifacts, or release assets. Treat exposed credentials or access data as potentially compromised and follow the relevant owner or system process. Do not attempt to conceal the incident by making a normal follow-up commit alone.

## Automation

The repository workflow performs basic hygiene checks. It is deliberately not a substitute for manual review, especially for screenshots, archives, derived data, and text that may embed sensitive information.
