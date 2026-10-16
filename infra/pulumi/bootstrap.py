"""Create the project, its Pulumi state and the cloud stack, and write the generated secrets."""

import argparse
import os
import shutil
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path

import yaml

import secrets_init

PROGRAM = Path(__file__).resolve().parent
PULUMI_VERSION = "3.268.0"  # the version CI installs
# what Pulumi itself needs before the cloud stack can enable the rest (cloud/services.py)
BOOTSTRAP_APIS = (
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "storage.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudbilling.googleapis.com",
)
KEY_RING = "pulumi"
KEY = "state"

Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


def run(command: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(command), cwd=PROGRAM, capture_output=True, text=True)


def must(command: Sequence[str], runner: Run = run) -> str:
    result = runner(command)
    if result.returncode != 0:
        raise SystemExit(f"{' '.join(command[:4])} … failed:\n{result.stderr.strip()[-1500:]}")
    return result.stdout.strip()


def exists(command: Sequence[str], runner: Run = run) -> bool:
    return runner(command).returncode == 0


def state_bucket(project: str) -> str:
    return f"{project}-pulumi-state"


def state_key(project: str, region: str) -> str:
    return f"projects/{project}/locations/{region}/keyRings/{KEY_RING}/cryptoKeys/{KEY}"


def check_tools(runner: Run = run) -> None:
    missing = [
        tool
        for tool in ("gcloud", "pulumi", "gh", "openssl", "gke-gcloud-auth-plugin")
        if not shutil.which(tool)
    ]
    if missing:
        raise SystemExit(
            f"install {', '.join(missing)} first (gke-gcloud-auth-plugin: "
            "`gcloud components install gke-gcloud-auth-plugin`)"
        )
    version = must(["pulumi", "version"], runner).lstrip("v")
    if version != PULUMI_VERSION:
        print(f"note: pulumi is {version}; CI runs {PULUMI_VERSION}")
    if not exists(["gh", "auth", "status"], runner):
        raise SystemExit(
            "run `gh auth login` first; the cloud stack sets the repository's deploy settings"
        )


def project(project_id: str, billing_account: str, region: str, runner: Run = run) -> list[str]:
    done: list[str] = []
    if exists(["gcloud", "projects", "describe", project_id], runner):
        done.append(f"project {project_id}: kept")
    else:
        must(["gcloud", "projects", "create", project_id, "--name", "Clientbridge"], runner)
        done.append(f"project {project_id}: created")
    linked = must(
        [
            "gcloud",
            "billing",
            "projects",
            "describe",
            project_id,
            "--format=value(billingAccountName)",
        ],
        runner,
    )
    if linked.endswith(billing_account):
        done.append("billing: kept")
    else:
        must(
            [
                "gcloud",
                "billing",
                "projects",
                "link",
                project_id,
                "--billing-account",
                billing_account,
            ],
            runner,
        )
        done.append("billing: linked")
    must(["gcloud", "services", "enable", *BOOTSTRAP_APIS, "--project", project_id], runner)
    bucket = f"gs://{state_bucket(project_id)}"
    if exists(["gcloud", "storage", "buckets", "describe", bucket], runner):
        done.append(f"state bucket {bucket}: kept")
    else:
        must(
            [
                "gcloud",
                "storage",
                "buckets",
                "create",
                bucket,
                "--project",
                project_id,
                "--location",
                region,
                "--uniform-bucket-level-access",
                "--public-access-prevention",
            ],
            runner,
        )
        # every write keeps the previous state, so a bad update can be rolled back
        must(["gcloud", "storage", "buckets", "update", bucket, "--versioning"], runner)
        done.append(f"state bucket {bucket}: created")
    ring = ["--location", region, "--project", project_id]
    if not exists(["gcloud", "kms", "keyrings", "describe", KEY_RING, *ring], runner):
        must(["gcloud", "kms", "keyrings", "create", KEY_RING, *ring], runner)
    if exists(["gcloud", "kms", "keys", "describe", KEY, "--keyring", KEY_RING, *ring], runner):
        done.append("state key: kept")
    else:
        must(
            [
                "gcloud",
                "kms",
                "keys",
                "create",
                KEY,
                "--keyring",
                KEY_RING,
                "--purpose",
                "encryption",
                *ring,
            ],
            runner,
        )
        done.append("state key: created")
    return done


def enabled_environments() -> list[str]:
    config = yaml.safe_load((PROGRAM / "Pulumi.cloud.yaml").read_text())["config"]
    return [str(name) for name in config.get("clientbridge:environments") or ["prod", "staging"]]


def use_state(project_id: str) -> None:
    """Points this run's Pulumi at the project's bucket without changing the person's own login."""
    os.environ["PULUMI_BACKEND_URL"] = f"gs://{state_bucket(project_id)}"
    # the budget and service APIs bill the person's credentials to this project, in this run only
    os.environ["GOOGLE_CLOUD_QUOTA_PROJECT"] = project_id
    os.environ["CLOUDSDK_CORE_PROJECT"] = project_id


def stacks(project_id: str, billing_account: str, region: str, runner: Run = run) -> None:
    use_state(project_id)
    provider = f"gcpkms://{state_key(project_id, region)}"
    for stack in ["cloud", *enabled_environments()]:
        must(
            ["pulumi", "stack", "select", "--create", stack, "--secrets-provider", provider], runner
        )
    settings = {
        "gcp:project": project_id,
        "gcp:billingProject": project_id,
        "gcp:region": region,
        "clientbridge:billingAccount": billing_account,
        "clientbridge:stateBucket": state_bucket(project_id),
        "clientbridge:stateKey": state_key(project_id, region),
    }
    for key, value in settings.items():
        must(["pulumi", "config", "set", "--stack", "cloud", key, value], runner)


def cloud_up(runner: Run = run) -> None:
    """Applies the cloud stack with the administrator's GitHub token for the repository settings."""
    os.environ["GITHUB_TOKEN"] = must(["gh", "auth", "token"], runner)
    result = subprocess.run(
        ["pulumi", "up", "--stack", "cloud", "--yes", "--skip-preview"], cwd=PROGRAM
    )
    if result.returncode != 0:
        raise SystemExit("pulumi up --stack cloud failed; fix the error above and run this again")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project", required=True, help="the Google Cloud project id to create or use"
    )
    parser.add_argument("--billing-account", required=True, help="XXXXXX-XXXXXX-XXXXXX")
    parser.add_argument("--region", default="us-east1")
    args = parser.parse_args(argv)
    project_id, billing, region = str(args.project), str(args.billing_account), str(args.region)
    check_tools()
    use_state(project_id)
    print("\n".join(project(project_id, billing, region)))
    stacks(project_id, billing, region)
    cloud_up()
    for env in enabled_environments():
        secrets_init.main(["--env", env, "--project", project_id])
    servers = must(["pulumi", "stack", "output", "nameServers", "--stack", "cloud", "--json"])
    print(f"\nAdd these NS records at the registrar, one set per name:\n{servers}")
    print("Commit infra/pulumi/Pulumi.*.yaml: they now name the project, its state and its key.")


if __name__ == "__main__":
    main()
