from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time
from typing import Callable

from pm3_workflow_gui.pm3.parsers import (
    HfSearchResult,
    HitagSRead,
    IndalaReadResult,
    LfSearchResult,
    parse_hf_search,
    parse_hitag_reader,
    parse_hitag_s_rdbl,
    parse_hw_tune,
    parse_hw_version,
    parse_indala_reader,
    parse_lf_search,
)
from pm3_workflow_gui.services.capture import (
    CapturedCommandOutput,
    CaptureResult,
    _missing_fields,
    classify_pm3_command_context,
    normalize_pm3_command,
)
from pm3_workflow_gui.services.discovery_facade import DiscoveryTextInputs, default_launch_config
from pm3_workflow_gui.services.scan_evidence import (
    ScanEvidence,
    evaluate_scan_evidence,
    scan_attempt_from_hf,
    scan_attempt_from_lf,
)
from pm3_workflow_gui.technologies.base import DetectedTechnology, READ_STATUS_IDENTITY_READ, READ_STATUS_SIGNAL_UNSTABLE
from pm3_workflow_gui.technologies.registry import detect_technology
from pm3_workflow_gui.technologies.indala import indala_detection


SAFE_LIVE_COMMANDS = ("hw version", "hw tune", "hf search", "lf search")
SAFE_HITAG_READ_COMMANDS = ("lf hitag hts reader -@", "lf hitag hts rdbl -p 0 -c 8")
SAFE_INDALA_READ_COMMANDS = ("lf indala reader",)
SAFE_HITAG_WRITE_PAGES = frozenset({1, 4, 5, 6, 7})
DEVICE_NOT_FOUND_ERROR = "No Proxmark3 port found"
DEVICE_RECONNECT_MESSAGE = "USB reconnect required. Reconnect the Proxmark and restart the session."
COMMAND_EXECUTION_FAILED = "Proxmark port was found, but PM3 command execution failed."
HITAG_POSITION_MESSAGE = "Hitag UID konnte nicht gelesen werden. Bitte Chipposition auf der LF-Antenne korrigieren und erneut scannen."
HITAG_UNSTABLE_MESSAGE = (
    "Chip erkannt, aber nicht stabil lesbar. Bitte Position leicht verändern und erneut scannen."
)
HITAG_DETAIL_UNSTABLE_MESSAGE = (
    "Chip erkannt, aber Detaildaten konnten nicht stabil gelesen werden. Bitte Position leicht verändern und erneut scannen."
)


@dataclass(frozen=True)
class LiveCommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    elapsed_seconds: float = 0.0
    launch_variant: str = "pm3-wrapper"


@dataclass(frozen=True)
class Pm3ConnectionStatus:
    connected: bool
    ports: tuple[str, ...] = ()
    last_error: str | None = None
    stdout: str = ""
    stderr: str = ""


@dataclass(frozen=True)
class Pm3StartupCheck:
    connected: bool
    port: str | None = None
    target: str | None = None
    client_version: str | None = None
    message: str = ""
    raw_status: Pm3ConnectionStatus | None = None
    hw_version: LiveCommandResult | None = None


@dataclass(frozen=True)
class Pm3HardwareCheck:
    ok: bool
    port: str | None = None
    lf_antenna_status: str = "unknown"
    hf_antenna_status: str = "unknown"
    message: str = ""
    hw_tune: LiveCommandResult | None = None


@dataclass(frozen=True)
class Pm3DetachedLaunch:
    command: tuple[str, ...]
    pid: int | None
    port: str
    description: str


@dataclass(frozen=True)
class HitagS256WriteResult:
    success: bool
    page: int
    old_value: str
    new_value: str
    verification_value: str | None
    message: str
    write_result: LiveCommandResult
    verify_result: HitagS256LiveReadResult
    audit_path: Path | None = None


@dataclass(frozen=True)
class HitagS256LiveReadResult:
    status: str
    port: str | None = None
    lf_search: LfSearchResult | None = None
    hitag_read: HitagSRead | None = None
    message: str = ""
    raw_results: tuple[LiveCommandResult, ...] = ()
    hf_search: HfSearchResult | None = None
    detected_technology: DetectedTechnology | None = None
    indala_read: IndalaReadResult | None = None
    scan_evidence: ScanEvidence | None = None

    @property
    def success(self) -> bool:
        return self.status == "hitag_s256_plain"


Runner = Callable[[list[str], int], LiveCommandResult]


