# Windows Installation Plan

RFID Workflow is not downloadable yet. This document describes the planned installation flow for the future Windows release.

## Prerequisites

Python is required. RFID Workflow will not automatically include Python, Proxmark3 firmware, or the RRG/Iceman Proxmark3 client.

Install a compatible RRG/Iceman Proxmark3 client and flash the Proxmark3 with a matching client/firmware build. Client and firmware must match. Do not assume that a newer or different PM3 version is supported merely because it is detected.

## Planned installation steps

1. Install Python.
2. Install a compatible RRG/Iceman Proxmark3 client.
3. Flash the Proxmark3 with a matching client/firmware build.
4. Connect the device.
5. Run the future Windows installation helper.
6. Start RFID Workflow.
7. Confirm PM3 detection and run the antenna check.

The simplified Windows installer/helper will arrive with the later application source import. This repository does not currently provide an installer or executable.

## Before first use

Read [PM3 setup and flashing](PM3_SETUP_AND_FLASHING.md), [compatibility](COMPATIBILITY.md), and [first run](FIRST_RUN.md). Use only systems and transponders you own or are explicitly authorized to handle.
