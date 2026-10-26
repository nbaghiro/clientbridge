"""Break representative invariants in a disposable worktree and require their cases to fail."""

import argparse
import json
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from clientbridge.core import clock
from e2e.results import Report, matches

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    # an e2e case ID on a surface, or a backend test node id when no browser case owns it
    case: str
    surface: str | None = None


MUTATIONS = (
    Mutation(
        name="skip-deposit-application",
        path="backend/src/clientbridge/services/billing.py",
        old="applied = await apply_deposit(db, booking, invoice) or applied",
        new="applied = applied or False",
        case="BILL-DOC-03",
        surface="web",
    ),
    Mutation(
        name="drop-consent-recheck",
        path="backend/src/clientbridge/services/deliveries.py",
        old="await _texts_stopped(db, row.business_id, payload)",
        new="False",
        case="tests/test_deliveries.py::test_a_text_queued_before_a_stop_is_skipped_for_consent",
    ),
    Mutation(
        name="unscope-client-load",
        path="backend/src/clientbridge/services/clients.py",
        old="scoped(Client, biz, soft_delete=True).where(Client.id == client_id)",
        new="select(Client).where(Client.id == client_id)",
        case="SEC-E2E-02",
        surface="web",
    ),
)


def git(*arguments: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(["git", *arguments], cwd=cwd, text=True)


def run(command: list[str], cwd: Path, log: Path) -> int:
    with log.open("ab") as output:
        return subprocess.run(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT).returncode


def apply(tree: Path, mutation: Mutation) -> None:
    path = tree / mutation.path
    source = path.read_text()
    if source.count(mutation.old) != 1:
        raise RuntimeError(f"{mutation.name}: its anchor is gone from {mutation.path}; update it")
    path.write_text(source.replace(mutation.old, mutation.new))


def backend_outcomes(tree: Path, cases: list[str], log: Path, report: Path) -> dict[str, str]:
    """Run backend cases on their own seeded database, and read each case's outcome back."""
    run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "e2e.database",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            f"--junitxml={report}",
            *cases,
        ],
        tree / "backend",
        log,
    )
    found: dict[str, str] = {}
    if report.is_file():
        for case in ET.parse(report).iter("testcase"):
            node = f"{case.get('classname', '').replace('.', '/')}.py::{case.get('name')}"
            kinds = [child.tag for child in case]
            found[node] = next((k for k in ("failure", "error", "skipped") if k in kinds), "passed")
    report.unlink(missing_ok=True)
    return {case: found.get(case, "not run") for case in cases}


def browser_outcomes(
    tree: Path, surface: str, cases: list[str], log: Path
) -> tuple[int, str | None, dict[str, list[str]]]:
    """Run a surface's cases in one lane, and return each case's attempt statuses."""
    before = set((tree / ".scratchpad").glob("e2e-*"))
    pattern = "|".join(f"{re.escape(case)}( |$)" for case in cases)
    code = run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "e2e.runner",
            "--surface",
            surface,
            "--",
            "--grep",
            pattern,
        ],
        tree / "backend",
        log,
    )
    created = set((tree / ".scratchpad").glob("e2e-*")) - before
    directory = created.pop() if len(created) == 1 else None
    report = directory / "browser-results" / "results.json" if directory else None
    statuses: dict[str, list[str]] = {case: [] for case in cases}
    if report is not None and report.is_file():
        for spec in (
            spec
            for suite in Report.model_validate_json(report.read_text()).suites
            for spec in suite.cases()
        ):
            for case in cases:
                if matches(spec.title, case):
                    statuses[case] += [r.status for t in spec.tests for r in t.results]
    return code, directory.name if directory else None, statuses


def baseline(tree: Path, chosen: list[Mutation], log: Path) -> dict[str, object]:
    """Every chosen case must pass on the unbroken source, or a failure later proves nothing."""
    outcome: dict[str, object] = {}
    backend = [m.case for m in chosen if m.surface is None]
    if backend:
        found = backend_outcomes(tree, backend, log, log.parent / "baseline-backend.xml")
        outcome["backend"] = found
        broken = [case for case, status in found.items() if status != "passed"]
        if broken:
            raise BaselineFailed(f"backend cases did not pass unbroken: {', '.join(broken)}")
    for surface in sorted({m.surface for m in chosen if m.surface is not None}):
        cases = [m.case for m in chosen if m.surface == surface]
        code, directory, statuses = browser_outcomes(tree, surface, cases, log)
        outcome[surface] = {"exit": code, "run": directory, "statuses": statuses}
        broken = [case for case, found in statuses.items() if not found or "passed" not in found]
        if code != 0 or broken:
            raise BaselineFailed(
                f"the {surface} lane did not pass unbroken (exit {code}; "
                f"cases without a pass: {', '.join(broken) or 'none'}); see {directory}"
            )
    return outcome


