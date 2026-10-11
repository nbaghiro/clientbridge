import httpx
import pytest

from clientbridge.core.config import get_settings
from clientbridge.core.deps import get_kratos_courier_secret
from clientbridge.integrations.postmark import Email, get_email_sender
from clientbridge.main import app
from tests.conftest import FakeEmailSender

URL = "/webhooks/kratos-courier"
GOOD = {"X-Kratos-Secret": "testsecret"}


def _courier(template_type: str, **extra: object) -> dict[str, object]:
    return {"template_type": template_type, "to": "new@example.com", **extra}


class FailingEmailSender:
    async def send(self, email: Email) -> None:
        raise ConnectionError("smtp down")


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


@pytest.mark.parametrize("headers", [{"X-Kratos-Secret": "wrong"}, {}])
async def test_bad_secret_401_sends_nothing(
    api: httpx.AsyncClient, email: FakeEmailSender, headers: dict[str, str]
) -> None:
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert (await api.post(URL, json=body, headers=headers)).status_code == 401
    assert email.sent == []


async def test_unset_server_secret_401(api: httpx.AsyncClient, email: FakeEmailSender) -> None:
    app.dependency_overrides[get_kratos_courier_secret] = lambda: ""
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    assert (await api.post(URL, json=body, headers={"X-Kratos-Secret": ""})).status_code == 401
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


async def test_send_failure_is_a_5xx_so_kratos_retries(api: httpx.AsyncClient) -> None:
    app.dependency_overrides[get_email_sender] = FailingEmailSender
    body = _courier("recovery_code_valid", code="482913", expires_in_minutes=15)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(URL, json=body, headers=GOOD)
    assert res.status_code == 500
