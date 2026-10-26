"""Break representative invariants in a disposable worktree and require their cases to fail."""

import argparse
import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from clientbridge.core import clock
from scripts.e2e_results import Report, matches

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


def caught(tree: Path, mutation: Mutation, log: Path) -> dict[str, object]:
    """Run the case against the broken source; only that case failing counts as caught."""
    if mutation.surface is None:
        code = run(
            [
                "uv",
                "run",
                "python",
                "-m",
                "scripts.fresh_database",
                "pytest",
                "-q",
                "-p",
                "no:cacheprovider",
                mutation.case,
            ],
            tree / "backend",
            log,
        )
        # pytest exits 1 when a test failed; anything else is an error or a missing test
        return {"exit": code, "caught": code == 1}
    before = set((tree / ".scratchpad").glob("e2e-*"))
    code = run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "scripts.e2e_stack",
            "--surface",
            mutation.surface,
            "--grep",
            mutation.case,
        ],
        tree / "backend",
        log,
    )
    (directory,) = set((tree / ".scratchpad").glob("e2e-*")) - before
    report = directory / "browser-results" / "results.json"
    outcome: dict[str, object] = {"exit": code, "run": directory.name, "caught": False}
    if not report.is_file():
        outcome["reason"] = "no browser report: the stack failed before the case ran"
        return outcome
    cases = [
        case
        for suite in Report.model_validate_json(report.read_text()).suites
        for case in suite.cases()
        if matches(case.title, mutation.case)
    ]
    statuses = [result.status for case in cases for test in case.tests for result in test.results]
    outcome["statuses"] = statuses
    outcome["caught"] = code != 0 and bool(statuses) and "passed" not in statuses
    return outcome


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
            for name in ("run.json", "browser-results/results.json"):
                if "run" in outcome:
                    source = tree / ".scratchpad" / str(outcome["run"]) / name
                    if source.is_file():
                        target = summary_dir / mutation.name / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy(source, target)
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
