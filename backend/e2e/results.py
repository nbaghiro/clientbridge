"""Reject missing, skipped, retried or unexpectedly failing functional evidence."""

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
from xml.etree import ElementTree

from pydantic import BaseModel, Field

REQUIRED_CASES = {
    "web": [
        "BILL-PILOT-01",
        "BILL-PILOT-02",
        "CRM-E2E-01",
        "CRM-E2E-02",
        "CRM-E2E-03",
        "CRM-E2E-04",
        "SCH-PILOT-01",
        "BILL-DOC-01",
        "BILL-DOC-02",
        "BILL-DOC-03",
        "BILL-DOC-04",
        "BILL-DOC-20",
        "SEC-E2E-01",
        "SEC-E2E-02",
        "OFF-E2E-01",
        "OFF-E2E-02",
        "OFF-E2E-03",
        "OFF-E2E-04",
        "SYN-E2E-08",
        "SYN-E2E-02",
        "CFG-E2E-01",
        "CFG-E2E-02",
        "CFG-E2E-03",
        "CFG-E2E-04",
        "FILES-E2E-01",
        "MSG-E2E-01",
        "MSG-E2E-02",
        "MSG-E2E-03",
        "PAY-E2E-01",
        "PAY-E2E-02",
        "PAY-E2E-03",
        "REF-E2E-01",
        "SALE-E2E-01",
        "SALE-E2E-02",
        "ENT-E2E-01",
        "ENT-E2E-02",
        "ENT-E2E-03",
        "CRM-E2E-08",
        "FIN-REPORT-01",
        "FIN-EXPORT-02",
        "MSG-E2E-10",
        "MSG-E2E-11",
        "MSG-E2E-12",
        "MSG-E2E-13",
        "MSG-E2E-16",
        "PLN-E2E-01",
        "PLN-E2E-02",
        "PLN-E2E-03",
        "ID-E2E-01",
        "OPS-E2E-01",
        "OPS-E2E-02",
        "OPS-E2E-03",
        "SALE-E2E-10",
        "SALE-E2E-11",
        "STR-E10",
    ],
    "connect": [
        "DOC-E2E-01",
        "DOC-E2E-02",
        "DOC-E2E-03",
        "DOC-E2E-04",
        "DOC-E2E-05",
        "EMBED-E2E-01",
        "DOC-E2E-06",
        "SALE-E2E-03",
        "OPS-E2E-04",
        "OPS-E2E-05",
        "OPS-E2E-06",
    ],
    "journeys": [
        "CLS-E2E-01",
        "CRM-E2E-05",
        "CRM-E2E-06",
        "CRM-E2E-07",
        "SCH-E2E-03",
        "SCH-E2E-04",
        "SCH-E2E-05",
        "SCH-E2E-06",
        "SCH-E2E-07",
        "CLS-E2E-02",
        "MSG-E2E-14",
        "MSG-E2E-15",
        "SALE-E2E-12",
        "FLOW-02-A",
        "FLOW-02-B",
        "FLOW-03-A",
        "FLOW-03-B",
        "FLOW-04-A",
        "FLOW-04-B",
        "FLOW-05-A",
        "FLOW-05-B",
        "FLOW-06-A",
        "FLOW-06-B",
        "FLOW-07-A",
        "FLOW-07-B",
        "FLOW-08-A",
        "FLOW-08-B",
        "FLOW-09-A",
        "FLOW-10-A",
    ],
    "filings": ["FIN-RETURN-03"],
    "native-ios": ["NATIVE-CRM-01", "NATIVE-IOS-01", "NATIVE-IOS-02", "NATIVE-IOS-03"],
    "native-android": ["NATIVE-CRM-01", "NATIVE-IOS-01", "NATIVE-IOS-02"],
    "stripe": [
        "STRIPE-BROWSER-01",
        "STRIPE-BROWSER-02",
        "STRIPE-BROWSER-03",
        "STRIPE-BROWSER-04",
        "STRIPE-BROWSER-05",
        "STRIPE-BROWSER-06",
        "FIN-DEPOSIT-04",
        "FIN-DEPOSIT-10",
        "STR-E01",
        "STR-E02",
        "STR-E03",
        "STR-E04",
        "STR-E05",
        "STR-E06",
        "STR-E07",
        "STR-E09",
        "STR-E12",
        "STR-E13",
    ],
}


BROWSERS = ("firefox", "webkit")
# the cases each Firefox and WebKit project must run, keyed by their cross-browser case ID
BROWSER_CASES = {
    "web": {
        "XB-E2E-01": "sign up, confirm the email with the mailed code, then open a business",
        "XB-E2E-02": "recover a forgotten password with an emailed code, staying signed in only "
        "here",
        "XB-E2E-03": "changing the password signs out every other device",
        "XB-E2E-04": "turn on an authenticator app, then sign in with its code",
        "XB-E2E-05": "the production shell restores its replica offline and locks expired offline "
        "access without deleting it",
        "XB-E2E-06": "OFF-E2E-01",
        "XB-E2E-07": "BILL-PILOT-02",
        "XB-E2E-08": "owner: shell, today, create menu, search, notifications and account menu",
        "XB-E2E-17": "XB-E2E-17",
        "XB-E2E-20": "XB-E2E-20",
        "XB-E2E-21": "XB-E2E-21",
    },
    "connect": {
        "XB-E2E-09": "business navigation connects the shop, booking, and homepage sections on "
        "mobile",
        "XB-E2E-10": "product deep links, cart, and checkout contact details survive navigation "
        "and reload",
        "XB-E2E-11": "SALE-E2E-03",
        "XB-E2E-12": "booking drafts restore contact details and remain scoped to their business",
        "XB-E2E-13": "bank setup rejects a missing link and removes provider secrets from the URL",
        "XB-E2E-14": "a client sees a deposit due on the manage link and how to pay it",
    },
    "stripe": {"XB-E2E-15": "STRIPE-BROWSER-01", "XB-E2E-16": "STRIPE-BROWSER-03"},
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
WEBKIT_EXCLUDED = frozenset({"XB-E2E-05", "XB-E2E-06"})
# the tag that keeps a case out of the WebKit project, matched by its grepInvert
WEBKIT_EXCLUDED_TAG = "@no-webkit"


def browser_cases(surface: str) -> dict[str, list[str]]:
    cases = BROWSER_CASES.get(surface, {})
    if not cases:
        return {}
    return {
        project: [
            title
            for identity, title in cases.items()
            if project != "webkit" or identity not in WEBKIT_EXCLUDED
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