@dataclass(frozen=True)
class LiveCaptureResult(CaptureResult):
    debug_results: tuple[LiveCommandResult, ...] = ()
    connection_status: Pm3ConnectionStatus | None = None
    hitag_read_result: HitagS256LiveReadResult | None = None
    indala_read_result: HitagS256LiveReadResult | None = None


class LivePm3ReadonlyService:
    """Read-only live PM3 transport using the local pm3 wrapper auto-port logic."""

    def __init__(
        self,
        client_dir: str | Path | None = None,
        runner: Runner | None = None,
        timeout_seconds: int = 45,
        probe_timeout_seconds: int = 6,
    ) -> None:
        config = default_launch_config()
        self.client_dir = Path(client_dir) if client_dir else config.client_dir
        self.proxmark_exe = self.client_dir / "proxmark3.exe"
        self.runner = runner or self._run_subprocess
        self.timeout_seconds = timeout_seconds
        self.probe_timeout_seconds = probe_timeout_seconds

    def connection_status(self) -> Pm3ConnectionStatus:
        result = self.runner(self._pm3_args("--list"), self.probe_timeout_seconds)
        ports = tuple(_parse_pm3_list_ports(result.stdout))
        if ports:
            return Pm3ConnectionStatus(True, ports, stdout=result.stdout, stderr=result.stderr)
        error = "timeout while waiting for Proxmark3 port list" if result.timed_out else _first_error(result) or DEVICE_NOT_FOUND_ERROR
        return Pm3ConnectionStatus(False, (), error, result.stdout, result.stderr)

    def startup_check(self) -> Pm3StartupCheck:
        status = self.connection_status()
        if not status.connected:
            return Pm3StartupCheck(
                connected=False,
                message=status.last_error or DEVICE_NOT_FOUND_ERROR,
                raw_status=status,
            )
        port = status.ports[0]
        hw_version = self.run_safe_command("hw version", port=port)
        output = _combined_output(hw_version)
        if hw_version.timed_out or not _hw_version_is_meaningful(output):
            return Pm3StartupCheck(
                connected=False,
                port=port,
                message=COMMAND_EXECUTION_FAILED,
                raw_status=status,
                hw_version=hw_version,
            )
        parsed = parse_hw_version(output)
        return Pm3StartupCheck(
            connected=True,
            port=port,
            target=parsed.firmware or "PM3 Generic",
            client_version=parsed.client_version,
            message="Proxmark erkannt",
            raw_status=status,
            hw_version=hw_version,
        )

    def hardware_check(self, port: str | None = None) -> Pm3HardwareCheck:
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                return Pm3HardwareCheck(False, message=status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]
        hw_tune = self.run_safe_command("hw tune", port=selected_port)
        output = _combined_output(hw_tune)
        if hw_tune.timed_out or not _hw_tune_is_meaningful(output):
            return Pm3HardwareCheck(False, selected_port, message=COMMAND_EXECUTION_FAILED, hw_tune=hw_tune)
        parsed = parse_hw_tune(output)
        ok = parsed.lf_antenna_status == "ok" and parsed.hf_antenna_status == "ok"
        return Pm3HardwareCheck(
            ok=ok,
            port=selected_port,
            lf_antenna_status=parsed.lf_antenna_status or "unknown",
            hf_antenna_status=parsed.hf_antenna_status or "unknown",
            message="LF/HF geprüft" if ok else "Antenne prüfen: LF/HF nicht eindeutig ok",
            hw_tune=hw_tune,
        )

    def open_lf_tune_diagram(self, port: str | None = None) -> Pm3DetachedLaunch:
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                raise RuntimeError(status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]
        command = self._lf_tune_window_args(selected_port)
        process = subprocess.Popen(
            command,
            cwd=self.client_dir,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
            close_fds=True,
        )
        return Pm3DetachedLaunch(
            command=tuple(command),
            pid=process.pid,
            port=selected_port,
            description="LF tuning diagram",
        )

    def capture(self, include_hitag_read: bool = False) -> CaptureResult:
        status = self.connection_status()
        if not status.connected:
            return _device_lost_capture(status)

        port = status.ports[0]
        results = [self.run_safe_command(command, port=port) for command in SAFE_LIVE_COMMANDS]
        hitag_result = self.read_hitag_s256(port) if include_hitag_read else None
        valid_outputs = _valid_command_outputs(results)
        hf_search = parse_hf_search(valid_outputs["hf search"]) if "hf search" in valid_outputs else None
        lf_search = parse_lf_search(valid_outputs["lf search"]) if "lf search" in valid_outputs else None
        evidence_attempts = []
        if "hf search" in valid_outputs:
            evidence_attempts.append(scan_attempt_from_hf("hf search", valid_outputs["hf search"]))
        if "lf search" in valid_outputs:
            evidence_attempts.append(scan_attempt_from_lf("lf search", valid_outputs["lf search"]))
        evidence = evaluate_scan_evidence(tuple(evidence_attempts))
        detected = detect_technology(hf_search=hf_search, lf_search=lf_search) if evidence.is_confirmed else None
        indala_result = None
        debug_results = results + list(hitag_result.raw_results if hitag_result else ()) + list(indala_result.raw_results if indala_result else ())
        errors = _result_errors(results)
        failed_commands = _failed_commands(results)
        if not _hw_version_is_meaningful(valid_outputs.get("hw version")):
            errors.append(COMMAND_EXECUTION_FAILED)
            failed_commands.append("hw version")
        inputs = DiscoveryTextInputs(
            startup_banner=_startup_banner_from_results(results),
            hw_version=valid_outputs.get("hw version"),
            hw_tune=valid_outputs.get("hw tune"),
            hf_search=valid_outputs.get("hf search"),
            lf_search=valid_outputs.get("lf search"),
            hitag_reader=_first_combined_output(hitag_result, "lf hitag hts reader -@"),
            hitag_rdbl=_first_combined_output(hitag_result, "lf hitag hts rdbl -p 0 -c 8"),
            indala_reader=_first_combined_output(indala_result, "lf indala reader"),
            session_errors=tuple(_dedupe(errors)),
            failed_commands=tuple(_dedupe(failed_commands)),
        )
        return LiveCaptureResult(
            source="live-pm3:auto-port",
            inputs=inputs,
            command_outputs=_command_outputs(debug_results),
            missing_fields=_missing_fields(inputs),
            debug_results=tuple(debug_results),
            connection_status=status,
            hitag_read_result=hitag_result,
            indala_read_result=indala_result,
        )

    def read_chip(self, port: str | None = None) -> HitagS256LiveReadResult:
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                return HitagS256LiveReadResult("device_lost", message=status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]

        hf_result = self.run_safe_command("hf search", port=selected_port)
        lf_result = self.run_safe_command("lf search", port=selected_port)
        hf_output = _combined_output(hf_result)
        lf_output = _combined_output(lf_result)
        hf_search = parse_hf_search(hf_output) if hf_output else None
        lf_search = parse_lf_search(lf_output) if lf_output else None
        raw_results = (hf_result, lf_result)
        evidence_attempts = []
        if hf_output:
            evidence_attempts.append(scan_attempt_from_hf("hf search", hf_output))
        if lf_output:
            evidence_attempts.append(scan_attempt_from_lf("lf search", lf_output))
        evidence = evaluate_scan_evidence(tuple(evidence_attempts))

        should_repeat_lf = (
            evidence.state == "technology_candidate"
            and evidence.candidate
            and evidence.candidate.frequency == "lf"
        ) or (
            evidence.state == "signal_detected_but_ambiguous"
            and any(attempt.frequency == "lf" for attempt in evidence.attempts)
        )
        if should_repeat_lf:
            repeat_result = self.run_safe_command("lf search", port=selected_port)
            repeat_output = _combined_output(repeat_result)
            raw_results = raw_results + (repeat_result,)
            if repeat_output:
                lf_search = parse_lf_search(repeat_output)
                evidence_attempts.append(scan_attempt_from_lf("lf search", repeat_output))
                evidence = evaluate_scan_evidence(tuple(evidence_attempts))

        if evidence.is_ambiguous:
            return HitagS256LiveReadResult(
                "signal_unstable",
                selected_port,
                lf_search,
                None,
                _ambiguous_signal_message(evidence),
                raw_results,
                hf_search,
                None,
                None,
                evidence,
            )

        detected = detect_technology(hf_search=hf_search, lf_search=lf_search) if evidence.is_confirmed else None

        if detected and detected.technology_id == "hitag_s_candidate":
            hitag_result = self.read_hitag_s256(selected_port)
            combined_raw = raw_results + hitag_result.raw_results
            full_detection = detect_technology(
                hf_search=hf_search,
                lf_search=hitag_result.lf_search or lf_search,
                hitag_read=hitag_result.hitag_read,
            )
            return HitagS256LiveReadResult(
                hitag_result.status,
                selected_port,
                hitag_result.lf_search or lf_search,
                hitag_result.hitag_read,
                hitag_result.message,
                combined_raw,
                hf_search,
                full_detection or detected,
                scan_evidence=evidence,
            )

        if detected and detected.technology_id == "indala":
            indala_result = self.read_indala(selected_port, lf_search, hf_search, raw_results)
            return HitagS256LiveReadResult(
                indala_result.status,
                indala_result.port,
                indala_result.lf_search,
                indala_result.hitag_read,
                indala_result.message,
                indala_result.raw_results,
                indala_result.hf_search,
                indala_result.detected_technology,
                indala_result.indala_read,
                evidence,
            )

        if detected:
            return HitagS256LiveReadResult(
                "basic_detection",
                selected_port,
                lf_search,
                None,
                "Chip erkannt. Vollständiges Lesen und Vorlagen-Erstellung sind für diesen Chiptyp noch nicht verfügbar.",
                raw_results,
                hf_search,
                detected,
                scan_evidence=evidence,
            )

        return HitagS256LiveReadResult(
            "no_chip",
            selected_port,
            lf_search,
            None,
            "Kein Chip erkannt. Bitte Chip mittig auflegen und erneut scannen.",
            raw_results,
            hf_search,
            None,
            scan_evidence=evidence,
        )

    def run_safe_command(self, command: str, port: str | None = None) -> LiveCommandResult:
        normalized = normalize_pm3_command(command)
        if normalized not in SAFE_LIVE_COMMANDS and normalized not in SAFE_HITAG_READ_COMMANDS and normalized not in SAFE_INDALA_READ_COMMANDS:
            raise ValueError(f"Refusing live PM3 command outside read-only allowlist: {command}")
        if port:
            result = self.runner(self._proxmark_args(port, normalized), self.timeout_seconds)
            return LiveCommandResult(
                normalized,
                result.returncode,
                result.stdout,
                result.stderr,
                result.timed_out,
                result.elapsed_seconds,
                "proxmark3.exe detected-port -c",
            )
        result = self.runner(self._pm3_args("-c", normalized), self.timeout_seconds)
        return LiveCommandResult(
            normalized,
            result.returncode,
            result.stdout,
            result.stderr,
            result.timed_out,
            result.elapsed_seconds,
            "pm3-wrapper -c",
        )

    def write_hitag_s256_page(
        self,
        page: int,
        old_value: str,
        new_value: str,
        template_id: str,
        target_uid: str,
        port: str | None = None,
        audit_dir: str | Path | None = None,
    ) -> HitagS256WriteResult:
        if page not in SAFE_HITAG_WRITE_PAGES:
            raise ValueError(f"Refusing Hitag S256 write outside approved pages: {page}")
        old_value = _normalize_page_data(old_value)
        new_value = _normalize_page_data(new_value)
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                raise RuntimeError(status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]

        command = f"lf hitag hts wrbl -p {page} -d {new_value.replace(' ', '')}"
        write_result = self.runner(self._proxmark_args(selected_port, command), self.timeout_seconds)
        normalized_write = LiveCommandResult(
            command,
            write_result.returncode,
            write_result.stdout,
            write_result.stderr,
            write_result.timed_out,
            write_result.elapsed_seconds,
            "proxmark3.exe detected-port -c",
        )
        if normalized_write.timed_out or normalized_write.returncode != 0:
            verify_result = HitagS256LiveReadResult(
                "write_failed",
                selected_port,
                message="Schreiben fehlgeschlagen; Verifikation nicht ausgeführt.",
            )
            audit_path = self._write_audit_record(
                template_id, target_uid, page, old_value, new_value, None, False, audit_dir
            )
            return HitagS256WriteResult(
                False,
                page,
                old_value,
                new_value,
                None,
                "Schreiben fehlgeschlagen; keine automatische Fortsetzung.",
                normalized_write,
                verify_result,
                audit_path,
            )

        verify_result = self.read_hitag_s256(selected_port)
        verification_value = None
        if verify_result.hitag_read and page in verify_result.hitag_read.pages:
            verification_value = _normalize_page_data(verify_result.hitag_read.pages[page].data)
        success = verification_value == new_value
        audit_path = self._write_audit_record(
            template_id, target_uid, page, old_value, new_value, verification_value, success, audit_dir
        )
        return HitagS256WriteResult(
            success,
            page,
            old_value,
            new_value,
            verification_value,
            "Schreiben verifiziert." if success else "Schreiben nicht verifiziert; Workflow gestoppt.",
            normalized_write,
            verify_result,
            audit_path,
        )

    def read_hitag_s256(self, port: str | None = None) -> HitagS256LiveReadResult:
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                return HitagS256LiveReadResult("device_lost", message=status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]

        lf_results: list[LiveCommandResult] = []
        lf_searches: list[LfSearchResult] = []
        stable_lf_search: LfSearchResult | None = None
        last_candidate_search: LfSearchResult | None = None
        candidate_counts: dict[str, int] = {}

        for _ in range(3):
            lf_result = self.run_safe_command("lf search", port=selected_port)
            lf_results.append(lf_result)
            lf_output = _combined_output(lf_result)
            lf_search = parse_lf_search(lf_output) if lf_output else None
            if lf_search:
                lf_searches.append(lf_search)
            if _has_uid_request_failed(lf_result):
                return HitagS256LiveReadResult(
                    "uid_request_failed",
                    selected_port,
                    lf_search,
                    message=HITAG_POSITION_MESSAGE,
                    raw_results=tuple(lf_results),
                )
            if lf_result.timed_out or lf_search is None or lf_search.classification != "hitag_candidate":
                time.sleep(0.2)
                continue
            last_candidate_search = lf_search
            candidate_key = lf_search.uid or f"{lf_search.tag_type}:{lf_search.chipset}"
            candidate_counts[candidate_key] = candidate_counts.get(candidate_key, 0) + 1
            if candidate_counts[candidate_key] >= 2:
                stable_lf_search = lf_search
                break
            time.sleep(0.2)

        lf_search = stable_lf_search or last_candidate_search or (lf_searches[-1] if lf_searches else None)
        if stable_lf_search is None:
            if any(_has_hitag_candidate_evidence(search) for search in lf_searches):
                return HitagS256LiveReadResult(
                    "hitag_candidate_unstable",
                    selected_port,
                    lf_search,
                    message=HITAG_UNSTABLE_MESSAGE,
                    raw_results=tuple(lf_results),
                )
            detected = detect_technology(lf_search=lf_search)
            if detected:
                return HitagS256LiveReadResult(
                    "basic_detection",
                    selected_port,
                    lf_search,
                    message="Chip erkannt. Vollständiges Lesen und Vorlagen-Erstellung sind für diesen Chiptyp noch nicht verfügbar.",
                    raw_results=tuple(lf_results),
                    detected_technology=detected,
                )
            return HitagS256LiveReadResult(
                "no_chip",
                selected_port,
                lf_search,
                message="Kein Chip erkannt. Bitte Chip mittig auflegen und erneut scannen.",
                raw_results=tuple(lf_results),
            )

        reader_results: list[LiveCommandResult] = []
        reader_uid_failures = 0
        for _ in range(2):
            reader_result = self.run_safe_command("lf hitag hts reader -@", port=selected_port)
            reader_results.append(reader_result)
            if _has_uid_request_failed(reader_result):
                reader_uid_failures += 1
                time.sleep(0.2)
                continue
            reader = parse_hitag_reader(_combined_output(reader_result))
            if reader.uids:
                break
            time.sleep(0.2)
        else:
            if reader_uid_failures == len(reader_results):
                return HitagS256LiveReadResult(
                    "uid_request_failed",
                    selected_port,
                    lf_search,
                    message=HITAG_POSITION_MESSAGE,
                    raw_results=tuple(lf_results + reader_results),
                )
            return HitagS256LiveReadResult(
                "reader_failed",
                selected_port,
                lf_search,
                message="Hitag-Kandidat erkannt, aber UID-Leseprobe war nicht stabil.",
                raw_results=tuple(lf_results + reader_results),
            )

        rdbl_results: list[LiveCommandResult] = []
        last_hitag_read: HitagSRead | None = None
        for _ in range(2):
            rdbl_result = self.run_safe_command("lf hitag hts rdbl -p 0 -c 8", port=selected_port)
            rdbl_results.append(rdbl_result)
            rdbl_output = _combined_output(rdbl_result)
            hitag_read = parse_hitag_s_rdbl(rdbl_output) if rdbl_output else None
            last_hitag_read = hitag_read or last_hitag_read
            if _has_uid_request_failed(rdbl_result) or (hitag_read and hitag_read.errors):
                time.sleep(0.2)
                continue
            if not rdbl_result.timed_out and hitag_read and hitag_read.is_hitag_s256_plain_no_auth:
                return HitagS256LiveReadResult(
                    "hitag_s256_plain",
                    selected_port,
                    lf_search,
                    hitag_read,
                    "Hitag S256 gelesen",
                    tuple(lf_results + reader_results + rdbl_results),
                )
            time.sleep(0.2)

        if last_hitag_read is not None and not last_hitag_read.is_hitag_s256_plain_no_auth:
            return HitagS256LiveReadResult(
                "unsupported_hitag",
                selected_port,
                lf_search,
                last_hitag_read,
                "Dieser Chiptyp wird erkannt, aber ein vollständiger Vorlagen-Read ist in V1 noch nicht verfügbar.",
                tuple(lf_results + reader_results + rdbl_results),
            )
        return HitagS256LiveReadResult(
            "detail_read_unstable",
            selected_port,
            lf_search,
            last_hitag_read,
            HITAG_DETAIL_UNSTABLE_MESSAGE,
            tuple(lf_results + reader_results + rdbl_results),
        )

    def _pm3_args(self, *pm3_args: str) -> list[str]:
        quoted_args = " ".join(_cmd_quote(arg) for arg in pm3_args)
        command = f"cd /d {self.client_dir} && call setup.bat && bash pm3 {quoted_args}".strip()
        return ["cmd.exe", "/c", command]

    def _proxmark_args(self, port: str, command: str) -> list[str]:
        return [str(self.proxmark_exe), port, "-c", command]

    def _lf_tune_window_args(self, port: str) -> list[str]:
        command = (
            f'title PM3 LF tuning diagram && cd /d "{self.client_dir}" '
            f'&& call setup.bat && "{self.proxmark_exe}" {port} -c "lf tune --mix"'
        )
        return ["cmd.exe", "/k", command]

    def _run_subprocess(self, args: list[str], timeout_seconds: int) -> LiveCommandResult:
        if "lf hitag hts reader -@" in " ".join(args).lower():
            return self._run_reader_subprocess(args, timeout_seconds)
        started = time.monotonic()
        try:
            completed = subprocess.run(
                args,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                cwd=self.client_dir,
                env=self._proxmark_env(),
            )
        except subprocess.TimeoutExpired as exc:
            elapsed = time.monotonic() - started
            return LiveCommandResult(
                " ".join(args),
                124,
                exc.stdout or "",
                exc.stderr or "",
                timed_out=True,
                elapsed_seconds=elapsed,
            )
        elapsed = time.monotonic() - started
        return LiveCommandResult(" ".join(args), completed.returncode, completed.stdout, completed.stderr, elapsed_seconds=elapsed)

    def _run_reader_subprocess(self, args: list[str], timeout_seconds: int) -> LiveCommandResult:
        started = time.monotonic()
        process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=self.client_dir,
            env=self._proxmark_env(),
        )
        # The reader command is read-only but interactive; sample briefly, then exit with Enter.
        time.sleep(min(4.0, max(0.5, timeout_seconds - 1.0)))
        try:
            stdout, stderr = process.communicate("\n", timeout=1.5)
            elapsed = time.monotonic() - started
            return LiveCommandResult(" ".join(args), process.returncode or 0, stdout, stderr, elapsed_seconds=elapsed)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            stdout, stderr = process.communicate()
            elapsed = time.monotonic() - started
            return LiveCommandResult(
                " ".join(args),
                124,
                (exc.stdout or "") + (stdout or ""),
                (exc.stderr or "") + (stderr or ""),
                timed_out=True,
                elapsed_seconds=elapsed,
            )

    def read_indala(
        self,
        port: str | None = None,
        lf_search: LfSearchResult | None = None,
        hf_search: HfSearchResult | None = None,
        initial_results: tuple[LiveCommandResult, ...] = (),
    ) -> HitagS256LiveReadResult:
        selected_port = port
        if selected_port is None:
            status = self.connection_status()
            if not status.connected:
                return HitagS256LiveReadResult("device_lost", message=status.last_error or DEVICE_NOT_FOUND_ERROR)
            selected_port = status.ports[0]

        reader_results: list[LiveCommandResult] = []
        reads: list[IndalaReadResult] = []
        for _ in range(3):
            reader_result = self.run_safe_command("lf indala reader", port=selected_port)
            reader_results.append(reader_result)
            reader_output = _combined_output(reader_result)
            if reader_output:
                parsed = parse_indala_reader(reader_output)
                if parsed.has_identity:
                    reads.append(parsed)
            time.sleep(0.2)

        stable = _stable_indala_read(reads)
        unstable = stable is None and bool(reads)
        fallback_raw = lf_search.raw_id if lf_search else None
        fallback_length = lf_search.bit_length if lf_search else None
        selected_read = stable or reads[-1] if reads else None
        detection = indala_detection(
            raw_id=stable.raw_id if stable else None,
            bit_length=stable.bit_length if stable else fallback_length,
            confidence="high" if stable else "low",
            read_status=READ_STATUS_IDENTITY_READ if stable else READ_STATUS_SIGNAL_UNSTABLE,
        )
        if selected_read is None and fallback_raw:
            selected_read = IndalaReadResult(fallback_raw, fallback_length)
        return HitagS256LiveReadResult(
            "identity_read" if stable else "signal_unstable" if unstable else "basic_detection",
            selected_port,
            lf_search,
            None,
            "Indala-ID gelesen" if stable else "Chip erkannt, aber Details konnten nicht stabil gelesen werden. Bitte Chip leicht verschieben und erneut scannen.",
            tuple(initial_results + tuple(reader_results)),
            hf_search,
            detection,
            selected_read,
        )

    def _proxmark_env(self) -> dict[str, str]:
        env = os.environ.copy()
        home = str(self.client_dir) + "\\"
        qt_plugin_path = home + "libs\\"
        env["HOME"] = home
        env["QT_PLUGIN_PATH"] = qt_plugin_path
        env["QT_QPA_PLATFORM_PLUGIN_PATH"] = qt_plugin_path
        env["PATH"] = qt_plugin_path + ";" + qt_plugin_path + "shell\\;" + env.get("PATH", "")
        env["MSYSTEM"] = "MINGW64"
        return env

    def _write_audit_record(
        self,
        template_id: str,
        target_uid: str,
        page: int,
        old_value: str,
        new_value: str,
        verification_value: str | None,
        success: bool,
        audit_dir: str | Path | None,
    ) -> Path:
        target_dir = Path(audit_dir) if audit_dir else _default_audit_dir()
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / "hitag_s256_write_audit.jsonl"
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "template_id": template_id,
            "technology": "hitag_s256",
            "target_uid": target_uid,
            "area": f"page_{page}",
            "old_value": old_value,
            "new_value": new_value,
            "verification_value": verification_value,
            "verification_success": success,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
        return path


