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
- Own UID `D2 DF E4 94`, not writable.
- Initial config page 1: `C9 00 00 AA`.
- Initial TTF mode disabled / RTF mode, 4 kBit.
- Initial page 7: `57 5F 4F 4B`.
- Pages 4-7 were written first.
- Page 1 config was written later.
- Final config page 1: `C9 28 00 AA`.
- Final pages 4-7 matched the source profile.
- Final TTF mode: Page 4, Page 5, Page 6, Page 7 at 2 kBit.
- The blank worked on the owned target cabinet afterward.

The important lesson is not "copy everything". That would be technically wrong and risky. The UID differed after the successful manual test because page 0 is read-only. This specific cabinet therefore apparently did not rely exclusively on UID matching. That observation is scoped to this owned cabinet workflow only.

Safety rules:

- Do not write UID page 0.
- Do not enable encryption or authentication when the original is Plain Mode / No Auth.
- Treat page 1 config as high risk and write it last if needed.
- Read back and verify after every write.
- Keep the original and blank compatibility checks separate from the write plan.

Implemented profile rules:

- `write_uid=false`.
- `write_config_last=true`.
- Default known write order: pages 4, 5, 6, 7, then page 1 config.
- Verification allows UID mismatch but requires all non-UID profile pages to match.
- A blank that still has config `C9 00 00 AA` and empty pages 4-6 fails verification against the original profile.
- A written blank with UID `D2 DF E4 94` but matching pages 1-7 verifies as `verified_with_uid_mismatch`.

Normal Mode should enforce these constraints before any future execution layer is allowed to run write commands.
