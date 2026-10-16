"""secrets_init.py against a recording fake of Secret Manager, Cloud SQL and Cloud Storage."""

from urllib.parse import urlsplit

import pytest

import secrets_init
from environments import Environment, build
from kubernetes import settings

PROJECT = "project"


class FakeCloud:
    def __init__(self, present: set[str] | None = None) -> None:
        self.versions: dict[str, list[str]] = {name: ["existing"] for name in present or set()}
        self.passwords: list[tuple[str, str, str]] = []
        self.hmac_keys: list[str] = []

    def has_version(self, secret: str) -> bool:
        return bool(self.versions.get(secret))

    def add_version(self, secret: str, value: str) -> None:
        self.versions.setdefault(secret, []).append(value)

    def set_password(self, instance: str, user: str, password: str) -> None:
        self.passwords.append((instance, user, password))

    def create_hmac_key(self, service_account: str) -> tuple[str, str]:
        self.hmac_keys.append(service_account)
        return f"GOOG{len(self.hmac_keys)}", f"hmac-secret-{len(self.hmac_keys)}"


def staging() -> Environment:
    return build("clientbridge.ca", "staging.clientbridge.ca")[1]


def secret(env: Environment, name: str) -> str:
    return f"{env.name}-{name.lower().replace('_', '-')}"


def test_a_first_run_writes_every_generated_secret_once() -> None:
    env, cloud = staging(), FakeCloud()
    report = secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=False)
    assert {secret(env, name) for name in settings.GENERATED} == set(cloud.versions)
    assert all(len(values) == 1 for values in cloud.versions.values())
    assert len(report) == len(settings.GENERATED)
    value = {name: cloud.versions[secret(env, name)][0] for name in settings.GENERATED}
    admin = urlsplit(value["ADMIN_DATABASE_URL"])
    assert (admin.username, admin.path) == ("staging_admin", "/staging_clientbridge")
    assert cloud.passwords == [("clientbridge", "staging_admin", admin.password)]
    api = urlsplit(value["DATABASE_URL"])
    assert (api.scheme, api.username, api.netloc.split("@")[1]) == (
        "postgresql+asyncpg",
        "staging_clientbridge_api",
        "127.0.0.1:5432",
    )
    assert urlsplit(value["AUTH_DATABASE_URL"]).query.startswith("sslmode=disable&max_conns=5")
    assert len(value["AUTH_CIPHER_SECRET"]) == 32
    assert value["POWERSYNC_PRIVATE_KEY_PEM"].startswith("-----BEGIN PRIVATE KEY-----")
    assert value["POWERSYNC_KID"] == "clientbridge-staging-1"
    assert value["POWERSYNC_PREVIOUS_PUBLIC_KEYS"] == "{}"
    assert (value["S3_ACCESS_KEY"], value["S3_SECRET_KEY"]) == ("GOOG1", "hmac-secret-1")
    assert cloud.hmac_keys == ["cb-staging-files@project.iam.gserviceaccount.com"]


def test_a_second_run_changes_nothing() -> None:
    env, cloud = staging(), FakeCloud()
    secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=False)
    before = {name: list(values) for name, values in cloud.versions.items()}
    report = secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=False)
    assert cloud.versions == before
    assert len(cloud.passwords) == 1 and len(cloud.hmac_keys) == 1
    assert all(line.endswith(": kept") for line in report)


def test_a_dry_run_writes_nothing() -> None:
    env, cloud = staging(), FakeCloud({secret(staging(), "JWT_SECRET")})
    report = secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=True)
    assert cloud.versions == {secret(env, "JWT_SECRET"): ["existing"]}
    assert not cloud.passwords and not cloud.hmac_keys
    assert f"{secret(env, 'JWT_SECRET')}: kept" in report
    assert f"{secret(env, 'ADMIN_DATABASE_URL')}: would write" in report


def test_half_an_hmac_pair_is_replaced_whole() -> None:
    env = staging()
    cloud = FakeCloud({secret(env, "S3_ACCESS_KEY")})
    secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=False)
    assert cloud.versions[secret(env, "S3_ACCESS_KEY")] == ["existing", "GOOG1"]
    assert cloud.versions[secret(env, "S3_SECRET_KEY")] == ["hmac-secret-1"]


def test_the_report_names_secrets_and_never_a_value(capsys: pytest.CaptureFixture[str]) -> None:
    env, cloud = staging(), FakeCloud()
    print("\n".join(secrets_init.run(env, PROJECT, "clientbridge", cloud, dry_run=False)))
    printed = capsys.readouterr().out
    for values in cloud.versions.values():
        for value in values:
            assert value not in printed


def test_each_environment_admin_is_its_own() -> None:
    prod = build("clientbridge.ca", "staging.clientbridge.ca")[0]
    cloud = FakeCloud()
    secrets_init.run(prod, PROJECT, "clientbridge", cloud, dry_run=False)
    assert [user for _, user, _ in cloud.passwords] == ["prod_admin"]
    assert set(cloud.versions) == {secret(prod, name) for name in settings.GENERATED}
