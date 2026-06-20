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
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService, SAFE_LIVE_COMMANDS


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

    subparsers.add_parser(
        "live-scan",
        help="Run a safe read-only live PM3 scan using the pm3 wrapper auto-port detection.",
    )

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
        return _print_capture_summary("PM3 live scan summary", LivePm3ReadonlyService())
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

def _print_capture_summary(title: str, provider) -> int:
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
