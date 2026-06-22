# Privacy

## Local-first design

RFID Workflow is intended to be a local Windows desktop tool. The planned design does not include cloud synchronization, hosted user accounts, remote data storage, or telemetry.

Future application behavior must be documented again at source-import and release time. Until then, this repository does not provide an application binary or collect application data.

## Public repository rule

The public repository must never contain:

- real templates;
- backups;
- UIDs from real access tokens;
- dumps;
- BIN or EML files;
- keys;
- audit logs;
- screenshots containing real card data;
- personal paths;
- environment files; or
- local configuration.

This rule applies to Git history, issues, pull requests, review comments, documentation, screenshots, release assets, test fixtures, and generated artifacts.

## Contributions and support requests

Use only synthetic examples. Remove identifying information from text and logs before publication. If there is any doubt whether an artifact contains real RFID/NFC or personal data, do not publish it.

## Local data handling after source import

The future application is expected to keep its data within local user-controlled folders. Exact paths, retention behavior, backup encryption options, and export behavior must be documented and audited with the future source import. No such behavior is claimed by this repository today.
