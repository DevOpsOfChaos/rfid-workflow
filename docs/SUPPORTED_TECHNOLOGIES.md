# Supported Technologies

Technology labels are deliberately conservative. Detection, a command existing in a PM3 client, or a successful raw scan is not evidence of a supported read or write workflow.

## Fully verified

### Hitag S256

The only fully verified future application workflow is Hitag S256 under the exact PM3 baseline in [COMPATIBILITY.md](COMPATIBILITY.md):

- read;
- second-scan validation;
- local templates and backups;
- state comparison;
- individual writes; and
- verified automatic write plans with re-read verification.

This statement applies only to the documented verified configuration and authorized transponders.

## Read-only or partial

No additional technology is currently documented as read-only or partial in RFID Workflow. This section will only be populated after an explicit capability document and tests exist.

## Detected but not yet supported

No technology is currently declared detected-but-not-supported by the application because the application source has not been imported. Future detection results must not imply a writable workflow.

## Planned

The following areas may be evaluated as future extensions. They are not currently supported by RFID Workflow and no write, storage, or compatibility claim is made for them:

- ISO14443A;
- MIFARE Classic;
- EM410x;
- T5577; and
- generic LF/HF detection.

Every new technology adapter must document its capabilities, limitations, exact PM3 baseline, data-safety behavior, and test coverage before its status can change.
