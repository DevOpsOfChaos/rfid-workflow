# PM3 Setup and Flashing

RFID Workflow is planned as a frontend for a locally installed RRG/Iceman Proxmark3 setup. It does not include Proxmark3 firmware or the PM3 client.

## Required principle

The Proxmark3 client build and the firmware flashed to the device must match. A client/firmware mismatch can cause incomplete commands, unstable behavior, false assumptions about capabilities, or failed workflows.

## Planned setup sequence

1. Install Python for the future RFID Workflow desktop application.
2. Install the intended RRG/Iceman Proxmark3 client locally.
3. Identify the exact client build.
4. Flash the Proxmark3 with the matching firmware build following the upstream documentation for that build.
5. Connect the device and verify that the client can communicate with it.
6. Start RFID Workflow after it is available.
7. Confirm detection and run the manual antenna test without a chip on the antenna.

## Command and capability discipline

PM3 commands evolve. Future adapters must check command availability using local client help for the exact client build before they are exposed by the UI. A command shown by another version, a forum post, or a screenshot is not sufficient evidence.

## Supported baseline

See [COMPATIBILITY.md](COMPATIBILITY.md) for the only documented verified baseline. Other versions may be recognized, but recognition does not equal support.
