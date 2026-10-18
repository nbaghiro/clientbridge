import httpx
import pytest

from tests.conftest import FakeEmailSender


async def test_contact_form_sends_to_the_team(
    api: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    response = await api.post(
        "/contact", data={"name": "Pat", "email": "pat@example.com", "message": "A question"}
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/contact/thanks"
    assert len(email.sent) == 1
    assert email.sent[0].to == "hello@clientbridge.ca"
    assert email.sent[0].reply_to == "pat@example.com"
    assert "A question" in email.sent[0].body


@pytest.mark.parametrize(
    "data",
    [
        {"name": "Pat", "email": "invalid", "message": "A question"},
        {"name": "", "email": "pat@example.com", "message": "A question"},
        {"name": "Pat", "email": "pat@example.com", "message": " "},
        {"name": "Pat", "email": "pat@example.com", "message": "x" * 5001},
    ],
)
async def test_invalid_contact_form_does_not_send(
    api: httpx.AsyncClient, email: FakeEmailSender, data: dict[str, str]
) -> None:
    response = await api.post("/contact", data=data)
    assert response.status_code == 303 and response.headers["location"] == "/contact/retry"
    assert email.sent == []


async def test_contact_honeypot_does_not_send(
    api: httpx.AsyncClient, email: FakeEmailSender
) -> None:
    response = await api.post("/contact", data={"website": "spam"})
    assert response.status_code == 303 and response.headers["location"] == "/contact/thanks"
    assert email.sent == []
