"""Reject missing, skipped, retried or unexpectedly failing functional evidence."""

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from xml.etree import ElementTree

from pydantic import BaseModel, Field, TypeAdapter

Lane = Literal[
    "web", "connect", "journeys", "filings", "stripe", "native-ios", "native-android", "sync"
]


class Case(BaseModel):
    lanes: list[Lane]
    browsers: bool
    families: list[str]
    status: Literal["implemented", "verified", "needs_decision", "deferred"]


CASES: dict[str, Case] = TypeAdapter(dict[str, Case]).validate_json(
    Path(__file__).with_name("cases.json").read_bytes()
)
# a lane requires its implemented cases; one awaiting a decision or deferred is left out
REQUIRED_CASES = {
    lane: [
        identity
        for identity, case in CASES.items()
        if lane in case.lanes and case.status in ("implemented", "verified")
    ]
    for lane in ("web", "connect", "journeys", "filings", "native-ios", "native-android", "stripe")
}


BROWSERS = ("firefox", "webkit")
# the cases each Firefox and WebKit project must run
BROWSER_CASES = {
    lane: [identity for identity, case in CASES.items() if case.browsers and lane in case.lanes]
    for lane in ("web", "connect", "stripe")
}


# the replica lifecycle cases, which make test-sync runs in every engine; the @opfs ones need OPFS
SYNC_LIFECYCLE = [
    "reauthentication preserves edits and account/environment switches isolate replicas",
    "initialization opens only the account-scoped replica",
    "tabs opening the same fresh replica at once both claim it",
    "SYN-E2E-20",
    "SYN-E2E-31",
    "SYN-E2E-34",
]
# Firefox's shared sync worker keeps the connection of every stream it restarts, so it skips these
SYNC_LIFECYCLE_RESTARTS = ["SYN-E2E-32"]
SYNC_LIFECYCLE_OPFS = [
    "close keeps the replica file and the next activation reopens it",
    "discard with removeReplicaFiles leaves no file of the replica",
    "replica files are removed only once no page holds them",
    "SYN-E2E-22",
    "SYN-E2E-23",
    "SYN-E2E-27",
    "SYN-E2E-28",
    "SYN-E2E-33",
]
# the outbox cases, which also run on IndexedDB
SYNC_HOURS = [
    "hours proposals coalesce before upload and retain immutable identities after a lost response",
    "a rejected week blocks its successors while unrelated staff edits proceed",
    "a paused upload releases its lease even if its transport ignores cancellation",
    "another editor cannot overwrite a proposal it did not observe",
    "accepted work reconciles after access removal, while unsent work survives until "
    "explicitly discarded",
    "SYN-E2E-24",
    "SYN-E2E-25",
]
ROLES = ("owner", "admin", "staff", "contractor", "multi", "foreign")
# every case of make test-sync, by Playwright project; a case named by its whole title has no ID
SYNC_CASES = {
    "chromium": [
        "browser tabs observe account replacement, bind replicas to their user and sign out",
        "lost command response replays once and the accepted week returns through PowerSync",
        *SYNC_HOURS,
        *SYNC_LIFECYCLE,
        *SYNC_LIFECYCLE_RESTARTS,
        *SYNC_LIFECYCLE_OPFS,
        *(f"{role} receives only authorized businesses through the real service" for role in ROLES),
        "selected-business queries isolate lists, details and aggregate subqueries",
        "SYN-E2E-21",
        "SYN-E2E-26",
        "SYN-E2E-29",
        *(
            f"{role} receives no column outside its reviewed projection in any synced table"
            for role in ROLES
        ),
        "live renames reach the replica; downgrade, deletion and removal purge its data",
        "SYN-E2E-30",
        "a write past the origin's quota on OPFS reads as storage full",
    ],
    "firefox": SYNC_LIFECYCLE + SYNC_LIFECYCLE_OPFS,
    "webkit": SYNC_LIFECYCLE + SYNC_LIFECYCLE_RESTARTS + SYNC_LIFECYCLE_OPFS,
    "chromium-indexeddb": SYNC_LIFECYCLE + SYNC_LIFECYCLE_RESTARTS + SYNC_HOURS,
    "firefox-indexeddb": SYNC_LIFECYCLE + SYNC_HOURS,
}


# Playwright's WebKit can't load a service-worker page offline; Chromium and Firefox run these
WEBKIT_EXCLUDED = frozenset({"XB-E2E-05", "OFF-E2E-01"})
# the tag that keeps a case out of the WebKit project, matched by its grepInvert
WEBKIT_EXCLUDED_TAG = "@no-webkit"


def browser_cases(surface: str) -> dict[str, list[str]]:
    cases = BROWSER_CASES.get(surface, [])
    if not cases:
        return {}
    return {
        project: [
            identity for identity in cases if project != "webkit" or identity not in WEBKIT_EXCLUDED
        ]
        for project in BROWSERS
    }


def matches(title: str, identity: str) -> bool:
    """A case ID prefixes its title; a case without one is named by its whole title."""
    return title == identity or title.startswith(f"{identity} ")


