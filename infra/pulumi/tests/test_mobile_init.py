"""What the mobile setup writes to EAS, without calling EAS, Google or Apple."""

from pathlib import Path

import pytest

import mobile_init as m
from providers_init import Report
from secrets_init import environment

STAGING = environment("staging")
PROD = environment("prod")
SENDER = "cb-staging-push@project.iam.gserviceaccount.com"
PUBLISHER = "cb-play-publisher@project.iam.gserviceaccount.com"
APPLE = m.Apple("ABCDE12345", "ASC123", "issuer", "asc-p8", "APNS123", "apns-p8")


class FakeEas:
    def __init__(self) -> None:
        self.stored: dict[str, dict[str, m.Variable]] = {}
        self.android_credentials = m.AndroidCredentials("android", None, None)
        self.ios_credentials = m.IosCredentials("ios", None, None, False)
        self.uploaded: list[str] = []
        self.calls: list[str] = []

    def variables(self, environment: str) -> dict[str, m.Variable]:
        return dict(self.stored.get(environment, {}))

    def create_variable(self, environment: str, name: str, value: str) -> None:
        self.stored.setdefault(environment, {})[name] = m.Variable(name, value)

    def update_variable(self, variable: m.Variable, value: str) -> None:
        for each in self.stored.values():
            if variable.id in each:
                each[variable.id] = m.Variable(variable.id, value)

    def android(self, bundle_id: str) -> m.AndroidCredentials:
        self.calls.append(f"android {bundle_id}")
        return self.android_credentials

    def upload_google_key(self, key: str) -> str:
        self.uploaded.append(key)
        return f"key-{len(self.uploaded)}"

    def set_fcm_key(self, credentials: m.AndroidCredentials, key_id: str) -> None:
        self.calls.append(f"fcm {key_id}")

    def set_submit_key(self, credentials: m.AndroidCredentials, key_id: str) -> None:
        self.calls.append(f"submit {key_id}")

    def ios(self, team_id: str, bundle_id: str) -> m.IosCredentials:
        self.calls.append(f"ios {team_id} {bundle_id}")
        return self.ios_credentials

    def set_push_key(
        self, credentials: m.IosCredentials, team_id: str, key_id: str, p8: str
    ) -> None:
        self.calls.append(f"push {key_id}")

    def set_asc_key(
        self, credentials: m.IosCredentials, team_id: str, key_id: str, issuer: str, p8: str
    ) -> None:
        self.calls.append(f"asc {key_id}")


class FakeKeys:
    def __init__(self, existing: dict[str, list[str]] | None = None) -> None:
        self.keys = {account: list(names) for account, names in (existing or {}).items()}
        self.created: list[str] = []

    def create_key(self, service_account: str) -> tuple[str, str]:
        self.created.append(service_account)
        name = f"{service_account}/keys/{len(self.created)}"
        self.keys.setdefault(service_account, []).append(name)
        return name, f'{{"client_email": "{service_account}"}}'

    def delete_key(self, name: str) -> None:
        for names in self.keys.values():
            if name in names:
                names.remove(name)

    def prune(self, service_account: str, keep: str) -> int:
        old = [name for name in self.keys.get(service_account, []) if name != keep]
        for name in old:
            self.delete_key(name)
        return len(old)


def test_the_environments_variables_are_what_the_app_config_reads() -> None:
    desired = m.desired_variables(STAGING, "pk_test_x")
    assert desired == {
        "APP_ID": "ca.clientbridge.app.staging",
        "APP_NAME": "Clientbridge Staging",
        "BASE_DOMAIN": "staging.clientbridge.ca",
        "STRIPE_PUBLISHABLE_KEY": "pk_test_x",
        "STRIPE_TERMINAL_SIMULATED": "false",
        "TAP_TO_PAY": "false",
    }
    app_config = (m.MOBILE / "app.config.ts").read_text()
    for name in desired:
        assert f"env.{name}" in app_config


def test_variables_are_written_once_and_updated_when_they_change() -> None:
    eas = FakeEas()
    report = Report([])
    m.variables(eas, STAGING, {"APP_ID": "a", "BASE_DOMAIN": "b"}, report)
    m.variables(eas, STAGING, {"APP_ID": "a", "BASE_DOMAIN": "c"}, report)
    assert eas.stored["preview"]["BASE_DOMAIN"].value == "c"
    assert report.lines[2:] == [
        "eas preview APP_ID: kept",
        "eas preview BASE_DOMAIN: updated",
    ]


