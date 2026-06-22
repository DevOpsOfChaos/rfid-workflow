# Release Process

No release exists yet. This document defines the planned release gate for the future source import and subsequent Windows releases.

## Required gates

1. Complete the public repository audit.
2. Confirm that no real RFID/NFC data, credentials, personal paths, environment files, local configuration, logs, or screenshots with card data are present.
3. Produce a reviewed dependency and third-party-notice inventory.
4. Confirm the supported PM3 client/firmware baseline.
5. Verify documented workflows with synthetic tests and controlled authorized hardware tests.
6. Confirm that every advertised write workflow includes suitable preconditions and re-read verification.
7. Update README, compatibility matrix, supported-technology status, privacy information, and changelog.
8. Build and test the Windows installation helper only after its source and packaging process are audited.
9. Create release notes that state limitations plainly.

## Versioning

Use Semantic Versioning after the first executable release. Pre-release labels must make it clear when compatibility or behavior remains experimental.

## Release artifacts

Release artifacts must never contain real templates, backups, dumps, keys, UIDs, logs, or local configuration. Any sample data must be clearly synthetic and reviewed.

## No implied support

A release must not imply support for a PM3 version, hardware model, or RFID technology unless the exact capability is documented and verified.
