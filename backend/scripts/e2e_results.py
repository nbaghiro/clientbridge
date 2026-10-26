"""Reject missing, skipped, retried or unexpectedly failing functional evidence."""

import argparse
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
        "SEC-E2E-01",
        "SEC-E2E-02",
        "OFF-E2E-01",
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
        "REF-E2E-01",
        "SALE-E2E-01",
        "SALE-E2E-02",
        "ENT-E2E-01",
        "ENT-E2E-02",
        "ENT-E2E-03",
        "CRM-E2E-08",
        "FIN-REPORT-01",
        "FIN-EXPORT-02",
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


def browser_cases(surface: str) -> dict[str, list[str]]:
    cases = list(BROWSER_CASES.get(surface, {}).values())
    return {project: cases for project in BROWSERS} if cases else {}


def matches(title: str, identity: str) -> bool:
    """A case ID prefixes its title; a case without one is named by its whole title."""
    return title == identity or title.startswith(f"{identity} ")


class Attempt(BaseModel):
    status: str
    retry: int


class Test(BaseModel):
    expectedStatus: str
    results: list[Attempt]
    status: str
    projectName: str = ""


class Spec(BaseModel):
    title: str
    tests: list[Test]


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
        if case.get("status") != "SUCCESS" or len(case):
            raise ValueError(f"native flow did not pass: {case.get('name')}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--required", nargs="*", default=[])
    parser.add_argument("--surface", choices=tuple(REQUIRED_CASES))
    args = parser.parse_args()
    required = REQUIRED_CASES.get(args.surface, []) + args.required
    Report.model_validate_json(args.report.read_text()).validate_evidence(required)
    print("Functional evidence passed: no missing required cases, skipped cases or retries.")


if __name__ == "__main__":
    main()
