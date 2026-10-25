"""Reject missing, skipped, retried or unexpectedly failing functional evidence."""

import argparse
from pathlib import Path

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
        "FIN-REPORT-01",
        "FIN-EXPORT-02",
    ],
    "connect": [
        "DOC-E2E-01",
        "DOC-E2E-02",
        "DOC-E2E-03",
        "DOC-E2E-04",
        "DOC-E2E-05",
        "SALE-E2E-03",
    ],
    "journeys": [
        "CLS-E2E-01",
        "CRM-E2E-05",
        "CRM-E2E-06",
        "CRM-E2E-07",
        "SCH-E2E-03",
        "SCH-E2E-04",
    ],
    "filings": ["FIN-RETURN-03"],
    "stripe": [
        "STRIPE-BROWSER-01",
        "STRIPE-BROWSER-02",
        "STRIPE-BROWSER-03",
        "STRIPE-BROWSER-04",
        "STRIPE-BROWSER-05",
        "STRIPE-BROWSER-06",
        "FIN-DEPOSIT-04",
    ],
}


class Attempt(BaseModel):
    status: str
    retry: int


class Test(BaseModel):
    expectedStatus: str
    results: list[Attempt]
    status: str


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

    def validate_evidence(self, required: list[str]) -> None:
        cases = [case for suite in self.suites for case in suite.cases()]
        if self.errors or not cases:
            raise ValueError("the run has global errors or no cases")
        missing = [
            identity
            for identity in required
            if not any(c.title.startswith(f"{identity} ") for c in cases)
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
