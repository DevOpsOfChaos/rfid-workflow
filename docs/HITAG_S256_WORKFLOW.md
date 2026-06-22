# Hitag S256 Workflow Notes

This documents one successful internal manual workflow. It is not a universal guarantee for every Hitag S256 tag or blank.

Known source profile:

- LF, no NFC.
- Hitag S 256.
- UID: `A1 B2 C3 D4`.
- Plain Mode, No Authentication.
- Config unlocked, Key/PWD unlocked.
- Page 0: `A1 B2 C3 D4` RO UID.
- Page 1: `C9 28 00 AA` Config.
- Page 2: `44 45 4D 4F`.
- Page 3: `54 45 53 54`.
- Page 4: `A4 10 B4 20`.
- Page 5: `C5 30 D5 40`.
- Page 6: `E6 50 F6 60`.
- Page 7: `00 00 00 00`.
- TTF mode: Page 4, Page 5, Page 6, Page 7.
- TTF data rate: 2 kBit.

Observed blank behavior:

- Hitag S 256.
- Own UID `11 22 33 44`, not writable.
- Initial config page 1: `C9 00 00 AA`.
- Initial TTF mode disabled / RTF mode, 4 kBit.
- Initial page 7: `52 44 59 21`.
- Pages 4-7 were written first.
- Page 1 config was written later.
- Final config page 1: `C9 28 00 AA`.
- Final pages 4-7 matched the source profile.
- Final TTF mode: Page 4, Page 5, Page 6, Page 7 at 2 kBit.
- The blank worked on the owned target cabinet afterward.

The important lesson is not "copy everything". That would be technically wrong and risky. The UID differed after the successful manual test because page 0 is read-only. This specific cabinet therefore apparently did not rely exclusively on UID matching. That observation is scoped to this owned cabinet workflow only.

Technical integrity rules:

- Do not write UID page 0.
- Do not enable encryption or authentication when the original is Plain Mode / No Auth.
- Treat page 1 config as configuration-sensitive and write it last if needed.
- Read back and verify after every write.
- Keep the original and blank compatibility checks separate from the write plan.

Implemented profile rules:

- `write_uid=false`.
- `write_config_last=true`.
- Default known write order: pages 4, 5, 6, 7, then page 1 config.
- Verification allows UID mismatch but requires all non-UID profile pages to match.
- A blank that still has config `C9 00 00 AA` and empty pages 4-6 fails verification against the original profile.
- A written blank with UID `11 22 33 44` but matching pages 1-7 verifies as `verified_with_uid_mismatch`.

Normal mode applies these constraints before a write operation is executed.
