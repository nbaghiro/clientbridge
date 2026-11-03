import secrets
from collections.abc import Awaitable, Callable

import httpx
import pytest

from clientbridge.core.config import Environment, get_settings
from clientbridge.core.deps import get_auth_email_secret
from clientbridge.core.ratelimit import RateLimiter
from clientbridge.integrations.resend import Email, get_email_sender
from clientbridge.main import app
from clientbridge.services import notifications
from tests.conftest import FakeEmailSender

URL = "/webhooks/auth-email"
GOOD = {"X-Webhook-Secret": "testsecret"}


def _courier(template_type: str, **extra: object) -> dict[str, object]:
    return {"template_type": template_type, "to": "new@example.com", **extra}


class FailingEmailSender:
    async def send(self, email: Email) -> None:
        raise ConnectionError("smtp down")


PostFailing = Callable[[dict[str, object]], Awaitable[int]]


@pytest.fixture
def post_failing(api: httpx.AsyncClient, email: FakeEmailSender) -> PostFailing:
    """Posts with a sender that raises, reading the 500 rather than raising it, then puts back."""

    async def post(body: dict[str, object]) -> int:
        app.dependency_overrides[get_email_sender] = FailingEmailSender
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        try:
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return (await client.post(URL, json=body, headers=GOOD)).status_code
        finally:
            app.dependency_overrides[get_email_sender] = lambda: email

    return post


@pytest.mark.parametrize(
    ("template_type", "subject"),
    [
        ("verification_code_valid", "Your Clientbridge verification code"),
        ("recovery_code_valid", "Your Clientbridge password reset code"),
        ("login_code_valid", "Your Clientbridge sign-in code"),
        ("registration_code_valid", "Your Clientbridge sign-up code"),
    ],
)
async def test_code_email_is_worded_and_sent(
    api: httpx.AsyncClient, email: FakeEmailSender, template_type: str, subject: str
) -> None:
    body = _courier(template_type, code="482913", expires_in_minutes=15)
    res = await api.post(URL, json=body, headers=GOOD)
    assert res.status_code == 200
    [sent] = email.sent
    assert sent.to == "new@example.com" and sent.subject == subject
    assert "482913" in sent.body and "15 minutes" in sent.body