def _device_lost_capture(status: Pm3ConnectionStatus) -> CaptureResult:
    inputs = DiscoveryTextInputs(
        session_errors=("Communicating with Proxmark3 device failed",),
        failed_commands=("pm3 --list",),
        cmd_prompt_detected=True,
    )
    return LiveCaptureResult(
        source="live-pm3:auto-port",
        inputs=inputs,
        missing_fields=_missing_fields(inputs),
        connection_status=status,
    )


def _command_outputs(results: list[LiveCommandResult]) -> dict[str, tuple[CapturedCommandOutput, ...]]:
    grouped: dict[str, list[CapturedCommandOutput]] = {}
    for result in results:
        normalized = normalize_pm3_command(result.command)
        text = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        grouped.setdefault(normalized, []).append(
            CapturedCommandOutput(
                command=result.command,
                normalized_command=normalized,
                command_context=classify_pm3_command_context(normalized),
                output=text,
            ),
        )
    return {command: tuple(values) for command, values in grouped.items()}


def _startup_banner_from_results(results: list[LiveCommandResult]) -> str | None:
    for result in results:
        text = "\n".join(part for part in (result.stdout, result.stderr) if part)
        if "Using UART port" in text or "[ Proxmark3 ]" in text:
            return text.strip()
    return None


