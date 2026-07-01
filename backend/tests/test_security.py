"""Unit tests for pure security/adapter helpers."""

from clientbridge.core.security import hash_password, verify_password
from clientbridge.integrations.notifications import ConsoleEmailSender, Email, get_email_sender


def test_password_hash_roundtrip() -> None:
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)


async def test_console_email_sender_is_noop() -> None:
    await ConsoleEmailSender().send(Email(to="a@b.ca", subject="s", body="b"))
    assert get_email_sender() is not None