def caught(tree: Path, mutation: Mutation, log: Path) -> dict[str, object]:
    """Run the case against the broken source; only that case failing counts as caught."""
    if mutation.surface is None:
        report = log.parent / f"{mutation.name}.xml"
        status = backend_outcomes(tree, [mutation.case], log, report)[mutation.case]
        # a test error or a case that never ran is a broken environment, not a caught mutation
        return {"status": status, "caught": status == "failure"}
    code, directory, statuses = browser_outcomes(tree, mutation.surface, [mutation.case], log)
    found = statuses[mutation.case]
    outcome: dict[str, object] = {"exit": code, "run": directory, "statuses": found}
    if not found:
        outcome["reason"] = "no result for the case: the lane failed before it ran"
    outcome["caught"] = code != 0 and bool(found) and "passed" not in found
    return outcome


class BaselineFailed(RuntimeError):
    pass


def keep(tree: Path, run_name: str, target: Path) -> None:
    """Copy a lane's record out of the copy, which is deleted when the harness ends."""
    for name in ("run.json", "browser-results/results.json"):
        source = tree / ".scratchpad" / run_name / name
        if source.is_file():
            destination = target / run_name / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="*", choices=[m.name for m in MUTATIONS])
    args = parser.parse_args()
    chosen = [m for m in MUTATIONS if not args.only or m.name in args.only]
    summary_dir = ROOT / ".scratchpad" / f"mutations-{secrets.token_hex(6)}"
    summary_dir.mkdir(parents=True)
    status_before = git("status", "--porcelain")
    revision = git("rev-parse", "HEAD").strip()
    tree = Path(tempfile.mkdtemp(prefix="clientbridge-mutations-")) / "tree"
    results: list[dict[str, object]] = []
    summary: dict[str, object] = {
        # a deliberately broken source never qualifies a lane, whatever its runs report
        "qualifies": False,
        "revision": revision,
        "started_at": clock.wall().isoformat(),
        "mutations": results,
    }
    log = summary_dir / "mutations.log"
    git("worktree", "add", "--detach", str(tree), revision)
    try:
        for command, where in (
            (["uv", "sync", "--frozen"], "backend"),
            (["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], "frontend"),
        ):
            if run(command, tree / where, log):
                raise RuntimeError(f"installing {where} dependencies in the copy failed")
        try:
            summary["baseline"] = baseline(tree, chosen, log)
        except BaselineFailed as error:
            summary["baseline"] = {"failed": str(error)}
            raise
        finally:
            for found in (tree / ".scratchpad").glob("e2e-*"):
                keep(tree, found.name, summary_dir / "baseline")
        for mutation in chosen:
            apply(tree, mutation)
            try:
                outcome = caught(tree, mutation, log)
            finally:
                git("checkout", "--", mutation.path, cwd=tree)
            if git("status", "--porcelain", "--untracked-files=no", cwd=tree):
                raise RuntimeError(f"{mutation.name}: the copy did not restore cleanly")
            results.append({"name": mutation.name, "case": mutation.case, **outcome})
            print(json.dumps(results[-1]), flush=True)
            if outcome.get("run"):
                keep(tree, str(outcome["run"]), summary_dir / mutation.name)
    finally:
        git("worktree", "remove", "--force", str(tree))
        shutil.rmtree(tree.parent, ignore_errors=True)
        summary["finished_at"] = clock.wall().isoformat()
        summary["source_untouched"] = git("status", "--porcelain") == status_before
        (summary_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(f"Mutation summary: {summary_dir / 'summary.json'}", flush=True)
    missed = [str(r["name"]) for r in results if not r["caught"]]
    if missed or len(results) != len(chosen) or not summary["source_untouched"]:
        print(f"Mutations not caught: {', '.join(missed) or 'none'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