def _valid_command_outputs(results: list[LiveCommandResult]) -> dict[str, str]:
    valid: dict[str, str] = {}
    for result in results:
        output = _combined_output(result)
        if not output or result.timed_out:
            continue
        if result.command == "hw version" and _hw_version_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "hw tune" and _hw_tune_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "hf search" and _hf_search_is_meaningful(output):
            valid[result.command] = output
        elif result.command == "lf search" and _lf_search_is_meaningful(output):
            valid[result.command] = output
    return valid


def _hw_version_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hw_version(output)
    return bool(parsed.client_version or parsed.firmware)


def _hw_tune_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hw_tune(output)
    return bool(parsed.lf_antenna_status or parsed.hf_antenna_status or parsed.hf_13_56mhz_voltage)


def _hf_search_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_hf_search(output)
    return parsed.status != "unknown"


def _lf_search_is_meaningful(output: str | None) -> bool:
    if not output or _looks_like_command_catalog(output):
        return False
    parsed = parse_lf_search(output)
    return parsed.identification_status != "unknown" or bool(parsed.uid or parsed.tag_type or parsed.chipset or parsed.hint)


def _looks_like_command_catalog(output: str) -> bool:
    normalized = output.lower()
    return (
        "use `<command> help` for details of a command" in normalized
        and "technology -----------------------" in normalized
    )


