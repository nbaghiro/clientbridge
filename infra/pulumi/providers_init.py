"""Set up an environment's providers by API and store what they issue, from one local env file."""

import argparse
import base64
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import yaml

from bootstrap import cloud_up, use_state
from cloud.secrets import secret_id
from environments import Environment
from secrets_init import GoogleCloud, environment

PROGRAM = Path(__file__).resolve().parent
BACKEND = PROGRAM.parents[1] / "backend"
RESEND = "https://api.resend.com"
TWILIO = "https://api.twilio.com/2010-04-01"
TWILIO_UNVERIFIED = 20003  # numbers stay locked until the account's Trust Hub profile is approved
RESEND_EVENTS = (
    "email.delivered",
    "email.bounced",
    "email.failed",
    "email.suppressed",
    "email.complained",
)
# what the person copies from each provider's dashboard; everything else is created here
REQUIRED = (
    "RESEND_ADMIN_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_CLI_PROFILE",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "EXPO_ACCESS_TOKEN",
)
# copied from the env file into Secret Manager as they are
COPIED = (
    "STRIPE_SECRET_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "EXPO_ACCESS_TOKEN",
)
STRIPE_ISSUED = (
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_THIN_WEBHOOK_SECRET",
    "STRIPE_PLATFORM_WEBHOOK_SECRET",
    "STRIPE_PORTAL_CONFIGURATION",
)


class Secrets(Protocol):
    def has_version(self, secret: str) -> bool: ...

    def latest(self, secret: str) -> str | None: ...

    def add_version(self, secret: str, value: str) -> None: ...


@dataclass(frozen=True)
class Report:
    lines: list[str]

    def add(self, line: str) -> None:
        self.lines.append(line)


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    missing = [key for key in REQUIRED if not values.get(key)]
    if missing:
        raise SystemExit(f"{path} is missing {', '.join(missing)}")
    return values


def store(secrets: Secrets, env: Environment, name: str, value: str, report: Report) -> None:
    """Adds a version when the secret has none or its latest value differs, so reruns are no-ops."""
    secret = secret_id(env, name)
    if secrets.latest(secret) == value:
        report.add(f"{secret}: kept")
        return
    secrets.add_version(secret, value)
    report.add(f"{secret}: written")


