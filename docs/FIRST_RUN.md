# Planned First Run

The future application is intended to use a short, explicit onboarding flow:

```text
Language selection
→ PM3 detection
→ manually started antenna test
→ short display of measured LF/HF values
→ Overview page
```

## Language selection

On the first start, the user selects the interface language. The future application should also allow changing that setting later.

## PM3 detection

RFID Workflow will look for a locally available compatible RRG/Iceman Proxmark3 client and connected PM3 device. Detection is not proof of full compatibility. The result must be compared with the documented compatibility matrix.

## Antenna test

The antenna test must be started manually by the user. It must be performed **without a chip or transponder on the antenna**. The planned interface will briefly show measured LF/HF values and then continue to the Overview page after a successful check.

## Overview page

The Overview page is intended to explain the application, expose safe entry points for supported workflows, show compatibility status, and provide access to documentation and troubleshooting material.

No application behavior described here is available as a release yet; it is a documented future workflow.