def _parse_pm3_list_ports(output: str) -> list[str]:
    ports: list[str] = []
    for line in output.splitlines():
        stripped = line.strip()
        if ": " not in stripped:
            continue
        _, value = stripped.split(": ", 1)
        if value:
            ports.append(value.strip())
    return ports


def _first_error(result: LiveCommandResult) -> str | None:
    for text in (result.stderr, result.stdout):
        for line in text.splitlines():
            stripped = line.strip()
            if stripped:
                return stripped
    return None


def _result_errors(results: list[LiveCommandResult]) -> list[str]:
    errors: list[str] = []
    markers = (
        "UID Request failed!",
        "Couldn't identify a chipset",
        "timeout while waiting for reply",
        "Failed to get current device debug level",
        "Communicating with Proxmark3 device failed",
    )
    for result in results:
        if result.timed_out:
            errors.append("timeout while waiting for reply")
        if result.returncode != 0 and not _result_has_meaningful_output(result):
            errors.append(COMMAND_EXECUTION_FAILED)
        for text in (result.stdout, result.stderr):
            for marker in markers:
                if marker.lower() in text.lower():
                    errors.append(marker)
    return _dedupe(errors)


def _failed_commands(results: list[LiveCommandResult]) -> list[str]:
    failed: list[str] = []
    for result in results:
        if result.timed_out or (result.returncode != 0 and not _result_has_meaningful_output(result)):
            failed.append(normalize_pm3_command(result.command))
            continue
        if any(error.lower() in (result.stdout + result.stderr).lower() for error in _result_errors([result])):
            failed.append(normalize_pm3_command(result.command))
    return _dedupe(failed)


