"""The bootstrap creates what is missing and leaves what exists, so a second run changes nothing."""

import subprocess
from collections.abc import Sequence

import bootstrap


class Gcloud:
    """Answers describe calls from what exists and records every other command."""

    def __init__(self, existing: set[str], billing: str = "") -> None:
        self.existing = existing
        self.billing = billing
        self.commands: list[list[str]] = []

    def __call__(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        args = list(command)
        self.commands.append(args)
        if "describe" in args and "billing" in args:
            return subprocess.CompletedProcess(args, 0, self.billing, "")
        if "describe" in args:
            found = any(name in self.existing for name in args)
            return subprocess.CompletedProcess(args, 0 if found else 1, "", "")
        return subprocess.CompletedProcess(args, 0, "", "")


def creates(gcloud: Gcloud) -> list[str]:
    return [" ".join(c[:4]) for c in gcloud.commands if "create" in c or "link" in c]


def test_a_new_project_gets_everything() -> None:
    gcloud = Gcloud(existing=set())
    report = bootstrap.project("cb-test", "AAA-BBB", "us-east1", gcloud)
    assert "project cb-test: created" in report and "billing: linked" in report
    assert creates(gcloud) == [
        "gcloud projects create cb-test",
        "gcloud billing projects link",
        "gcloud storage buckets create",
        "gcloud kms keyrings create",
        "gcloud kms keys create",
    ]


def test_a_second_run_creates_nothing() -> None:
    existing = {"cb-test", "gs://cb-test-pulumi-state", bootstrap.KEY_RING, bootstrap.KEY}
    gcloud = Gcloud(existing=existing, billing="billingAccounts/AAA-BBB")
    report = bootstrap.project("cb-test", "AAA-BBB", "us-east1", gcloud)
    assert creates(gcloud) == []
    assert report == [
        "project cb-test: kept",
        "billing: kept",
        "state bucket gs://cb-test-pulumi-state: kept",
        "state key: kept",
    ]


def test_the_state_names_follow_the_project() -> None:
    assert bootstrap.state_bucket("cb-test") == "cb-test-pulumi-state"
    assert bootstrap.state_key("cb-test", "us-east1") == (
        "projects/cb-test/locations/us-east1/keyRings/pulumi/cryptoKeys/state"
    )
