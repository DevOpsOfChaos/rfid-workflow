from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from pm3_workflow_gui.pm3.parsers import HfSearchResult, LfSearchResult, parse_hf_search, parse_lf_search


DetectionConfidence = Literal["low", "medium", "high"]
ScanState = Literal[
    "no_chip_detected",
    "signal_detected_but_ambiguous",
    "technology_candidate",
    "technology_confirmed",
    "identity_read",
    "public_details_read",
    "full_supported_read",
    "signal_unstable",
    "device_lost",
]


@dataclass(frozen=True)
class ScanAttempt:
    command: str
    frequency: str
    candidate_family: str | None
    uid_or_raw_value: str | None
    bit_length: int | None
    chipset: str | None
    warnings: tuple[str, ...]
    raw_output: str
    timestamp: str


@dataclass(frozen=True)
class TechnologyCandidate:
    family: str
    frequency: str
    uid_or_raw_value: str | None
    bit_length: int | None
    chipset: str | None
    confidence: DetectionConfidence
    confirmed: bool = False


@dataclass(frozen=True)
class ScanEvidence:
    attempts: tuple[ScanAttempt, ...]
    state: ScanState
    candidate: TechnologyCandidate | None = None
    warnings: tuple[str, ...] = ()

    @property
    def is_confirmed(self) -> bool:
        return self.state == "technology_confirmed" and self.candidate is not None

    @property
    def is_ambiguous(self) -> bool:
        return self.state in {"signal_detected_but_ambiguous", "signal_unstable"}


def scan_attempt_from_hf(command: str, output: str, timestamp: str | None = None) -> ScanAttempt:
    parsed = parse_hf_search(output)
    return ScanAttempt(
        command=command,
        frequency="hf",
        candidate_family=parsed.technology_family if parsed.status == "tag_found" else None,
        uid_or_raw_value=parsed.uid,
        bit_length=None,
        chipset=parsed.chipset,
        warnings=tuple(_hf_warnings(parsed, output)),
        raw_output=output,
        timestamp=timestamp or _utc_timestamp(),
    )


def scan_attempt_from_lf(command: str, output: str, timestamp: str | None = None) -> ScanAttempt:
    parsed = parse_lf_search(output)
    indala_candidate = parsed.classification == "indala"
    return ScanAttempt(
        command=command,
        frequency="lf",
        candidate_family=parsed.classification if parsed.classification != "unknown" else None,
        uid_or_raw_value=parsed.raw_id if indala_candidate else parsed.uid,
        bit_length=parsed.bit_length if indala_candidate else None,
        chipset=parsed.chipset,
        warnings=tuple(_lf_warnings(parsed, output)),
        raw_output=output,
        timestamp=timestamp or _utc_timestamp(),
    )


def evaluate_scan_evidence(attempts: tuple[ScanAttempt, ...]) -> ScanEvidence:
    if not attempts:
        return ScanEvidence(attempts, "no_chip_detected")
    warnings = _evidence_warnings(attempts)
    if any("device_lost" in attempt.warnings for attempt in attempts):
        return ScanEvidence(attempts, "device_lost", warnings=warnings)

    candidates = [attempt for attempt in attempts if attempt.candidate_family and attempt.candidate_family != "no_tag_found"]
    clean_candidates = [attempt for attempt in candidates if not _has_instability_warning(attempt)]
    if not candidates:
        if "signal_weak" in warnings:
            return ScanEvidence(attempts, "signal_detected_but_ambiguous", warnings=warnings)
        if any("no_chip" in attempt.warnings for attempt in attempts):
            return ScanEvidence(attempts, "no_chip_detected", warnings=warnings)
        return ScanEvidence(attempts, "signal_detected_but_ambiguous", warnings=warnings)

    unstable_identity = "unstable_raw" in warnings or "unstable_bit_length" in warnings
    if unstable_identity or any(_has_false_positive_warning(attempt) for attempt in candidates):
        return ScanEvidence(attempts, "signal_detected_but_ambiguous", _last_candidate(candidates), warnings)

    confirmed = _confirmed_candidate(clean_candidates)
    if confirmed:
        return ScanEvidence(attempts, "technology_confirmed", confirmed, warnings)

    candidate = _last_candidate(clean_candidates or candidates)
    state: ScanState = "technology_candidate" if candidate else "signal_detected_but_ambiguous"
    return ScanEvidence(attempts, state, candidate, warnings)


def evidence_from_search_results(
    hf_search: HfSearchResult | None = None,
    lf_search: LfSearchResult | None = None,
) -> ScanEvidence:
    attempts: list[ScanAttempt] = []
    if hf_search is not None:
        attempts.append(
            ScanAttempt(
                command="hf search",
                frequency="hf",
                candidate_family=hf_search.technology_family if hf_search.status == "tag_found" else None,
                uid_or_raw_value=hf_search.uid,
                bit_length=None,
                chipset=hf_search.chipset,
                warnings=tuple(_hf_warnings(hf_search, "")),
                raw_output="",
                timestamp=_utc_timestamp(),
            )
        )
    if lf_search is not None:
        indala_candidate = lf_search.classification == "indala"
        attempts.append(
            ScanAttempt(
                command="lf search",
                frequency="lf",
                candidate_family=lf_search.classification if lf_search.classification != "unknown" else None,
                uid_or_raw_value=lf_search.raw_id if indala_candidate else lf_search.uid,
                bit_length=lf_search.bit_length if indala_candidate else None,
                chipset=lf_search.chipset,
                warnings=tuple(_lf_warnings(lf_search, "")),
                raw_output="",
                timestamp=_utc_timestamp(),
            )
        )
    return evaluate_scan_evidence(tuple(attempts))