def _result_has_meaningful_output(result: LiveCommandResult) -> bool:
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.command == "hw version":
        return _hw_version_is_meaningful(output)
    if result.command == "hw tune":
        return _hw_tune_is_meaningful(output)
    if result.command == "hf search":
        return _hf_search_is_meaningful(output)
    if result.command == "lf search":
        return _lf_search_is_meaningful(output)
    return False


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _cmd_quote(value: str) -> str:
    if not value or any(char.isspace() for char in value):
        return '"' + value.replace('"', r'\"') + '"'
    return value


def _normalize_page_data(value: str) -> str:
    parts = []
    current = ""
    for char in value:
        if char in "0123456789abcdefABCDEF":
            current += char
            if len(current) == 2:
                parts.append(current.upper())
                current = ""
    if current or len(parts) != 4:
        raise ValueError(f"Expected exactly four hex bytes, got: {value}")
    return " ".join(parts)


def _default_audit_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "PM3Workflow" / "audit"
    return Path.home() / ".pm3-workflow" / "audit"


def _combined_output(result: LiveCommandResult) -> str:
    return "\n".join(part for part in (result.stdout, result.stderr) if part).strip()


def _has_uid_request_failed(result: LiveCommandResult) -> bool:
    return "uid request failed" in _combined_output(result).lower()


