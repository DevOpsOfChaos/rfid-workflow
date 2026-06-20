from __future__ import annotations

import argparse
from pathlib import Path

from pm3_workflow_gui.services.capture import (
    FixtureCaptureProvider,
    Pm3LogCaptureProvider,
    latest_log_file,
)
from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
    default_launch_config,
)
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService, SAFE_HITAG_READ_COMMANDS, SAFE_LIVE_COMMANDS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pm3-workflow")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fixture_summary = subparsers.add_parser(
        "fixture-summary",
        help="Summarize read-only PM3 discovery fixtures without hardware access.",
    )
    fixture_summary.add_argument("--fixture-dir", type=Path, help="Directory containing PM3 text fixtures.")
    fixture_summary.add_argument("--scenario", type=Path, help="Scenario JSON describing related fixtures.")

    scenario_summary = subparsers.add_parser(
        "scenario-summary",
        help="Summarize a fixture scenario JSON without hardware access.",
    )
    scenario_summary.add_argument("--scenario", type=Path, required=True, help="Scenario JSON describing related fixtures.")

    log_summary = subparsers.add_parser(
        "log-summary",
        help="Summarize an existing PM3 session log without running PM3.",
    )
    log_summary.add_argument("--log", type=Path, required=True, help="PM3 session log path.")

    latest_log_summary = subparsers.add_parser(
        "latest-log-summary",
        help="Summarize the newest PM3 session log in a directory.",
    )
    latest_log_summary.add_argument("--log-dir", type=Path, required=True, help="Directory containing PM3 session logs.")

    live_scan = subparsers.add_parser(
        "live-scan",
        help="Run a safe read-only live PM3 scan using the pm3 wrapper auto-port detection.",
    )
    live_scan.add_argument("--debug", action="store_true", help="Print per-command live PM3 launch diagnostics and raw output snippets.")

    args = parser.parse_args(argv)
    if args.command == "fixture-summary":
        return _fixture_summary(args.fixture_dir, args.scenario)
    if args.command == "scenario-summary":
        return _print_capture_summary("PM3 scenario summary", FixtureCaptureProvider(scenario_path=args.scenario))
    if args.command == "log-summary":
        return _print_capture_summary("PM3 log summary", Pm3LogCaptureProvider(args.log))
    if args.command == "latest-log-summary":
        return _print_capture_summary("PM3 latest log summary", Pm3LogCaptureProvider(latest_log_file(args.log_dir)))
    if args.command == "live-scan":
        print("Live read-only commands: " + ", ".join(SAFE_LIVE_COMMANDS))
        print("Gated Hitag read-only commands: " + ", ".join(SAFE_HITAG_READ_COMMANDS))
        service = LivePm3ReadonlyService()
        return _print_capture_summary("PM3 live scan summary", service, debug=args.debug, include_hitag_debug=args.debug)
    parser.error(f"Unsupported command: {args.command}")
    return 2


def _fixture_summary(fixture_dir: Path | None, scenario: Path | None) -> int:
    if not fixture_dir and not scenario:
        raise SystemExit("fixture-summary requires --fixture-dir or --scenario")

    if scenario:
        provider = FixtureCaptureProvider(scenario_path=scenario)
    else:
        provider = FixtureCaptureProvider(fixture_dir=fixture_dir)
    return _print_capture_summary("PM3 fixture summary", provider)

def _print_capture_summary(title: str, provider, debug: bool = False, include_hitag_debug: bool = False) -> int:
    facade = DiscoveryFacade(default_launch_config())
    capture = provider.capture()
    summary = capture.summarize(facade)
    print(title)
    print(f"Source: {capture.source}")
    for line in summary.lines():
        print(line)
    if capture.command_outputs:
        print("Recognized commands:")
        for command, outputs in sorted(capture.command_outputs.items()):
            print(f"- {command} ({len(outputs)} capture(s))")
    if capture.ignored_host_commands:
        print("Ignored host commands:")
        for command in capture.ignored_host_commands:
            print(f"- {command}")
    if capture.missing_fields:
        label = "Missing optional sections" if summary.tag_type_guess == "hitag_s256_plain" else "Missing sections"
        print(f"{label}: " + ", ".join(capture.missing_fields))
    if debug:
        _print_live_debug(capture)
    if include_hitag_debug and isinstance(provider, LivePm3ReadonlyService):
        _print_hitag_live_debug(provider)
    return 0


def _print_live_debug(capture) -> None:
    results = getattr(capture, "debug_results", ())
    status = getattr(capture, "connection_status", None)
    print("Live debug:")
    if status is not None:
        print(f"- port_detected: {'yes' if status.connected else 'no'}")
        print(f"- detected_ports: {', '.join(status.ports) if status.ports else 'none'}")
        if status.last_error:
            print(f"- port_error: {status.last_error}")
    if not results:
        print("- commands: none")
        return
    for result in results:
        raw = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        snippet = raw[:1200] + ("..." if len(raw) > 1200 else "")
        print(f"- command: {result.command}")
        print(f"  launch: {result.launch_variant}")
        print(f"  exitcode: {result.returncode}")
        print(f"  elapsed_seconds: {result.elapsed_seconds:.2f}")
        print(f"  timed_out: {'yes' if result.timed_out else 'no'}")
        print(f"  stdout: {'yes' if result.stdout else 'no'} ({len(result.stdout)} chars)")
        print(f"  stderr: {'yes' if result.stderr else 'no'} ({len(result.stderr)} chars)")
        print("  raw_excerpt:")
        for line in snippet.splitlines() or [""]:
            print(f"    {line}")


def _print_hitag_live_debug(service: LivePm3ReadonlyService) -> None:
    result = service.read_hitag_s256()
    print("Hitag S256 live read:")
    print(f"- status: {result.status}")
    print(f"- port: {result.port or 'unknown'}")
    print(f"- message: {result.message or 'none'}")
    if result.lf_search:
        print(f"- lf_uid: {result.lf_search.uid or 'unknown'}")
        print(f"- lf_type: {result.lf_search.tag_type or 'unknown'}")
        print(f"- lf_chipset: {result.lf_search.chipset or 'unknown'}")
    if result.hitag_read:
        print(f"- chip: {result.hitag_read.memory_type or 'unknown'}")
        print(f"- uid: {result.hitag_read.uid or 'unknown'}")
        print(f"- config: {result.hitag_read.config_page or 'unknown'}")
        print(f"- data_rate: {result.hitag_read.ttf_data_rate or 'unknown'}")
        print(f"- mode: {result.hitag_read.ttf_mode or 'unknown'}")
        for page in sorted(result.hitag_read.pages):
            if page in {4, 5, 6, 7}:
                print(f"- block_{page}: {result.hitag_read.pages[page].data}")
    if result.raw_results:
        print("- gated_commands:")
        for command_result in result.raw_results:
            print(f"  - {command_result.command}: exit={command_result.returncode}, timeout={'yes' if command_result.timed_out else 'no'}")


if __name__ == "__main__":
    raise SystemExit(main())
