"""One real send through Resend; skipped unless RESEND_TEST_API_KEY and RESEND_TEST_FROM are set."""

import os

import pytest

from clientbridge.integrations.resend import Email, ResendEmailSender

pytestmark = [pytest.mark.sandbox, pytest.mark.wall_clock]

_KEY = os.environ.get("RESEND_TEST_API_KEY")
_FROM = os.environ.get("RESEND_TEST_FROM")


async def test_a_text_email_is_accepted_by_resend() -> None:
    if not _KEY or not _FROM:
        pytest.skip("set RESEND_TEST_API_KEY and RESEND_TEST_FROM to run the Resend E2E tier")
    ref = await ResendEmailSender(_KEY, _FROM).send(
        Email(
            to="delivered@resend.dev", subject="Clientbridge e2e", body="Hello from the e2e tier."
        )
    )
    assert ref
