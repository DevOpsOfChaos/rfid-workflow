from __future__ import annotations

from dataclasses import dataclass, replace
import re

from pm3_workflow_gui.pm3.commands import get_command_by_text
from pm3_workflow_gui.pm3.risk import RiskLevel, classify_command


PAGE_RE = re.compile(r"Page\s+(?P<page>\d+):\s+(?P<data>(?:[0-9A-Fa-f]{2}\s*){4})")
UID_RE = re.compile(r"UID:\s*(?P<uid>(?:[0-9A-Fa-f]{2}\s*){4})")
LABEL_RE = re.compile(r"^(?:--=\s*)?(?P<label>[A-Za-z0-9 /_-][A-Za-z0-9 /_-]*?)\.{2,}\s*(?P<value>.+)$")


@dataclass(frozen=True)
class StartupBanner:
    com_port: str | None
    target: str | None
    client_version: str | None
    bootrom_version: str | None
    os_version: str | None


@dataclass(frozen=True)
class HwVersion:
    client_version: str | None
    compiler: str | None
    platform: str | None
    firmware: str | None
    bootrom: str | None
    os: str | None
    arm_compiler: str | None
    flash_usage_percent: int | None
    lua_script_support: str | None
    python_script_support: str | None


@dataclass(frozen=True)
class HwTune:
    lf_125khz_voltage: float | None
    lf_134_83khz_voltage: float | None
    lf_optimal_frequency_khz: float | None
    lf_optimal_voltage: float | None
    lf_frequency_bandwidth: float | None
    lf_peak_voltage: float | None
    lf_antenna_status: str | None
    hf_13_56mhz_voltage: float | None
    hf_peak_voltage: float | None
    hf_antenna_status: str | None
    rating: str


@dataclass(frozen=True)
class CommandHelp:
    command_name: str
    usage: str | None
    options: tuple[str, ...]
    risk: RiskLevel


@dataclass(frozen=True)
class HfSearchResult:
    status: str
    message: str | None = None


@dataclass(frozen=True)
class LfSearchResult:
    classification: str
    uid: str | None
    tag_type: str | None
    chipset: str | None
    hint: str | None
    false_positive_notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class HitagSPage:
    page: int
    data: str
    permission: str
    info: str


@dataclass(frozen=True)
class HitagSRead:
    memory_type: str | None
    authentication: str | None
    ttf_coding: str | None
    ttf_data_rate: str | None
    ttf_mode: str | None
    config_locked: str | None
    key_pwd_locked: str | None
    pages: dict[int, HitagSPage]
    access_mode: str | None = None

    @property
    def uid(self) -> str | None:
        page = self.pages.get(0)
        return page.data if page else None

    @property
    def config_page(self) -> str | None:
        page = self.pages.get(1)
        return page.data if page else None

    @property
    def is_hitag_s256_plain_no_auth(self) -> bool:
        return (
            self.memory_type == "Hitag S 256"
            and (self.authentication or "").lower() == "no"
            and (self.access_mode or "").lower() == "plain"
        )


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


def parse_startup_banner(output: str) -> StartupBanner:
    return StartupBanner(
        com_port=_first_match(output, r"Using UART port\s+(COM\d+)"),
        target=_label_value(output, "Target"),
        client_version=_label_value(output, "Client"),
        bootrom_version=_label_value(output, "Bootrom"),
        os_version=_label_value(output, "OS"),
    )


def parse_hw_version(output: str) -> HwVersion:
    sections = _sections(output)
    client = sections.get("Client", [])
    model = sections.get("Model", [])
    arm = sections.get("ARM", [])
    hardware = sections.get("Hardware", [])

    return HwVersion(
        client_version=_first_unlabeled_line(client),
        compiler=_section_label_value(client, "Compiler"),
        platform=_section_label_value(client, "Platform"),
        firmware=_section_label_value(model, "Firmware"),
        bootrom=_section_label_value(arm, "Bootrom"),
        os=_section_label_value(arm, "OS"),
        arm_compiler=_section_label_value(arm, "Compiler"),
        flash_usage_percent=_flash_usage_percent(hardware),
        lua_script_support=_support_state(_section_label_value(client, "Lua script support")),
        python_script_support=_support_state(_section_label_value(client, "Python script support")),
    )