class Attempt(BaseModel):
    status: str
    retry: int
    duration: int = 0


class Test(BaseModel):
    expectedStatus: str
    results: list[Attempt]
    status: str
    projectName: str = ""


class Spec(BaseModel):
    title: str
    tests: list[Test]
    file: str = ""
    line: int = 0

    @property
    def key(self) -> str:
        return f"{self.file} > {self.title}"


class Suite(BaseModel):
    specs: list[Spec] = Field(default_factory=list)
    suites: list["Suite"] = Field(default_factory=list)

    def cases(self) -> list[Spec]:
        return self.specs + [case for suite in self.suites for case in suite.cases()]


class Report(BaseModel):
    errors: list[object]
    suites: list[Suite]

    def validate_evidence(
        self, required: list[str], by_project: Mapping[str, list[str]] | None = None
    ) -> None:
        cases = [case for suite in self.suites for case in suite.cases()]
        if self.errors or not cases:
            raise ValueError("the run has global errors or no cases")
        missing = [
            identity for identity in required if not any(matches(c.title, identity) for c in cases)
        ]
        missing += [
            f"{identity} in {project}"
            for project, identities in (by_project or {}).items()
            for identity in identities
            if not any(
                matches(c.title, identity) and any(t.projectName == project for t in c.tests)
                for c in cases
            )
        ]
        if missing:
            raise ValueError(f"required functional cases are missing: {', '.join(missing)}")
        passed = 0
        for case in cases:
            if not case.tests:
                raise ValueError(f"case was discovered but did not execute: {case.title}")
            for test in case.tests:
                if case.title.startswith("presentation demo:") and test.status == "skipped":
                    continue
                if test.expectedStatus != "passed" or test.status != "expected":
                    raise ValueError(f"case did not pass normally: {case.title}")
                if (
                    len(test.results) != 1
                    or test.results[0].status != "passed"
                    or test.results[0].retry != 0
                ):
                    raise ValueError(f"case lacks a clean first attempt: {case.title}")
                passed += 1
        if not passed:
            raise ValueError("no functional cases passed")

    def case_seconds(self) -> dict[str, int]:
        """How long each case's first attempt took, which the next runs' shards are balanced by."""
        return {
            case.key: round(sum(t.results[0].duration for t in case.tests if t.results) / 1000)
            for suite in self.suites
            for case in suite.cases()
            if any(t.results for t in case.tests)
        }

    def first_attempts(self) -> list[dict[str, object]]:
        """Each case's first-attempt outcome in every repetition, and whether they agreed."""
        outcomes: list[dict[str, object]] = []
        for case in (case for suite in self.suites for case in suite.cases()):
            projects: dict[str, list[str]] = {}
            for test in case.tests:
                first = test.results[0].status if test.results else "not_run"
                projects.setdefault(test.projectName, []).append(first)
            for project, attempts in projects.items():
                passed = attempts.count("passed")
                verdict = (
                    "skipped"
                    if attempts.count("skipped") == len(attempts)
                    else "stable"
                    if passed == len(attempts)
                    else "failing"
                    if passed == 0
                    else "flaky"
                )
                outcomes.append(
                    {
                        "case": case.title,
                        "project": project,
                        "attempts": attempts,
                        "verdict": verdict,
                    }
                )
        return outcomes


def validate_native_evidence(junit: str, required: list[str]) -> None:
    """Every Maestro flow passed on its only attempt, and every required case ran."""
    cases = ElementTree.fromstring(junit).findall("./testsuite/testcase")
    if not cases:
        raise ValueError("the native run has no flows")
    names = [case.get("name", "") for case in cases]
    missing = [i for i in required if not any(name.startswith(f"{i} ") for name in names)]
    if missing:
        raise ValueError(f"required native cases are missing: {', '.join(missing)}")
    if len(set(names)) != len(names):
        raise ValueError("a native flow ran more than once")
    for case in cases:
        # a tagged flow carries a <properties> child, so only an outcome child marks it unclean
        if case.get("status") != "SUCCESS" or any(
            child.tag in ("failure", "error", "skipped") for child in case
        ):
            raise ValueError(f"native flow did not pass: {case.get('name')}")


def merged(paths: list[Path]) -> Report:
    """One report from a lane's shards, so its required cases are checked across all of them."""
    reports = [Report.model_validate_json(path.read_text()) for path in paths]
    return Report(
        errors=[error for report in reports for error in report.errors],
        suites=[suite for report in reports for suite in report.suites],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--required", nargs="*", default=[])
    parser.add_argument("--surface", choices=tuple(REQUIRED_CASES))
    parser.add_argument("--seconds", type=Path, help="also write each case's measured seconds here")
    args = parser.parse_args()
    required = REQUIRED_CASES.get(args.surface, []) + args.required
    report = merged(args.reports)
    if args.seconds is not None:
        args.seconds.write_text(json.dumps(report.case_seconds(), indent=4, sort_keys=True) + "\n")
    report.validate_evidence(required)
    print("Functional evidence passed: no missing required cases, skipped cases or retries.")


if __name__ == "__main__":
    main()