def mail_records(
    env: Environment, records: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    """Resend's records as clientbridge:mailRecords takes them: names under the base domain."""
    label = env.base_domain.split(".", 1)[0]
    converted: list[dict[str, object]] = []
    for record in records:
        name = str(record.get("name") or "")
        name = name.removesuffix(f".{env.base_domain}").removesuffix(f".{label}")
        kind = str(record.get("type") or "")
        value = str(record.get("value") or "")
        if kind == "MX":
            value = f"{record.get('priority') or 10} {value.rstrip('.')}."
        elif kind == "CNAME":
            value = f"{value.rstrip('.')}."
        converted.append({"name": name, "type": kind, "data": [value]})
    return converted


def with_mail_records(text: str, env: Environment, records: list[dict[str, object]]) -> str:
    """The cloud stack's YAML with this environment's mailRecords list replaced, comments kept."""
    block = yaml.safe_dump(
        {env.name: records}, sort_keys=False, default_flow_style=False, width=1000
    )
    indented = "".join(f"    {line}\n" for line in block.splitlines())
    pattern = re.compile(
        rf"^    {env.name}:(?: \[\])?\n(?:      .*\n|    - .*\n|      - .*\n)*", re.M
    )
    if not pattern.search(text):
        raise SystemExit(f"Pulumi.cloud.yaml has no clientbridge:mailRecords.{env.name} entry")
    return pattern.sub(lambda _: indented, text, count=1)


def stripe_issued(output: str) -> dict[str, str]:
    """The values stripe_setup.py prints for a deployed endpoint, which Stripe shows only once."""
    found: dict[str, str] = {}
    for line in output.splitlines():
        match = re.match(r"\s*([A-Z_]+)=(\S+)", line)
        if match and match.group(1) in STRIPE_ISSUED and not match.group(2).startswith("<"):
            value = match.group(2)
            if value.startswith(("whsec_", "bpc_")) and "…" not in value:
                found[match.group(1)] = value
    return found


def redacted(output: str) -> str:
    """The output with every Stripe secret cut to its prefix, for a terminal or a pasted log."""
    return re.sub(r"\b(whsec|bpc|sk_test|sk_live|rk_test|rk_live)_[A-Za-z0-9]+", r"\1_…", output)


class ProviderError(SystemExit):
    def __init__(self, message: str, detail: str) -> None:
        super().__init__(message)
        self.detail = detail


class Http:
    def __init__(self, base: str, headers: Mapping[str, str]) -> None:
        self.base = base
        self.headers = dict(headers)

    def call(
        self,
        method: str,
        path: str,
        body: Mapping[str, object] | None = None,
        *,
        form: bool = False,
    ) -> dict[str, object]:
        data: bytes | None = None
        headers = dict(self.headers)
        if body is not None and form:
            data = urllib.parse.urlencode(body).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                parsed: object = json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            raise ProviderError(
                f"{method} {self.base}{path.split('?')[0]} failed: {error.code} {detail}", detail
            ) from None
        return parsed if isinstance(parsed, dict) else {"data": parsed}


def resend(
    env: Environment, admin_key: str, secrets: Secrets, report: Report
) -> list[dict[str, object]]:
    """The environment's sending domain, a key that may send only from it, and the webhook."""
    api = Http(RESEND, {"Authorization": f"Bearer {admin_key}", "User-Agent": "clientbridge-infra"})
    listed = api.call("GET", "/domains").get("data")
    domains = (
        [each for each in listed if isinstance(each, dict)] if isinstance(listed, list) else []
    )
    match = [each for each in domains if each.get("name") == env.base_domain]
    if match:
        domain_id = str(match[0].get("id"))
        report.add(f"resend domain {env.base_domain}: kept")
    else:
        created = api.call("POST", "/domains", {"name": env.base_domain, "region": "us-east-1"})
        domain_id = str(created.get("id"))
        report.add(f"resend domain {env.base_domain}: created")
    domain = api.call("GET", f"/domains/{domain_id}")
    raw = domain.get("records")
    records = [each for each in raw if isinstance(each, dict)] if isinstance(raw, list) else []
    if domain.get("status") != "verified":
        # asks Resend to check again; it verifies once the cloud stack has published the records
        api.call("POST", f"/domains/{domain_id}/verify")
    key = secret_id(env, "RESEND_API_KEY")
    if secrets.has_version(key):
        report.add(f"{key}: kept")
    else:
        token = api.call(
            "POST",
            "/api-keys",
            {
                "name": f"clientbridge-{env.name}",
                "permission": "sending_access",
                "domain_id": domain_id,
            },
        ).get("token")
        secrets.add_version(key, str(token))
        report.add(f"{key}: written")
    hook = secret_id(env, "RESEND_WEBHOOK_SECRET")
    endpoint = f"{env.url('api')}/webhooks/email"
    if secrets.has_version(hook):
        report.add(f"{hook}: kept")
    else:
        created = api.call(
            "POST", "/webhooks", {"endpoint": endpoint, "events": list(RESEND_EVENTS)}
        )
        secrets.add_version(hook, str(created.get("signing_secret")))
        report.add(f"{hook}: written (webhook {endpoint})")
    return mail_records(env, records)


def twilio(env: Environment, sid: str, token: str, secrets: Secrets, report: Report) -> None:
    """One Canadian SMS number per environment, its inbound webhook pointing at the API."""
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    api = Http(f"{TWILIO}/Accounts/{sid}", {"Authorization": f"Basic {auth}"})
    name = f"clientbridge-{env.name}"
    webhook = f"{env.url('api')}/webhooks/sms"
    query = urllib.parse.urlencode({"FriendlyName": name})
    owned = api.call("GET", f"/IncomingPhoneNumbers.json?{query}").get("incoming_phone_numbers")
    numbers = [each for each in owned if isinstance(each, dict)] if isinstance(owned, list) else []
    if numbers:
        number = numbers[0]
        if number.get("sms_url") != webhook:
            api.call(
                "POST",
                f"/IncomingPhoneNumbers/{number.get('sid')}.json",
                {"SmsUrl": webhook, "SmsMethod": "POST"},
                form=True,
            )
        report.add(f"twilio number {number.get('phone_number')}: kept")
    else:
        search = urllib.parse.urlencode({"SmsEnabled": "true", "PageSize": "1"})
        available = api.call("GET", f"/AvailablePhoneNumbers/CA/Local.json?{search}").get(
            "available_phone_numbers"
        )
        choices = (
            [each for each in available if isinstance(each, dict)]
            if isinstance(available, list)
            else []
        )
        if not choices:
            raise SystemExit("twilio offers no Canadian SMS number right now; try again later")
        try:
            number = api.call(
                "POST",
                "/IncomingPhoneNumbers.json",
                {
                    "PhoneNumber": str(choices[0].get("phone_number")),
                    "FriendlyName": name,
                    "SmsUrl": webhook,
                    "SmsMethod": "POST",
                },
                form=True,
            )
        except ProviderError as error:
            if not re.search(rf'"code"\s*:\s*{TWILIO_UNVERIFIED}\b', error.detail):
                raise
            awaiting_number(secrets, env, report)
            return
        report.add(f"twilio number {number.get('phone_number')}: bought")
    store(secrets, env, "TWILIO_SMS_FROM", str(number.get("phone_number")), report)


def awaiting_number(secrets: Secrets, env: Environment, report: Report) -> None:
    """Keeps SMS logged, not sent, until Twilio approves the account and a rerun buys a number."""
    secret = secret_id(env, "TWILIO_SMS_FROM")
    if not secrets.has_version(secret):
        # Secret Manager refuses an empty value; the pods' $(cat …) strips the newline back to empty
        secrets.add_version(secret, "\n")
    report.add("twilio number: waiting on Trust Hub approval; rerun this once Twilio approves it")


def stripe(env: Environment, profile: str, secrets: Secrets, report: Report) -> None:
    """The sandbox's endpoints, billing objects and portal, by the backend's stripe_setup.py."""
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "scripts.stripe_setup",
            "--apply",
            "--project-name",
            profile,
            "--webhook-url",
            f"{env.url('api')}/webhooks/stripe",
            "--show-secrets",
        ],
        cwd=BACKEND,
        env={**os.environ, "ENV": "dev", "WEB_BASE_URL": env.url("app")},
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        tail = redacted(f"{result.stdout[-2000:]}{result.stderr[-2000:]}")
        raise SystemExit(f"stripe_setup.py failed:\n{tail}")
    issued = stripe_issued(result.stdout)
    for name in STRIPE_ISSUED:
        secret = secret_id(env, name)
        if name in issued:
            store(secrets, env, name, issued[name], report)
        elif secrets.has_version(secret):
            report.add(
                f"{secret}: kept (Stripe shows an endpoint's secret only when it is created)"
            )
        else:
            raise SystemExit(
                f"{secret} has no version and Stripe no longer shows it; delete the endpoint in "
                "the sandbox and run this again"
            )


