# Contributing to RFID Workflow

Thank you for helping improve RFID Workflow. This project is being prepared as a public, privacy-conscious foundation before the application source is imported.

## Non-negotiable data rule

Never include real RFID or NFC data in an issue, pull request, commit, screenshot, test artifact, or discussion. This includes real templates, backups, UIDs, dumps, BIN/EML files, keys, audit logs, screenshots containing card data, personal file paths, environment files, and local configuration.

Use only clearly synthetic fixtures. Synthetic data must not be derived from a real access token, customer system, workplace system, or personal transponder.

## Contribution expectations

- Keep pull requests small and clearly scoped.
- Explain the user-visible and safety-relevant effect of a change.
- Add or update documentation when behavior, compatibility, or supported capabilities change.
- Keep all future visible UI text i18n-ready. Do not hard-code user-facing strings in a way that prevents translation.
- Do not claim a technology is write-supported unless a complete verified workflow exists.
- Do not add a PM3 command until it has been checked locally against the installed client help and the intended client version.
- New technology adapters require capability documentation and tests. The documentation must state what is verified, partial, detected only, or planned.
- Prefer defensive workflows: explicit user intent, clear preconditions, read-before-write checks where appropriate, and re-read verification after supported changes.

## Development workflow

1. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/PUBLIC_REPOSITORY_AUDIT.md](docs/PUBLIC_REPOSITORY_AUDIT.md).
2. Open an issue or use an existing issue to define the scope.
3. Work in a focused branch.
4. Use synthetic fixtures only.
5. Run the checks applicable to your change.
6. Complete the pull-request template honestly.

## Reporting bugs and compatibility findings

Use the provided GitHub issue templates. Include only sanitized descriptions and sanitized logs. Do not paste raw command output if it may reveal card data, paths, serial numbers, or secrets.

## Questions about boundaries

When uncertain whether an artifact is safe to publish, treat it as private and do not commit it. Ask maintainers using a sanitized description instead.
