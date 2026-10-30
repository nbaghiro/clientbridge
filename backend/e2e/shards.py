"""List a lane's Playwright cases and balance them into shards by their measured seconds."""

import argparse
import json
import os
import random
import re
import subprocess
from pathlib import Path
from typing import TypedDict, cast

from e2e.results import (
    Report,
    Spec,
)
from e2e.stack import Stack
from e2e.tier import ROOT


def playwright_app(surface: str) -> str:
    if surface == "stripe":
        return "connect"
    return "web" if surface in ("journeys", "filings") else surface


def playwright_config(surface: str) -> str:
    return (
        f"playwright.{surface}.config.ts"
        if surface in ("journeys", "filings", "stripe")
        else "playwright.config.ts"
    )


def listed_cases(stack: "Stack", args: argparse.Namespace) -> list[Spec]:
    """The cases the lane would run, with their files and lines, without running them."""
    listing = subprocess.run(
        [
            "pnpm",
            "exec",
            "playwright",
            "test",
            f"--config={playwright_config(args.surface)}",
            *([f"--project={args.project}"] if args.project else []),
            "--list",
            "--reporter=json",
            *args.tests,
        ],
        cwd=ROOT / "frontend" / "apps" / playwright_app(args.surface),
        env=stack.env,
        capture_output=True,
        text=True,
        check=True,
    )
    report = Report.model_validate_json(listing.stdout)
    return [case for suite in report.suites for case in suite.cases()]


# the Playwright configs' workers per lane
WORKERS = 2
SECONDS = Path(__file__).with_name("seconds.json")
FLOWS = ROOT / "frontend" / "apps" / "mobile" / "e2e"


def shard_seconds(units: dict[str, int], picked: list[str], workers: int = WORKERS) -> float:
    """A shard's expected wall time: workers share its cases, but one file runs on one worker."""
    files: dict[str, int] = {}
    for unit in picked:
        file = unit.rsplit(":", 1)[0]
        files[file] = files.get(file, 0) + units[unit]
    return max(sum(files.values()) / workers, max(files.values(), default=0))


def balanced(units: dict[str, int], shards: int, workers: int = WORKERS) -> list[list[str]]:
    """Longest first, each to the shard whose expected wall time grows the least."""
    picked: list[list[str]] = [[] for _ in range(shards)]
    for unit, _ in sorted(units.items(), key=lambda item: (-item[1], item[0])):
        best = min(
            range(shards), key=lambda i: (shard_seconds(units, [*picked[i], unit], workers), i)
        )
        picked[best].append(unit)
    return picked


def usual_seconds(seconds: dict[str, int]) -> int:
    """The median measured time, for a case or flow that has none yet."""
    known = sorted(seconds.values())
    return known[len(known) // 2] if known else 30


def shard_filters(
    cases: list[Spec],
    seconds: dict[str, int],
    shard: str,
    folder: str = "e2e",
    workers: int = WORKERS,
) -> list[str]:
    """This shard's cases as file:line filters, balanced by each case's measured seconds."""
    index, total = (int(part) for part in shard.split("/"))
    usual = usual_seconds(seconds)
    units: dict[str, int] = {}
    for case in cases:
        # cases declared on one line, such as a loop's, can only be selected together
        unit = f"{folder}/{case.file}:{case.line}"
        units[unit] = units.get(unit, 0) + seconds.get(case.key, usual)
    picked = balanced(units, total, workers)[index - 1]
    if not picked:
        raise ValueError(f"shard {shard} has no cases; use fewer shards")
    return sorted(picked)


def measured_seconds() -> dict[str, dict[str, int]]:
    return cast(dict[str, dict[str, int]], json.loads(SECONDS.read_text()))


def case_seconds(surface: str) -> dict[str, int]:
    if surface == "stripe":
        return measured_seconds().get("stripe", {})
    return measured_seconds()["web"] if playwright_app(surface) == "web" else {}


def flow_name(flow: Path) -> str:
    """A Maestro flow's name, which its reports and measured seconds use."""
    for line in flow.read_text().splitlines():
        if line.startswith("name: "):
            return line.removeprefix("name: ").strip()
    return flow.stem


class Shard(TypedDict):
    id: str
    name: str
    flows: list[str]


def native_shards(count: int) -> list[Shard]:
    """The Maestro flows in shards of about equal length; one device runs a shard in turn."""
    seconds = measured_seconds()["mobile"]
    usual = usual_seconds(seconds)
    units = {flow.name: seconds.get(flow_name(flow), usual) for flow in FLOWS.glob("*.yaml")}
    shards = [sorted(picked) for picked in balanced(units, count, workers=1)]
    if not all(shards):
        raise ValueError(f"{count} shards leave one without flows; use fewer shards")
    return [
        Shard(
            id=str(index),
            name=", ".join(flow.removesuffix(".yaml") for flow in picked),
            flows=picked,
        )
        for index, picked in enumerate(shards, 1)
    ]


def shuffled_config(stack: "Stack", args: argparse.Namespace, seed: int) -> str:
    """Order the lane's spec files by seed: Playwright runs files by name, so numbered wrappers."""
    app = ROOT / "frontend" / "apps" / playwright_app(args.surface)
    files = sorted({case.file for case in listed_cases(stack, args)})
    if not files:
        raise ValueError("the shuffled lane selected no spec files")
    random.Random(seed).shuffle(files)
    directory = app / "test-results" / f"shuffle-{stack.project}"
    cases = directory / "cases"
    cases.mkdir(parents=True)
    for rank, name in enumerate(files):
        target = os.path.relpath(app / "e2e" / name, cases)
        (cases / f"{rank:03d}-{Path(name).name}").write_text(f'import "{target}";\n')
    config = directory / "playwright.config.ts"
    config.write_text(
        f'import base from "{os.path.relpath(app / playwright_config(args.surface), directory)}";\n'
        "export default {\n"
        "    ...base,\n"
        '    testDir: "cases",\n'
        "    projects: (base.projects ?? []).map((project) => ({\n"
        '        ...project, testDir: "cases", testMatch: "*.ts", testIgnore: [],\n'
        "    })),\n"
        "    webServer: [base.webServer ?? []].flat().map((server) => ({\n"
        f"        ...server, cwd: {json.dumps(str(app))},\n"
        "    })),\n"
        "};\n"
    )
    (stack.directory / "shuffle.json").write_text(
        json.dumps({"seed": seed, "files": files}, indent=2) + "\n"
    )
    return str(config)


def shard(value: str) -> str:
    match = re.fullmatch(r"(\d+)/(\d+)", value)
    if not match or not 1 <= int(match[1]) <= int(match[2]):
        raise argparse.ArgumentTypeError("a shard is <index>/<total>, e.g. 2/3")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m e2e.shards")
    parser.add_argument("--surface", choices=("native",), required=True)
    parser.add_argument("--count", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(native_shards(args.count)))


if __name__ == "__main__":
    main()
