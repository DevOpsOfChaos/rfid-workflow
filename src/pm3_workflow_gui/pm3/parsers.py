from __future__ import annotations

import re


PAGE_RE = re.compile(r"Page\s+(?P<page>\d+):\s+(?P<data>(?:[0-9A-Fa-f]{2}\s*){4})")
UID_RE = re.compile(r"UID:\s*(?P<uid>(?:[0-9A-Fa-f]{2}\s*){4})")


def normalize_hex_bytes(value: str) -> str:
    parts = re.findall(r"[0-9A-Fa-f]{2}", value)
    return " ".join(part.upper() for part in parts)


def parse_hitag_s256_pages(output: str) -> dict[int, str]:
    pages: dict[int, str] = {}
    for match in PAGE_RE.finditer(output):
        pages[int(match.group("page"))] = normalize_hex_bytes(match.group("data"))
    return pages


def parse_uid(output: str) -> str | None:
    match = UID_RE.search(output)
    if not match:
        return None
    return normalize_hex_bytes(match.group("uid"))