async def test_verification_email_carries_the_link(
    api: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    link = "http://localhost:8713/self-service/verification?flow=f1&code=482913"
    body = _courier("verification_code_valid", code="482913", expires_in_minutes=1, link=link)
    assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert link in email.sent[0].body and "1 minute." in email.sent[0].body


@pytest.mark.parametrize(
    ("template_type", "subject"),
    [
        ("verification_code_invalid", "Clientbridge verification request"),
        ("recovery_code_invalid", "Clientbridge password reset request"),
    ],
)
async def test_unknown_address_gets_a_notice_without_a_code(
    api: httpx.AsyncClient, email: FakeEmailSender, template_type: str, subject: str
) -> None:
    assert (await api.post(URL, json=_courier(template_type), headers=GOOD)).status_code == 200
    [sent] = email.sent
    assert sent.subject == subject and "not linked to an account" in sent.body


@pytest.mark.parametrize("headers", [{"X-Webhook-Secret": "wrong"}, {}])
async def test_bad_secret_401_sends_nothing(
    api: httpx.AsyncClient, email: FakeEmailSender, headers: dict[str, str]
) -> None:
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert (await api.post(URL, json=body, headers=headers)).status_code == 401
    assert email.sent == []


async def test_unset_server_secret_401(api: httpx.AsyncClient, email: FakeEmailSender) -> None:
    app.dependency_overrides[get_auth_email_secret] = lambda: ""
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert (await api.post(URL, json=body, headers={"X-Webhook-Secret": ""})).status_code == 401
    assert email.sent == []


@pytest.mark.parametrize(
    "body",
    [
        _courier("stub"),
        _courier("recovery_code_valid", expires_in_minutes=15),
        _courier("login_code_valid", code="482913"),
    ],
)
async def test_malformed_courier_message_422(
    api: httpx.AsyncClient, email: FakeEmailSender, body: dict[str, object]
) -> None:
    assert (await api.post(URL, json=body, headers=GOOD)).status_code == 422
    assert email.sent == []


async def test_pseudo_locale_reaches_auth_email(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "pseudo_locale", True)
    body = _courier("verification_code_valid", code="482913", expires_in_minutes=15)
    assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    subject = email.sent[0].subject
    assert subject != "Your Clientbridge verification code" and subject.startswith("[")
    assert "482913" in email.sent[0].body


async def test_one_address_stops_getting_auth_email_at_its_limit(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(notifications, "auth_email_limiter", RateLimiter(limit=2, window_s=3600))
    code = {"code": "482913", "expires_in_minutes": 15}
    for address in (
        "limited@example.com",
        "Limited@Example.com",
        "limited@example.com",
        "other@example.com",
    ):
        body = {**_courier("recovery_code_valid", **code), "to": address}
        assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert [sent.to for sent in email.sent] == [
        "limited@example.com",
        "Limited@Example.com",
        "other@example.com",
    ]


async def test_recovery_spam_does_not_block_a_verification_code(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(notifications, "auth_email_limiter", RateLimiter(limit=1, window_s=3600))
    code = {"code": "482913", "expires_in_minutes": 15}
    for kind in ("recovery_code_valid", "recovery_code_valid", "verification_code_valid"):
        body = {**_courier(kind, **code), "to": "victim@example.com"}
        assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert [sent.subject for sent in email.sent] == [
        "Your Clientbridge password reset code",
        "Your Clientbridge verification code",
    ]


async def test_tag_and_dot_spellings_of_one_inbox_share_a_count(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(notifications, "auth_email_limiter", RateLimiter(limit=2, window_s=3600))
    code = {"code": "482913", "expires_in_minutes": 15}
    for address in (
        "jane.doe@gmail.com",
        " JaneDoe+reset@gmail.com",
        "j.a.n.e.doe+x@gmail.com",
        "jane.doe+a@example.com",
        "jane.doe+b@example.com",
        "jane.doe@example.com",
        "janedoe@example.com",
    ):
        body = {**_courier("recovery_code_valid", **code), "to": address}
        assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert [sent.to for sent in email.sent] == [
        "jane.doe@gmail.com",
        " JaneDoe+reset@gmail.com",
        "jane.doe+a@example.com",
        "jane.doe+b@example.com",
        "janedoe@example.com",
    ]


async def test_deployed_limit_on_auth_email_counts_in_redis(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "env", "staging")
    monkeypatch.setattr(notifications, "auth_email_limiter", RateLimiter(limit=1, window_s=60))
    address = f"{secrets.token_hex(12)}@example.com"
    body = {**_courier("recovery_code_invalid"), "to": address}
    for _ in range(2):
        assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert [sent.to for sent in email.sent] == [address]


async def test_a_redis_outage_still_sends_auth_email(
    api: httpx.AsyncClient, email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "env", "staging")
    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    assert (
        await api.post(URL, json=_courier("recovery_code_invalid"), headers=GOOD)
    ).status_code == 200
    assert len(email.sent) == 1


async def test_send_failure_is_a_5xx_so_the_auth_service_retries(
    post_failing: PostFailing,
) -> None:
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert await post_failing(body) == 500


@pytest.mark.parametrize("env", ["dev", "staging"])
async def test_failed_sends_do_not_use_up_the_limit(
    api: httpx.AsyncClient,
    email: FakeEmailSender,
    post_failing: PostFailing,
    monkeypatch: pytest.MonkeyPatch,
    env: Environment,
) -> None:
    monkeypatch.setattr(get_settings(), "env", env)
    monkeypatch.setattr(notifications, "auth_email_limiter", RateLimiter(limit=1, window_s=60))
    address = f"{secrets.token_hex(12)}@example.com"
    body = {**_courier("recovery_code_valid", code="482913", expires_in_minutes=15), "to": address}
    for _ in range(3):
        assert await post_failing(body) == 500
    for _ in range(2):
        assert (await api.post(URL, json=body, headers=GOOD)).status_code == 200
    assert [sent.to for sent in email.sent] == [address]


async def test_a_failed_send_during_a_redis_outage_is_still_a_5xx(
    post_failing: PostFailing, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "env", "staging")
    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert await post_failing(body) == 500
