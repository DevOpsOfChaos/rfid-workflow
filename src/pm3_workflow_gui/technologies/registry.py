from __future__ import annotations

from pm3_workflow_gui.pm3.parsers import HfSearchResult, HitagReaderResult, HitagSRead, LfSearchResult
from pm3_workflow_gui.technologies.base import (
    DetectedTechnology,
    READ_STATUS_DETECTED_ONLY,
    READ_STATUS_IDENTITY_READ,
    READ_STATUS_PUBLIC_DETAILS_READ,
    READ_STATUS_SIGNAL_UNSTABLE,
    READ_STATUS_NOT_SUPPORTED_YET,
    TechnologyAdapter,
)
from pm3_workflow_gui.technologies.generic import GenericDetectedChipAdapter
from pm3_workflow_gui.technologies.hitag_s256 import HitagS256Adapter, hitag_s256_detection


_HITAG = HitagS256Adapter()
_GENERIC = GenericDetectedChipAdapter()


def adapter_for(detection: DetectedTechnology | None) -> TechnologyAdapter:
    if detection and detection.technology_id == _HITAG.technology_id:
        return _HITAG
    return _GENERIC


def detect_technology(
    hf_search: HfSearchResult | None = None,
    lf_search: LfSearchResult | None = None,
    hitag_reader: HitagReaderResult | None = None,
    hitag_read: HitagSRead | None = None,
) -> DetectedTechnology | None:
    if hitag_read and hitag_read.is_hitag_s256_plain_no_auth:
        return hitag_s256_detection(uid=hitag_read.uid, confidence="high")
    if hitag_reader and hitag_reader.uids:
        return DetectedTechnology(
            technology_id="hitag_s_candidate",
            technology_name="Hitag S",
            frequency="lf",
            technology_family="hitag_s",
            chipset=lf_search.chipset if lf_search else None,
            uid=hitag_reader.uids[0],
            confidence="medium",
            support_level="candidate",
            source="hitag_reader",
            status="unstable",
            read_status=READ_STATUS_SIGNAL_UNSTABLE,
        )
    if lf_search and lf_search.classification == "hitag_candidate":
        return DetectedTechnology(
            technology_id="hitag_s_candidate",
            technology_name="Hitag S",
            frequency="lf",
            technology_family="hitag_s",
            chipset=lf_search.chipset,
            uid=lf_search.uid,
            confidence="medium" if lf_search.uid else "low",
            support_level="candidate",
            source="lf_search",
            read_status=READ_STATUS_DETECTED_ONLY,
        )
    if lf_search and lf_search.classification not in {"unknown", "no_tag_found"}:
        return DetectedTechnology(
            technology_id=lf_search.classification,
            technology_name=_lf_display_name(lf_search),
            frequency="lf",
            technology_family=lf_search.classification,
            chipset=lf_search.chipset,
            uid=lf_search.uid,
            confidence=_lf_confidence(lf_search),
            support_level="basic_detection",
            source="lf_search",
            read_status=READ_STATUS_IDENTITY_READ if lf_search.uid else READ_STATUS_PUBLIC_DETAILS_READ,
        )
    if hf_search and hf_search.status == "tag_found":
        return DetectedTechnology(
            technology_id=hf_search.technology_family or "unknown_hf",
            technology_name=hf_search.tag_type or _hf_display_name(hf_search.technology_family),
            frequency="hf",
            technology_family=hf_search.technology_family or "unknown",
            chipset=hf_search.chipset,
            uid=hf_search.uid,
            confidence=hf_search.confidence or "medium",
            support_level="basic_detection",
            source="hf_search",
            read_status=READ_STATUS_IDENTITY_READ if hf_search.uid else READ_STATUS_PUBLIC_DETAILS_READ,
        )
    if lf_search and lf_search.identification_status == "no_chipset":
        return DetectedTechnology(
            technology_id="unknown_lf",
            technology_name="Unbekannter LF-Chip",
            frequency="lf",
            technology_family="unknown",
            chipset=lf_search.chipset,
            uid=lf_search.uid,
            confidence="low",
            support_level="basic_detection",
            source="lf_search",
            read_status=READ_STATUS_NOT_SUPPORTED_YET,
        )
    if hf_search and hf_search.status not in {"unknown", "no_tag_found", "device_lost", "command_failed"}:
        return DetectedTechnology(
            technology_id="unknown_hf",
            technology_name="Unbekannter HF-Chip",
            frequency="hf",
            technology_family="unknown",
            confidence="low",
            support_level="basic_detection",
            source="hf_search",
            read_status=READ_STATUS_NOT_SUPPORTED_YET,
        )
    return None


def _lf_display_name(search: LfSearchResult) -> str:
    labels = {
        "em410x": "EM410x",
        "t5577": "T5577",
        "hitag_candidate": "Hitag S",
        "unknown_lf": "Unbekannter LF-Chip",
    }
    if search.tag_type:
        return search.tag_type
    if search.chipset:
        return search.chipset
    return labels.get(search.classification, search.classification)


def _lf_confidence(search: LfSearchResult) -> str:
    if search.uid and (search.tag_type or search.chipset):
        return "high"
    if search.uid or search.tag_type or search.chipset:
        return "medium"
    return "low"


def _hf_display_name(family: str | None) -> str:
    return {
        "mifare_classic": "MIFARE Classic",
        "iso14443a": "ISO14443A",
        "unknown": "Unbekannter HF-Chip",
        None: "Unbekannter HF-Chip",
    }.get(family, family or "Unbekannter HF-Chip")
