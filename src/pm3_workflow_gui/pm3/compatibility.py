from __future__ import annotations

from dataclasses import dataclass

from pm3_workflow_gui.pm3.parsers import HwVersion


VERIFIED_CLIENT_BASELINE = "v4.21611-321-gc7b95a94e"
VERIFIED_TARGET = "PM3 GENERIC"


@dataclass(frozen=True)
class Pm3Compatibility:
    status: str
    label: str
    firmware_version: str | None = None
    platform: str | None = None


def classify_pm3_compatibility(parsed: HwVersion | None, output: str = "", fallback_target: str | None = None) -> Pm3Compatibility:
    if parsed is None:
        return Pm3Compatibility("unknown", "Unknown")

    client = parsed.client_version
    firmware = parsed.firmware or fallback_target
    bootrom = parsed.bootrom
    os_version = parsed.os
    platform = parsed.platform
    combined = "\n".join(value or "" for value in (client, firmware, bootrom, os_version, platform, output)).lower()
    if "mismatch" in combined or "doesn't match" in combined or "does not match" in combined:
        return Pm3Compatibility("client_firmware_mismatch", "Client / firmware mismatch", firmware, platform)

    target = (firmware or fallback_target or "").upper()
    has_verified_client = VERIFIED_CLIENT_BASELINE.lower() in (client or "").lower()
    has_verified_arm = VERIFIED_CLIENT_BASELINE.lower() in ((bootrom or "") + " " + (os_version or "")).lower()
    has_verified_target = VERIFIED_TARGET in target
    if has_verified_client and has_verified_target and (has_verified_arm or not output):
        return Pm3Compatibility("verified", "Verified", firmware, platform)

    return Pm3Compatibility("recognized_untested", "Recognized but untested", firmware, platform)
