# Troubleshooting

No application binary is available yet. The guidance below defines the intended support posture for the future Windows desktop tool.

## PM3 is not detected

- Confirm that the Proxmark3 is connected and recognized by Windows.
- Confirm that the local RRG/Iceman client can communicate with the device outside RFID Workflow.
- Check that the expected serial/USB connection is not occupied by another tool.
- Record the client build, firmware build, hardware model, and Windows version for a sanitized bug or compatibility report.

## Client or firmware mismatch

Do not proceed with write workflows when the client and firmware do not match. Install a matching pair and verify it with the local client first. A newer build is not automatically a compatible build.

## Antenna test is unstable or unexpected

Run the antenna test manually with **no chip or transponder on the antenna**. Remove nearby tags, metal objects, and other sources of interference where practical. Record only sanitized numeric observations; do not publish raw data that could identify a real transponder or environment.

## A technology is detected but a workflow is unavailable

This is expected unless the technology appears under **Fully verified** in [SUPPORTED_TECHNOLOGIES.md](SUPPORTED_TECHNOLOGIES.md). Detection alone is not permission to expose a write workflow.

## Reporting a problem

Use the bug-report template. Include sanitized steps, sanitized logs only, the PM3 setup details, and whether the issue occurred in a read-only or write workflow. Never attach real dumps, UIDs, keys, backups, or screenshots containing card data.
