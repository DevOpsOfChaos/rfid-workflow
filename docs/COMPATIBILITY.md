# Compatibility

## Verified configuration

| Component | Verified configuration |
| --- | --- |
| Client build | Iceman v4.21611-321-gc7b95a94e |
| Platform | Proxmark3 Generic |
| Operating system | Windows 10/11 |
| Verified workflow | Hitag S256 read, second-scan validation, templates, backups, comparison, individual writes and verified automatic write plans |

This is the only documented verified configuration for the future RFID Workflow application.

## Compatibility status definitions

| Status | Meaning |
| --- | --- |
| **Verified** | The exact combination and workflow have been tested and documented with a complete result, including appropriate re-read verification for supported write operations. |
| **Recognized but untested** | The future application can identify the client, firmware, hardware, or technology, but no complete RFID Workflow workflow has been verified for that combination. This is not support. |
| **Client / firmware mismatch** | The detected client and flashed firmware do not match, or the combination cannot be confidently validated. Write workflows must not be treated as available. |

## Version policy

Newer, older, or otherwise different PM3 versions must **not** be described as supported merely because they are detected. They belong in **Recognized but untested** until a specific end-to-end workflow is verified and documented.

## Hardware policy

The verified hardware platform is Proxmark3 Generic. Other PM3 models or clones require their own compatibility report and may differ in behavior, firmware support, antenna characteristics, ports, and power delivery.

## Reporting results

Use the compatibility-report issue template. Publish only sanitized information and synthetic examples. Never include real card data, UIDs, keys, dumps, or personal paths.
