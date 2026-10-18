"""Unit tests for pure security/adapter helpers."""

from clientbridge.integrations.resend import ConsoleEmailSender, Email, get_email_sender


async def test_console_email_sender_is_noop() -> None:
    await ConsoleEmailSender().send(Email(to="a@b.ca", subject="s", body="b"))
    assert get_email_sender() is not None