def _confirmed_candidate(attempts: list[ScanAttempt]) -> TechnologyCandidate | None:
    counts: dict[tuple[str, str | None, int | None], int] = {}
    by_key: dict[tuple[str, str | None, int | None], ScanAttempt] = {}
    for attempt in attempts:
        if not attempt.candidate_family:
            continue
        if attempt.frequency == "hf" and attempt.uid_or_raw_value and "false_positive" not in attempt.warnings:
            return _candidate_from_attempt(attempt, "high", confirmed=True)
        if not attempt.uid_or_raw_value:
            continue
        key = (attempt.candidate_family, attempt.uid_or_raw_value, attempt.bit_length)
        counts[key] = counts.get(key, 0) + 1
        by_key[key] = attempt
        if counts[key] >= 2:
            return _candidate_from_attempt(attempt, "high", confirmed=True)
    for attempt in attempts:
        if attempt.candidate_family and attempt.uid_or_raw_value and attempt.chipset:
            return _candidate_from_attempt(attempt, "high", confirmed=True)
    return None


def _last_candidate(attempts: list[ScanAttempt]) -> TechnologyCandidate | None:
    for attempt in reversed(attempts):
        if attempt.candidate_family:
            confidence: DetectionConfidence = "medium" if attempt.uid_or_raw_value or attempt.chipset else "low"
            return _candidate_from_attempt(attempt, confidence, confirmed=False)
    return None


def _candidate_from_attempt(
    attempt: ScanAttempt,
    confidence: DetectionConfidence,
    confirmed: bool,
) -> TechnologyCandidate:
    return TechnologyCandidate(
        family=attempt.candidate_family or "unknown",
        frequency=attempt.frequency,
        uid_or_raw_value=attempt.uid_or_raw_value,
        bit_length=attempt.bit_length,
        chipset=attempt.chipset,
        confidence=confidence,
        confirmed=confirmed,
    )


def _evidence_warnings(attempts: tuple[ScanAttempt, ...]) -> tuple[str, ...]:
    warnings: list[str] = []
    for attempt in attempts:
        warnings.extend(attempt.warnings)

    by_family: dict[str, list[ScanAttempt]] = {}
    for attempt in attempts:
        if attempt.candidate_family:
            by_family.setdefault(attempt.candidate_family, []).append(attempt)
    for family_attempts in by_family.values():
        raw_values = {attempt.uid_or_raw_value for attempt in family_attempts if attempt.uid_or_raw_value}
        bit_lengths = {attempt.bit_length for attempt in family_attempts if attempt.bit_length is not None}
        if len(raw_values) > 1:
            warnings.append("unstable_raw")
        if len(bit_lengths) > 1:
            warnings.append("unstable_bit_length")
    return _dedupe(warnings)


def _lf_warnings(parsed: LfSearchResult, output: str) -> list[str]:
    normalized = output.lower()
    warnings: list[str] = []
    indala_candidate = parsed.classification == "indala"
    if indala_candidate and (
        "false positive" in normalized or any("false positive" in note.lower() for note in parsed.false_positive_notes)
    ):
        warnings.append("false_positive")
    if indala_candidate and ("odd size" in normalized or any("odd size" in note.lower() for note in parsed.false_positive_notes)):
        warnings.append("odd_size")
    if parsed.identification_status == "no_chipset" and not (parsed.uid or parsed.raw_id or parsed.tag_type or parsed.chipset):
        warnings.append("signal_weak")
    if "no known" in normalized and "tag" in normalized:
        warnings.append("no_chip")
    if any("communicating with proxmark3 device failed" in error.lower() for error in parsed.false_positive_notes):
        warnings.append("device_lost")
    return _dedupe(warnings)


def _hf_warnings(parsed: HfSearchResult, output: str) -> list[str]:
    normalized = output.lower()
    warnings: list[str] = []
    if parsed.status == "no_tag_found":
        warnings.append("no_chip")
    if parsed.status == "device_lost":
        warnings.append("device_lost")
    if parsed.status == "command_failed":
        warnings.append("signal_weak")
    if "false positive" in normalized:
        warnings.append("false_positive")
    return warnings


def _has_instability_warning(attempt: ScanAttempt) -> bool:
    return bool({"false_positive", "odd_size", "unstable_raw", "unstable_bit_length"} & set(attempt.warnings))


def _has_false_positive_warning(attempt: ScanAttempt) -> bool:
    return bool({"false_positive", "odd_size"} & set(attempt.warnings))


def _dedupe(values: list[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return tuple(result)


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()
