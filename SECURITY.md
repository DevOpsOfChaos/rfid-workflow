# Security Policy

## Supported versions

No application release has been published yet. The repository currently contains public preparation material only.

## Reporting a vulnerability

Do not report sensitive findings through a public issue. Use GitHub's private security advisory process for this repository when available, or contact the maintainers through a private channel referenced in the repository settings.

A useful report contains:

- a concise impact summary;
- affected documentation, future component, or workflow;
- safe reproduction steps using synthetic data only;
- expected versus observed behavior; and
- a suggested mitigation when available.

Do **not** include real RFID/NFC dumps, UIDs, keys, templates, backups, client logs containing transponder data, local paths, environment files, or credentials.

## Security principles

The future application should favor local processing, explicit user confirmation, narrowly documented capabilities, matching PM3 client/firmware builds, and post-operation verification for supported changes. Security-sensitive functions must not be implied by detection alone.
