# Hitag S256 Workflow Notes

This documents one successful internal manual workflow. It is not a universal guarantee for every Hitag S256 tag or blank.

Known source profile:

- LF, no NFC.
- Hitag S 256.
- UID: `FA F9 91 79`.
- Plain Mode, No Authentication.
- Config unlocked, Key/PWD unlocked.
- Page 0: `FA F9 91 79` RO UID.
- Page 1: `C9 28 00 AA` Config.
- Page 2: `48 54 4F 4E`.
- Page 3: `4D 49 4B 52`.
- Page 4: `FF F8 06 97`.
- Page 5: `8C 66 C1 80`.
- Page 6: `03 6E F7 00`.
- Page 7: `00 00 00 00`.
- TTF mode: Page 4, Page 5, Page 6, Page 7.
- TTF data rate: 2 kBit.

Observed blank behavior:

- Hitag S 256.
- Own UID, not writable.
- Pages 4-7 were written first.
- Page 1 config was written later.
- The blank worked on the owned target cabinet afterward.

Safety rules:

- Do not write UID page 0.
- Do not enable encryption or authentication when the original is Plain Mode / No Auth.
- Treat page 1 config as high risk and write it last if needed.
- Read back and verify after every write.
- Keep the original and blank compatibility checks separate from the write plan.

