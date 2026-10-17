"""Write an environment's generated secrets once, so no value ever passes through Pulumi state."""

import argparse
import base64
import json
import secrets
import string
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend" / "src"))

import yaml

import environments
from cloud import database, storage
from cloud.secrets import secret_id
from environments import Environment

PROGRAM = Path(__file__).resolve().parent
# letters and digits only, so every value is safe inside a URL and a shell export
ALPHABET = string.ascii_letters + string.digits
SECRET_MANAGER = "https://secretmanager.googleapis.com/v1"
CLOUD_SQL = "https://sqladmin.googleapis.com/v1"
STORAGE = "https://storage.googleapis.com/storage/v1"
OPERATION_TIMEOUT_SECONDS = 300


class Cloud(Protocol):
    def has_version(self, secret: str) -> bool: ...

    def add_version(self, secret: str, value: str) -> None: ...

    def set_password(self, instance: str, user: str, password: str) -> None: ...

    def create_hmac_key(self, service_account: str) -> tuple[str, str]: ...


@dataclass(frozen=True)
class Step:
    """Secrets written together, from values made only when one of them has no version."""

    names: tuple[str, ...]
    make: Callable[[], tuple[str, ...]]


def password(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def rsa_private_key() -> str:
    # PKCS#8 PEM from openssl, so the script needs nothing beyond the Pulumi program's packages
    result = subprocess.run(
        ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def steps(env: Environment, project: str, instance: str, cloud: Cloud) -> list[Step]:
    logins = database.logins(env)
    admin = logins["ADMIN_DATABASE_URL"]

    def admin_url() -> tuple[str, ...]:
        value = password(32)
        cloud.set_password(instance, admin.user, value)
        return (admin.url(value),)

    def hmac_key() -> tuple[str, ...]:
        return cloud.create_hmac_key(storage.account_email(project, env))

    return [
        Step(("ADMIN_DATABASE_URL",), admin_url),
        *(
            Step((name,), lambda login=login: (login.url(password(32)),))
            for name, login in logins.items()
            if name != "ADMIN_DATABASE_URL"
        ),
        Step(("JWT_SECRET",), lambda: (password(48),)),
        Step(("AUTH_EMAIL_HOOK_SECRET",), lambda: (password(48),)),
        Step(("AUTH_COOKIE_SECRET",), lambda: (password(48),)),
        Step(("AUTH_CIPHER_SECRET",), lambda: (password(32),)),  # Kratos needs exactly 32
        Step(("POWERSYNC_PRIVATE_KEY_PEM",), lambda: (rsa_private_key(),)),
        Step(("POWERSYNC_KID",), lambda: (f"clientbridge-{env.name}-1",)),
        Step(("POWERSYNC_PREVIOUS_PUBLIC_KEYS",), lambda: ("{}",)),
        Step(("S3_ACCESS_KEY", "S3_SECRET_KEY"), hmac_key),
    ]


def run(env: Environment, project: str, instance: str, cloud: Cloud, *, dry_run: bool) -> list[str]:
    """Each secret's outcome, by name only; a secret that already has a version is left alone."""
    report: list[str] = []
    for step in steps(env, project, instance, cloud):
        ids = [secret_id(env, name) for name in step.names]
        missing = [each for each in ids if not cloud.has_version(each)]
        if not missing:
            report.extend(f"{each}: kept" for each in ids)
            continue
        if dry_run:
            report.extend(f"{each}: would write" for each in ids)
            continue
        # a pair (the HMAC key) is replaced together, so both halves always match
        for each, value in zip(ids, step.make(), strict=True):
            cloud.add_version(each, value)
            report.append(f"{each}: written")
    return report


class GoogleCloud:
    """The three REST APIs, authenticated by the administrator's gcloud login."""

    def __init__(self, project: str) -> None:
        self.project = project
        self.token = subprocess.run(
            ["gcloud", "auth", "print-access-token"], check=True, capture_output=True, text=True
        ).stdout.strip()

    def _call(self, method: str, url: str, body: object = None) -> dict[str, object]:
        request = urllib.request.Request(
            url,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "x-goog-user-project": self.project,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                parsed: object = json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            # only the API's own message, which never echoes the request body
            detail: object = json.loads(error.read() or b"{}")
            message = detail.get("error", {}) if isinstance(detail, dict) else {}
            reason = message.get("message", "") if isinstance(message, dict) else ""
            path = url.split("?")[0]
            raise SystemExit(f"{method} {path} failed: {error.code} {reason}") from None
        return parsed if isinstance(parsed, dict) else {}

    def _secret(self, secret: str) -> str:
        return f"{SECRET_MANAGER}/projects/{self.project}/secrets/{secret}"

    def has_version(self, secret: str) -> bool:
        query = urllib.parse.urlencode({"filter": "state:ENABLED", "pageSize": 1})
        return bool(self._call("GET", f"{self._secret(secret)}/versions?{query}").get("versions"))

    def add_version(self, secret: str, value: str) -> None:
        data = base64.b64encode(value.encode()).decode()
        self._call("POST", f"{self._secret(secret)}:addVersion", {"payload": {"data": data}})

    def set_password(self, instance: str, user: str, password: str) -> None:
        """Create the user with this password, or set it when the user exists (a restored clone)."""
        base = f"{CLOUD_SQL}/projects/{self.project}"
        users = f"{base}/instances/{instance}/users"
        listed = self._call("GET", users).get("items")
        names = (
            {each.get("name") for each in listed if isinstance(each, dict)}
            if isinstance(listed, list)
            else set()
        )
        body = {"name": user, "password": password}
        if user in names:
            query = urllib.parse.urlencode({"name": user})
            operation = self._call("PUT", f"{users}?{query}", body)
        else:
            operation = self._call("POST", users, body)
        deadline = time.monotonic() + OPERATION_TIMEOUT_SECONDS
        while operation.get("status") != "DONE":
            if time.monotonic() > deadline:
                raise SystemExit(f"setting the password of {user} did not finish")
            time.sleep(2)
            operation = self._call("GET", f"{base}/operations/{operation.get('name')}")
        if operation.get("error"):
            raise SystemExit(f"setting the password of {user} failed")

    def create_hmac_key(self, service_account: str) -> tuple[str, str]:
        query = urllib.parse.urlencode({"serviceAccountEmail": service_account})
        created = self._call("POST", f"{STORAGE}/projects/{self.project}/hmacKeys?{query}")
        metadata = created.get("metadata")
        access = metadata.get("accessId") if isinstance(metadata, dict) else None
        secret = created.get("secret")
        if not isinstance(access, str) or not isinstance(secret, str):
            raise SystemExit(f"creating an HMAC key for {service_account} returned no key")
        return access, secret


def environment(name: str) -> Environment:
    defaults = yaml.safe_load((PROGRAM / "Pulumi.yaml").read_text())["config"]
    envs = environments.build(
        str(defaults["prodBaseDomain"]["default"]), str(defaults["stagingBaseDomain"]["default"])
    )
    (env,) = [each for each in envs if each.name == name]
    return env


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, choices=["staging", "prod"])
    parser.add_argument("--project", required=True, help="the Google Cloud project id")
    parser.add_argument(
        "--instance",
        default=database.INSTANCE,
        help="the Cloud SQL instance holding <env>_admin (default: the shared one)",
    )
    parser.add_argument("--dry-run", action="store_true", help="report what would be written")
    args = parser.parse_args(argv)
    env = environment(str(args.env))
    cloud = GoogleCloud(str(args.project))
    print("\n".join(run(env, str(args.project), str(args.instance), cloud, dry_run=args.dry_run)))


if __name__ == "__main__":
    main()
