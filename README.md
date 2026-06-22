# RFID Workflow

RFID Workflow is a future independent Windows desktop application for working with **your own or otherwise authorized RFID/NFC transponders**. It is designed to use a locally installed RRG/Iceman Proxmark3 client and to provide guided, safety-oriented workflows instead of requiring routine terminal operation.

> **Project status: public-source preparation in progress.**
> **Application source import follows a privacy and repository audit.**

There is no downloadable application release yet. This repository currently contains the public project foundation, policies, documentation, and contribution rules only.

## Intended scope

The planned desktop application will:

- detect and use a locally installed compatible RRG/Iceman Proxmark3 client;
- guide users through supported read and verification workflows;
- read supported chips and validate results with a second scan;
- manage **local** templates and backups;
- compare captured states;
- perform supported changes only where an explicitly verified workflow exists; and
- re-read and verify supported changes after execution, including supported automatic write plans.

All transponder data is intended to remain local to the user's computer. RFID Workflow is designed for local storage, with no cloud synchronization, no remote accounts, and no telemetry.

## Important boundaries

- Use RFID Workflow only for transponders, systems, and environments you own or are explicitly authorized to test or administer.
- RFID Workflow is an independent project. It is not a fork of, affiliated with, or endorsed by RfidResearchGroup.
- RFID Workflow will not bundle or modify the RRG/Iceman Proxmark3 client or firmware. Users install and maintain those components separately.
- A technology is not considered write-supported unless its complete workflow has been locally verified and documented.

## Current verified baseline

The only fully verified workflow documented for the future application is **Hitag S256** under the exact compatibility baseline in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md). Other technologies may be detected, discussed, or planned, but they are not represented as supported write workflows.

## Documentation

- [Windows installation plan](docs/INSTALL_WINDOWS.md)
- [First-run flow](docs/FIRST_RUN.md)
- [PM3 setup and flashing](docs/PM3_SETUP_AND_FLASHING.md)
- [Compatibility matrix](docs/COMPATIBILITY.md)
- [Supported technologies](docs/SUPPORTED_TECHNOLOGIES.md)
- [Backups and templates](docs/BACKUPS_AND_TEMPLATES.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Release process](docs/RELEASE_PROCESS.md)
- [Public repository audit](docs/PUBLIC_REPOSITORY_AUDIT.md)

## Privacy and safe contributions

Do **not** commit real RFID/NFC data. This includes real templates, backups, UIDs, dumps, BIN/EML files, keys, audit logs, screenshots containing card data, personal paths, environment files, or local configuration. See [PRIVACY.md](PRIVACY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the [public repository audit](docs/PUBLIC_REPOSITORY_AUDIT.md).

## License

RFID Workflow is licensed under the [GNU General Public License, version 3 or later](LICENSE).

## Third-party components

Planned integrations and runtime dependencies are acknowledged in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). They are not bundled by this repository at this stage.
