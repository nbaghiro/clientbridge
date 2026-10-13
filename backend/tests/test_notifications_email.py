"""The email adapter uses Resend only when an API key and a from-address are both set."""

import pytest
from pydantic import ValidationError

from clientbridge.core.config import Settings, get_settings
from clientbridge.integrations.resend import (
    ConsoleEmailSender,
    ResendEmailSender,
    SmtpEmailSender,
    get_email_sender,
)


def _configure(monkeypatch: pytest.MonkeyPatch, **values: str) -> None:
    """Override every email setting so a developer's .env cannot steer the choice."""
    for name in ("RESEND_API_KEY", "EMAIL_FROM", "SMTP_URL"):
        monkeypatch.setenv(name, values.get(name, ""))
    get_settings.cache_clear()


def test_unconfigured_email_is_the_console_no_op(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)
    try:
        assert isinstance(get_email_sender(), ConsoleEmailSender)
    finally:
        get_settings.cache_clear()


def test_email_swaps_to_resend_when_key_and_from_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(
        monkeypatch,
        RESEND_API_KEY="re_test_key",
        EMAIL_FROM="Clientbridge <no-reply@clientbridge.test>",
    )
    try:
        assert isinstance(get_email_sender(), ResendEmailSender)
    finally:
        get_settings.cache_clear()  # env is restored by monkeypatch; reset the cached singleton


def test_smtp_url_wins_over_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(
        monkeypatch,
        RESEND_API_KEY="re_test_key",
        EMAIL_FROM="Clientbridge <no-reply@clientbridge.test>",
        SMTP_URL="smtp://localhost:8716",
    )
    try:
        assert isinstance(get_email_sender(), SmtpEmailSender)
    finally:
        get_settings.cache_clear()


def test_key_without_from_stays_console(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch, RESEND_API_KEY="re_test_key")  # no EMAIL_FROM
    try:
        assert isinstance(get_email_sender(), ConsoleEmailSender)
    finally:
        get_settings.cache_clear()


def test_a_malformed_webhook_secret_is_refused_at_startup() -> None:
    with pytest.raises(ValidationError, match="RESEND_WEBHOOK_SECRET"):
        Settings(env="dev", resend_webhook_secret="whsec_not-base64!")
    assert Settings(env="dev", resend_webhook_secret="whsec_dGVzdHNlY3JldA==").env == "dev"


def test_the_smtp_transport_is_refused_outside_dev() -> None:
    with pytest.raises(ValidationError, match="SMTP_URL"):
        Settings(env="prod", smtp_url="smtp://localhost:8716", _env_file=None)