def parse_hw_tune(output: str) -> HwTune:
    lf_peak, hf_peak = _peak_voltages(output)
    lf_status = _first_match(output, r"LF antenna\.*\s*(?P<status>[A-Za-z() ]+)")
    hf_status = _first_match(output, r"HF antenna\s*(?:\(\s*)?(?P<status>[A-Za-z ]+?)(?:\s*\))?$", flags=re.MULTILINE)
    tune = HwTune(
        lf_125khz_voltage=_float_match(output, r"125\.00 kHz\s*\.*\s*(\d+(?:\.\d+)?) V"),
        lf_134_83khz_voltage=_float_match(output, r"134\.83 kHz\s*\.*\s*(\d+(?:\.\d+)?) V"),
        lf_optimal_frequency_khz=_float_match(output, r"(\d+(?:\.\d+)?) kHz optimal"),
        lf_optimal_voltage=_float_match(output, r"kHz optimal\s*\.*\s*(\d+(?:\.\d+)?) V"),
        lf_frequency_bandwidth=_float_match(output, r"Frequency bandwidth\.*\s*(\d+(?:\.\d+)?)"),
        lf_peak_voltage=lf_peak,
        lf_antenna_status=_clean_status(lf_status),
        hf_13_56mhz_voltage=_float_match(output, r"13\.56 MHz\.*\s*(\d+(?:\.\d+)?) V"),
        hf_peak_voltage=hf_peak,
        hf_antenna_status=_clean_status(hf_status),
        rating="WARN",
    )
    return replace(tune, rating=_tune_rating(tune))


def parse_command_help(command_name: str, output: str) -> CommandHelp:
    definition = get_command_by_text(command_name)
    risk = definition.risk if definition else classify_command(command_name)
    return CommandHelp(
        command_name=command_name,
        usage=_usage_line(output),
        options=tuple(_option_lines(output)),
        risk=risk,
    )


def parse_hf_search(output: str) -> HfSearchResult:
    normalized = output.lower()
    if "no known/supported 13.56 mhz tags found" in normalized:
        return HfSearchResult(status="no_tag_found", message="No known/supported 13.56 MHz tags found")
    if "unsupported" in normalized:
        return HfSearchResult(status="unsupported", message=_first_nonempty_line(output))
    return HfSearchResult(status="unknown", message=_first_nonempty_line(output))


def parse_lf_search(output: str) -> LfSearchResult:
    uid = _compact_hex(_label_value(output, "UID"))
    tag_type = _label_value(output, "TYPE")
    chipset = _label_value(output, "Chipset")
    hint = _hint_value(output)
    false_positive_notes = tuple(
        line.strip()
        for line in output.splitlines()
        if "false positive" in line.lower() or "indala" in line.lower()
    )
    has_hitag_hint = any(
        value and "hitag" in value.lower()
        for value in (tag_type, chipset, hint)
    )
    classification = "hitag_candidate" if uid and has_hitag_hint else "unknown"
    return LfSearchResult(
        classification=classification,
        uid=uid,
        tag_type=tag_type,
        chipset=chipset,
        hint=hint,
        false_positive_notes=false_positive_notes,
    )


def parse_hitag_s_rdbl(output: str) -> HitagSRead:
    pages: dict[int, HitagSPage] = {}
    page_re = re.compile(
        r"^\[\+\]\s*(?P<page>\d+)\s*\|\s*(?P<data>(?:[0-9A-Fa-f]{2}\s+){3}[0-9A-Fa-f]{2})\s*\|.*?\|\s*(?P<perm>[^|]+?)\s*\|\s*(?P<info>.+?)\s*$",
        re.MULTILINE,
    )
    for match in page_re.finditer(output):
        page = int(match.group("page"))
        pages[page] = HitagSPage(
            page=page,
            data=_compact_hex(match.group("data")) or "",
            permission=match.group("perm").strip(),
            info=match.group("info").strip(),
        )
    return HitagSRead(
        access_mode="plain" if "Access Hitag S in Plain mode" in output else None,
        memory_type=_label_value(output, "Memory type"),
        authentication=_label_value(output, "Authenticaion") or _label_value(output, "Authentication"),
        ttf_coding=_label_value(output, "TTF coding"),
        ttf_data_rate=_label_value(output, "TTF data rate"),
        ttf_mode=_label_value(output, "TTF mode"),
        config_locked=_label_value(output, "Config locked"),
        key_pwd_locked=_label_value(output, "Key/PWD locked"),
        pages=pages,
    )


