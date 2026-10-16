"""Turning what providers issue into secrets and DNS records, without calling any provider."""

from pathlib import Path

import pytest
import yaml

import providers_init as p
from secrets_init import environment

STAGING = environment("staging")


class FakeSecrets:
    def __init__(self, stored: dict[str, str] | None = None) -> None:
        self.stored = dict(stored or {})
        self.added: list[str] = []

    def has_version(self, secret: str) -> bool:
        return secret in self.stored

    def latest(self, secret: str) -> str | None:
        return self.stored.get(secret)

    def add_version(self, secret: str, value: str) -> None:
        self.stored[secret] = value
        self.added.append(secret)


def test_a_value_is_written_only_when_it_changes() -> None:
    secrets = FakeSecrets({"staging-expo-access-token": "same"})
    report = p.Report([])
    p.store(secrets, STAGING, "EXPO_ACCESS_TOKEN", "same", report)
    p.store(secrets, STAGING, "TWILIO_SMS_FROM", "+16135550100", report)
    p.store(secrets, STAGING, "EXPO_ACCESS_TOKEN", "rotated", report)
    assert secrets.added == ["staging-twilio-sms-from", "staging-expo-access-token"]
    assert report.lines[0] == "staging-expo-access-token: kept"


def test_resend_records_become_names_under_the_base_domain() -> None:
    records = p.mail_records(
        STAGING,
        [
            {"name": "resend._domainkey.staging", "type": "TXT", "value": "p=abc"},
            {
                "name": "send.staging",
                "type": "MX",
                "value": "feedback-smtp.us-east-1.amazonses.com",
                "priority": 10,
            },
            {"name": "rsend.staging", "type": "CNAME", "value": "rsend.forge.rmta.net"},
        ],
    )
    assert records == [
        {"name": "resend._domainkey", "type": "TXT", "data": ["p=abc"]},
        {"name": "send", "type": "MX", "data": ["10 feedback-smtp.us-east-1.amazonses.com."]},
        {"name": "rsend", "type": "CNAME", "data": ["rsend.forge.rmta.net."]},
    ]


def test_the_cloud_config_gets_the_records_and_keeps_its_comments() -> None:
    text = (p.PROGRAM / "Pulumi.cloud.yaml").read_text()
    records: list[dict[str, object]] = [
        {"name": "send", "type": "CNAME", "data": ["send.forge.rmta.net."]}
    ]
    updated = p.with_mail_records(text, STAGING, records)
    parsed = yaml.safe_load(updated)["config"]["clientbridge:mailRecords"]
    assert parsed["staging"] == records
    assert parsed["prod"] == yaml.safe_load(text)["config"]["clientbridge:mailRecords"]["prod"]
    assert updated.count("#") == text.count("#")
    # a second run replaces the list it wrote instead of adding another
    again = p.with_mail_records(updated, STAGING, records)
    assert again == updated


def test_only_stripe_secrets_it_just_created_are_taken() -> None:
    output = "\n".join(
        [
            "env (backend/.env unless noted):",
            "  STRIPE_SECRET_KEY=rk_test_x  (the CLI's restricted key)",
            "  STRIPE_WEBHOOK_SECRET=whsec_new",
            "  STRIPE_THIN_WEBHOOK_SECRET=whsec_…redacted",
            "  STRIPE_PLATFORM_WEBHOOK_SECRET=<existing endpoint>",
            "  STRIPE_PORTAL_CONFIGURATION=bpc_123",
        ]
    )
    assert p.stripe_issued(output) == {
        "STRIPE_WEBHOOK_SECRET": "whsec_new",
        "STRIPE_PORTAL_CONFIGURATION": "bpc_123",
    }


def test_the_env_file_must_name_every_credential(tmp_path: Path) -> None:
    path = tmp_path / ".env.staging"
    path.write_text("# staging\nSTRIPE_SECRET_KEY='sk_test_1'\n")
    with pytest.raises(SystemExit, match="RESEND_ADMIN_API_KEY"):
        p.read_env_file(path)
    path.write_text("\n".join(f"{key}=value-{key}" for key in p.REQUIRED))
    assert p.read_env_file(path)["EXPO_ACCESS_TOKEN"] == "value-EXPO_ACCESS_TOKEN"


def test_an_unapproved_twilio_account_leaves_the_number_empty_once() -> None:
    secrets = FakeSecrets()
    report = p.Report([])
    p.awaiting_number(secrets, STAGING, report)
    p.awaiting_number(secrets, STAGING, report)
    assert secrets.added == ["staging-twilio-sms-from"]
    assert secrets.stored["staging-twilio-sms-from"].strip() == ""
    p.store(secrets, STAGING, "TWILIO_SMS_FROM", "+16135550100", report)
    assert secrets.stored["staging-twilio-sms-from"] == "+16135550100"


def test_a_failed_stripe_setup_prints_no_secret() -> None:
    output = "STRIPE_WEBHOOK_SECRET=whsec_abc123\nkey sk_test_51Xyz and rk_live_9q, bpc_1Qx done"
    assert p.redacted(output) == (
        "STRIPE_WEBHOOK_SECRET=whsec_…\nkey sk_test_… and rk_live_…, bpc_… done"
    )
