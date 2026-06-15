from __future__ import annotations

import argparse
from pathlib import Path

from pm3_workflow_gui.services.discovery_facade import (
    DiscoveryFacade,
    default_launch_config,
    load_default_fixture_dir,
    load_scenario,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pm3-workflow")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fixture_summary = subparsers.add_parser(
        "fixture-summary",
        help="Summarize read-only PM3 discovery fixtures without hardware access.",
    )
    fixture_summary.add_argument("--fixture-dir", type=Path, help="Directory containing PM3 text fixtures.")
    fixture_summary.add_argument("--scenario", type=Path, help="Scenario JSON describing related fixtures.")

    args = parser.parse_args(argv)
    if args.command == "fixture-summary":
        return _fixture_summary(args.fixture_dir, args.scenario)
    parser.error(f"Unsupported command: {args.command}")
    return 2


def _fixture_summary(fixture_dir: Path | None, scenario: Path | None) -> int:
    if not fixture_dir and not scenario:
        raise SystemExit("fixture-summary requires --fixture-dir or --scenario")

    facade = DiscoveryFacade(default_launch_config())
    if scenario:
        summary = facade.summarize_scenario(load_scenario(scenario))
    else:
        summary = facade.summarize_texts(load_default_fixture_dir(fixture_dir))

    print("PM3 fixture summary")
    for line in summary.lines():
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