def _first_match(output: str, pattern: str, flags: int = 0) -> str | None:
    match = re.search(pattern, output, flags)
    if not match:
        return None
    value = match.groupdict().get("status") if match.groupdict() else match.group(1)
    return value.strip()


def _first_nonempty_line(output: str) -> str | None:
    for line in output.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _compact_hex(value: str | None) -> str | None:
    if value is None:
        return None
    parts = re.findall(r"[0-9A-Fa-f]{2}", value)
    return "".join(part.upper() for part in parts) if parts else None


def _hint_value(output: str) -> str | None:
    match = re.search(r"^\[\?\]\s*Hint:\s*(?P<hint>.+)$", output, re.MULTILINE)
    return match.group("hint").strip() if match else None


def _float_match(output: str, pattern: str) -> float | None:
    value = _first_match(output, pattern)
    return float(value) if value is not None else None


def _label_value(output: str, label: str) -> str | None:
    pattern = rf"^\s*(?:\[[+=?!| -]\]\s*)?{re.escape(label)}\.*\s+(?P<status>.+)$"
    return _first_match(output, pattern, flags=re.MULTILINE)


def _sections(output: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        section_match = re.fullmatch(r"\[\s*(?P<section>[A-Za-z0-9 _-]+)\s*\]", line)
        if section_match:
            current = section_match.group("section").strip()
            sections.setdefault(current, [])
            continue
        if current and line:
            sections[current].append(line)
    return sections


def _first_unlabeled_line(lines: list[str]) -> str | None:
    for line in lines:
        if not LABEL_RE.match(line):
            return line
    return None


def _section_label_value(lines: list[str], label: str) -> str | None:
    normalized_label = label.lower()
    for line in lines:
        match = LABEL_RE.match(line)
        if match and match.group("label").strip().lower() == normalized_label:
            return match.group("value").strip()
    return None


def _flash_usage_percent(lines: list[str]) -> int | None:
    for line in lines:
        match = re.search(r"\(\s*(\d+)% used\s*\)", line)
        if match:
            return int(match.group(1))
    return None


def _support_state(value: str | None) -> str | None:
    if value is None:
        return None
    lower = value.lower()
    if lower.startswith("present"):
        return "present"
    if lower.startswith("absent"):
        return "absent"
    return value


def _peak_voltages(output: str) -> tuple[float | None, float | None]:
    values = [float(value) for value in re.findall(r"Peak voltage\.*\s*(\d+(?:\.\d+)?)", output)]
    lf_peak = values[0] if len(values) >= 1 else None
    hf_peak = values[1] if len(values) >= 2 else None
    return lf_peak, hf_peak


def _clean_status(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("(", "").replace(")", "").strip().lower()


def _tune_rating(tune: HwTune) -> str:
    required_values = (
        tune.lf_125khz_voltage,
        tune.lf_134_83khz_voltage,
        tune.lf_optimal_frequency_khz,
        tune.lf_optimal_voltage,
        tune.lf_frequency_bandwidth,
        tune.lf_peak_voltage,
        tune.hf_13_56mhz_voltage,
        tune.hf_peak_voltage,
    )
    statuses = (tune.lf_antenna_status, tune.hf_antenna_status)
    if any(status and ("not" in status or "fail" in status or "missing" in status) for status in statuses):
        return "FAIL"
    if all(status == "ok" for status in statuses) and all(value is not None for value in required_values):
        return "OK"
    return "WARN"


def _usage_line(output: str) -> str | None:
    lines = output.splitlines()
    for index, line in enumerate(lines):
        if line.strip().lower() == "usage:":
            for candidate in lines[index + 1 :]:
                stripped = candidate.strip()
                if stripped:
                    return stripped
    return None


def _option_lines(output: str) -> list[str]:
    lines = output.splitlines()
    options: list[str] = []
    in_options = False
    for line in lines:
        stripped = line.strip()
        if stripped.lower() == "options:":
            in_options = True
            continue
        if in_options and not stripped:
            continue
        if in_options and stripped.lower().endswith(":"):
            break
        if in_options and stripped:
            options.append(stripped)
    return options