class SecretManager(GoogleCloud):
    def latest(self, secret: str) -> str | None:
        if not self.has_version(secret):
            return None
        accessed = self._call("GET", f"{self._secret(secret)}/versions/latest:access")
        payload = accessed.get("payload")
        data = payload.get("data") if isinstance(payload, dict) else None
        return base64.b64decode(str(data)).decode() if data else None


def pulumi(*args: str) -> None:
    subprocess.run(["pulumi", *args], cwd=PROGRAM, check=True)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, choices=["staging", "prod"])
    parser.add_argument("--project", required=True, help="the Google Cloud project id")
    parser.add_argument("--env-file", required=True, type=Path, help="the provider credentials")
    args = parser.parse_args(argv)
    env = environment(str(args.env))
    use_state(str(args.project))
    values = read_env_file(Path(args.env_file))
    secrets = SecretManager(str(args.project))
    report = Report([])
    for name in COPIED:
        store(secrets, env, name, values[name], report)
    records = resend(env, values["RESEND_ADMIN_API_KEY"], secrets, report)
    twilio(env, values["TWILIO_ACCOUNT_SID"], values["TWILIO_AUTH_TOKEN"], secrets, report)
    stripe(env, values["STRIPE_CLI_PROFILE"], secrets, report)
    print("\n".join(report.lines))
    config = PROGRAM / "Pulumi.cloud.yaml"
    config.write_text(with_mail_records(config.read_text(), env, records))
    pulumi(
        "config",
        "set",
        "--stack",
        env.name,
        "clientbridge:stripePublishableKey",
        values["STRIPE_PUBLISHABLE_KEY"],
    )
    # publishes the Resend records; Resend verifies the domain once they resolve
    cloud_up()


if __name__ == "__main__":
    main()
