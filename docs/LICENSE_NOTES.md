# License Notes

This project is source-available, not open source.

The repository license permits use of the tool as provided. It does not permit
modification, redistribution, sublicensing, or sale. Do not describe this
project as MIT licensed or open source in release notes, GitHub metadata, or
customer documentation.

Proxmark3/Iceman is treated as an external tool selected by the user at
runtime. This repository must not include Proxmark3 source code, firmware,
scripts, or `proxmark3.exe`.

The RfidResearchGroup/Iceman repository states that the Proxmark3 source code
is GPLv3-or-later:

https://github.com/RfidResearchGroup/proxmark3

Current compatibility position:

- OK: this app is distributed without Proxmark3 files and starts a
  user-installed local Proxmark client as an external program.
- OK: documentation may tell the user where the local Proxmark client is
  expected, as long as Proxmark files are not copied into this repository.
- Not OK without extra GPL review: bundling Proxmark3 source, binaries,
  firmware, scripts, drivers, or patched Proxmark files with this proprietary
  source-available app.
- Not OK: applying this repository's no-copy/no-modify/no-sell license to
  Proxmark3/Iceman files.

Still to verify before any release that includes third-party files:

- Whether the custom license text should be reviewed by counsel.
- Exact GPL/source-offer/notice obligations for the selected Proxmark
  distribution.
- Whether screenshots or excerpts from Proxmark3 output require attribution.
- Packaging implications if the app installer ever downloads Proxmark3.
