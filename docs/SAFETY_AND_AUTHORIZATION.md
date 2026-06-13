# Safety and Authorization

This project is for authorized internal provisioning and maintenance workflows only.

Hard boundaries for the current preparation phase:

- No unauthorized access-system workflows.
- No brute force, attacks, sniffing, simulation, restore, or clone flows.
- No tag writes from automation during discovery.
- No Proxmark3 client or firmware bundling.

The application should default to read-only discovery and require explicit workflow gates before any future write step. High-risk configuration, lock, password, authentication, and crypto changes need separate warnings, audit records, and operator confirmation.

