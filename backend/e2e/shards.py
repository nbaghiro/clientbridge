"""List a lane's Playwright cases and balance them into shards by their measured seconds."""

import argparse
import json
import os
import random
import re
import subprocess
from pathlib import Path
from typing import cast

from e2e.results import (
    Report,
    Spec,
)
from e2e.stack import Stack
from e2e.tier import ROOT


def playwright_app(surface: str) -> str:
    return "web" if surface in ("journeys", "filings") else surface


def playwright_config(surface: str) -> str:
    return (
        f"playwright.{surface}.config.ts"
        if surface in ("journeys", "filings")
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
            f"--project={args.project}",
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


def shard_seconds(units: dict[str, int], picked: list[str]) -> float:
    """A shard's expected wall time: workers share its cases, but one file runs on one worker."""
    files: dict[str, int] = {}
    for unit in picked:
        file = unit.rsplit(":", 1)[0]
        files[file] = files.get(file, 0) + units[unit]
    return max(sum(files.values()) / WORKERS, max(files.values(), default=0))


def balanced(units: dict[str, int], shards: int) -> list[list[str]]:
    """Longest first, each to the shard whose expected wall time grows the least."""
    picked: list[list[str]] = [[] for _ in range(shards)]
    for unit, _ in sorted(units.items(), key=lambda item: (-item[1], item[0])):
        best = min(range(shards), key=lambda i: (shard_seconds(units, [*picked[i], unit]), i))
        picked[best].append(unit)
    return picked


def shard_filters(cases: list[Spec], seconds: dict[str, int], shard: str) -> list[str]:
    """This shard's cases as file:line filters, balanced by each case's measured seconds."""
    index, total = (int(part) for part in shard.split("/"))
    known = sorted(seconds.values())
    usual = known[len(known) // 2] if known else 30
    units: dict[str, int] = {}
    for case in cases:
        # cases declared on one line, such as a loop's, can only be selected together
        unit = f"e2e/{case.file}:{case.line}"
        units[unit] = units.get(unit, 0) + seconds.get(case.key, usual)
    picked = balanced(units, total)[index - 1]
    if not picked:
        raise ValueError(f"shard {shard} has no cases; use fewer shards")
    return sorted(picked)


def case_seconds(surface: str) -> dict[str, int]:
    path = ROOT / "frontend" / "apps" / playwright_app(surface) / "e2e" / "case-seconds.json"
    return cast(dict[str, int], json.loads(path.read_text())) if path.is_file() else {}


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
