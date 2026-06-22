# Development Guide

RFID Workflow now contains the public application source for the development preview. This guide establishes the engineering rules that code changes must follow.

## Design direction

The application is intended to be a Windows desktop frontend for a locally installed RRG/Iceman Proxmark3 client. It should use guided workflows, explicit capability boundaries, local-only data handling, and re-read verification after supported changes.

## Before adding a PM3 adapter

1. Identify the exact PM3 client build and matching firmware build.
2. Confirm relevant commands using the local client's help output.
3. Write a capability document that distinguishes verified, partial, detected-only, and planned behavior.
4. Add synthetic fixtures and tests.
5. Document preconditions, failure handling, and verification behavior.
6. Update compatibility and technology documentation.

## Safety and privacy requirements

- Never add real RFID/NFC artifacts to the repository.
- Use synthetic fixtures only.
- Treat writes as explicit, opt-in workflows with clear preconditions.
- Do not infer write support from successful detection.
- Capture only sanitized diagnostics in public artifacts.
- Keep templates, backups, audit data, and local configuration out of version control.

## User interface and localization

All visible UI text must remain i18n-ready from the first source import. Keep user-facing strings centralized or otherwise structured for translation. Avoid embedding operational PM3 details directly into visual controls when a safer explanatory layer is needed.

## Testing expectations

The codebase should include unit tests for parsers and capability mapping, synthetic workflow fixtures, failure-path tests, and verification-path tests. Hardware testing must always identify the exact PM3 hardware, client build, firmware build, operating system, and technology.
