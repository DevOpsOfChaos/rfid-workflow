# Third-Party Notices

## Proxmark3 / Iceman

This repository does not include Proxmark3/Iceman source code, firmware,
scripts, binaries, or drivers.

The app starts a user-installed local Proxmark3/Iceman client as an external
program. Proxmark3/Iceman is licensed separately by its authors. The
RfidResearchGroup/Iceman repository describes the Proxmark3 source code as
GPLv3-or-later:

https://github.com/RfidResearchGroup/proxmark3

If a future release bundles, redistributes, downloads, patches, or modifies
Proxmark3/Iceman, that release must satisfy the applicable Proxmark license
obligations. Do not apply this project's proprietary use-only license to
Proxmark3/Iceman files.

## Python Dependencies

Python dependencies are installed by `pip` into a local `.venv-gui` environment
on the user's machine. They are not vendored in this repository.