def _first_combined_output(result: HitagS256LiveReadResult | None, command: str) -> str | None:
    if result is None:
        return None
    for command_result in result.raw_results:
        if command_result.command == command:
            output = _combined_output(command_result)
            if output:
                return output
    return None


def _has_hitag_candidate_evidence(search: LfSearchResult | None) -> bool:
    if search is None:
        return False
    if search.classification == "hitag_candidate":
        return True
    return any(
        value and "hitag" in value.lower()
        for value in (search.tag_type, search.chipset, search.hint)
    )


def _stable_indala_read(reads: list[IndalaReadResult]) -> IndalaReadResult | None:
    counts: dict[tuple[str, int | None], int] = {}
    by_key: dict[tuple[str, int | None], IndalaReadResult] = {}
    for read in reads:
        if not read.raw_id:
            continue
        key = (read.raw_id, read.bit_length)
        counts[key] = counts.get(key, 0) + 1
        by_key[key] = read
        if counts[key] >= 2:
            return by_key[key]
    return None


def _ambiguous_signal_message(evidence: ScanEvidence) -> str:
    reason_labels = {
        "false_positive": "False-Positive-Hinweis",
        "odd_size": "ungewoehnliche Bitgroesse",
        "unstable_raw": "wechselnde Raw-Werte",
        "unstable_bit_length": "wechselnde Bitlaenge",
        "signal_weak": "schwaches Signal",
    }
    reasons = [reason_labels[warning] for warning in evidence.warnings if warning in reason_labels]
    suffix = f" Grund: {', '.join(reasons)}." if reasons else ""
    return (
        "Chip-Signal erkannt. Chiptyp konnte noch nicht stabil bestimmt werden. "
        "Bitte Chip mittig auflegen oder leicht verschieben und erneut scannen."
        + suffix
    )