def test_the_services_file_is_written_where_the_app_config_reads_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(m, "MOBILE", tmp_path)
    report = Report([])
    m.services_file(STAGING, "eyJhIjogMX0=", report)
    m.services_file(STAGING, "eyJhIjogMX0=", report)
    assert (tmp_path / "firebase" / "ca.clientbridge.app.staging.json").read_text() == '{"a": 1}'
    assert report.lines == [
        "firebase/ca.clientbridge.app.staging.json: written; commit it",
        "firebase/ca.clientbridge.app.staging.json: kept",
    ]
    assert (
        "./firebase/${appId}.json"
        in (m.PROGRAM.parents[1] / "frontend/apps/mobile/app.config.ts").read_text()
    )


def test_staging_gets_a_push_key_and_no_play_key() -> None:
    eas, keys, report = FakeEas(), FakeKeys(), Report([])
    m.android(eas, keys, STAGING, SENDER, PUBLISHER, report)
    assert keys.created == [SENDER]
    assert eas.calls == ["android ca.clientbridge.app.staging", "fcm key-1"]


def test_a_new_key_replaces_the_accounts_old_ones() -> None:
    eas, report = FakeEas(), Report([])
    keys = FakeKeys({SENDER: [f"{SENDER}/keys/old"]})
    m.android(eas, keys, STAGING, SENDER, PUBLISHER, report)
    assert keys.keys[SENDER] == [f"{SENDER}/keys/1"]
    assert report.lines == [f"eas ca.clientbridge.app.staging FCM key: created for {SENDER}, 1 old"]


def test_a_key_eas_refused_is_deleted() -> None:
    class Refusing(FakeEas):
        def upload_google_key(self, key: str) -> str:
            raise SystemExit("EAS refused the request")

    keys = FakeKeys({SENDER: [f"{SENDER}/keys/old"]})
    with pytest.raises(SystemExit, match="refused"):
        m.android(Refusing(), keys, STAGING, SENDER, PUBLISHER, Report([]))
    # the key EAS still holds stays, and the one it refused is gone
    assert keys.keys[SENDER] == [f"{SENDER}/keys/old"]


def test_a_key_already_on_eas_is_not_created_again() -> None:
    eas, keys, report = FakeEas(), FakeKeys(), Report([])
    eas.android_credentials = m.AndroidCredentials("android", SENDER, PUBLISHER)
    m.android(eas, keys, PROD, SENDER, PUBLISHER, report)
    assert keys.created == []
    assert report.lines == [
        "eas ca.clientbridge.app FCM key: kept",
        "eas ca.clientbridge.app Play key: kept",
    ]


def test_production_also_gets_the_play_key() -> None:
    eas, keys, report = FakeEas(), FakeKeys(), Report([])
    eas.android_credentials = m.AndroidCredentials("android", SENDER, None)
    m.android(eas, keys, PROD, SENDER, PUBLISHER, report)
    assert keys.created == [PUBLISHER]
    assert eas.calls[-1] == "submit key-1"


def test_ios_waits_for_the_apple_account() -> None:
    eas, report = FakeEas(), Report([])
    assert m.ios(eas, STAGING, None, report) is False
    assert eas.calls == []
    assert report.lines[0].startswith("ios: waiting on the Apple developer account")


def test_ios_sets_both_keys_and_asks_for_a_certificate() -> None:
    eas, report = FakeEas(), Report([])
    assert m.ios(eas, STAGING, APPLE, report) is True
    assert eas.calls == [
        "ios ABCDE12345 ca.clientbridge.app.staging",
        "push APNS123",
        "asc ASC123",
    ]
    eas.ios_credentials = m.IosCredentials("ios", "APNS123", "ASC123", True)
    again = Report([])
    assert m.ios(eas, STAGING, APPLE, again) is False
    assert all(line.endswith("kept") for line in again.lines)


def test_apple_values_are_all_or_nothing(tmp_path: Path) -> None:
    assert m.apple_values({"EXPO_ACCESS_TOKEN": "x"}) is None
    with pytest.raises(SystemExit, match="ASC_API_KEY_ID"):
        m.apple_values({"APPLE_TEAM_ID": "ABCDE12345"})
    (tmp_path / "asc.p8").write_text("asc")
    (tmp_path / "apns.p8").write_text("apns")
    apple = m.apple_values(
        {
            "APPLE_TEAM_ID": "ABCDE12345",
            "ASC_API_KEY_ID": "ASC123",
            "ASC_API_ISSUER_ID": "issuer",
            "ASC_API_KEY_PATH": str(tmp_path / "asc.p8"),
            "APNS_KEY_ID": "APNS123",
            "APNS_KEY_PATH": str(tmp_path / "apns.p8"),
        }
    )
    assert apple == m.Apple("ABCDE12345", "ASC123", "issuer", "asc", "APNS123", "apns")
