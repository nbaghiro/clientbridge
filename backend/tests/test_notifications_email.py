"""The email adapter uses Postmark only when a token and from-address are both set."""

import pytest

from clientbridge.core.config import get_settings
from clientbridge.integrations.postmark import (
    ConsoleEmailSender,
    PostmarkEmailSender,
    get_email_sender,
)


def test_unconfigured_email_is_the_console_no_op() -> None:
    get_settings.cache_clear()
    assert isinstance(get_email_sender(), ConsoleEmailSender)


def test_email_swaps_to_postmark_when_token_and_from_are_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POSTMARK_SERVER_TOKEN", "pm-test-token")
    monkeypatch.setenv("EMAIL_FROM", "Clientbridge <no-reply@clientbridge.test>")
    get_settings.cache_clear()
    try:
        assert isinstance(get_email_sender(), PostmarkEmailSender)
    finally:
        get_settings.cache_clear()  # env is restored by monkeypatch; reset the cached singleton


def test_token_without_from_stays_console(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTMARK_SERVER_TOKEN", "pm-test-token")  # no EMAIL_FROM
    get_settings.cache_clear()
    try:
        assert isinstance(get_email_sender(), ConsoleEmailSender)
    finally:
        get_settings.cache_clear()
