"""The email adapter (Resend only with a key and a from-address) and the HTML each email carries."""

import re
from email.message import EmailMessage

import pytest
from pydantic import ValidationError

from clientbridge.core.config import Settings, get_settings
from clientbridge.core.email_layout import Action, Brand, EmailView, render_html
from clientbridge.integrations.resend import (
    ConsoleEmailSender,
    Email,
    ResendEmailSender,
    SmtpEmailSender,
    get_email_sender,
)
from tests.helpers import EnvSettings


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


def test_dev_mail_goes_to_mailpit_unless_told_otherwise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SMTP_URL", raising=False)
    assert EnvSettings(env="dev").smtp_url == "smtp://localhost:8716"
    assert EnvSettings(env="dev", smtp_url="").smtp_url == ""


def test_the_smtp_transport_is_refused_outside_dev() -> None:
    with pytest.raises(ValidationError, match="SMTP_URL"):
        EnvSettings(env="prod", smtp_url="smtp://localhost:8716")


async def test_smtp_mail_carries_the_html_as_an_alternative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivered: list[EmailMessage] = []

    def deliver(_self: SmtpEmailSender, message: EmailMessage) -> None:
        delivered.append(message)

    monkeypatch.setattr(SmtpEmailSender, "_deliver", deliver)
    sender = SmtpEmailSender("smtp://localhost:8716", "Clientbridge <no-reply@clientbridge.test>")
    await sender.send(Email(to="a@b.ca", subject="Hi", body="Plain", html="<p>Designed</p>"))
    parts = {part.get_content_type(): part.get_content() for part in delivered[0].iter_parts()}
    assert parts["text/plain"].strip() == "Plain"
    assert parts["text/html"].strip() == "<p>Designed</p>"


PLATFORM = Brand(
    name="Clientbridge",
    header_url="https://clientbridge.test/email/header.png",
    art_url="https://clientbridge.test/email/contours.png",
)


def _render(brand: Brand, view: EmailView) -> str:
    return render_html(brand, view, preheader="Preview text", lang="en-CA")


def test_the_layout_shows_every_part_of_the_view() -> None:
    page = _render(
        PLATFORM,
        EmailView(
            eyebrow="Invoice",
            heading="Invoice #12 for $50.00",
            paragraphs=("First line.", "Second line."),
            action=Action("Pay invoice", "https://pay.test/i/tok"),
            code="482913",
            note="Small print.",
            footer=("ClientBridge Inc.",),
        ),
    )
    for text in ("Invoice #12 for $50.00", "First line.", "Second line.", "482913", "Small print."):
        assert text in page
    assert '<a href="https://pay.test/i/tok"' in page and ">Pay invoice</a>" in page
    assert "ClientBridge Inc." in page
    assert "email/header.png" in page and "email/contours.png" in page
    assert '<html lang="en-CA">' in page and "Preview text" in page


def test_every_value_is_escaped() -> None:
    page = _render(
        Brand(
            name="<b>Shady</b> & Co",
            header_url="https://clientbridge.test/email/header.png",
            art_url="https://clientbridge.test/email/contours.png",
        ),
        EmailView(
            eyebrow="Message",
            heading="<script>alert(1)</script>",
            paragraphs=('He said "hi" & left <img src=x>',),
            action=Action("Open", 'https://x.test/"onmouseover="steal()'),
        ),
    )
    assert "<script>" not in page and "<img src=x>" not in page and "<b>Shady" not in page
    assert "&lt;script&gt;" in page and "&amp; Co" in page
    assert 'href="https://x.test/&quot;onmouseover=&quot;steal()"' in page


def test_emails_are_light_like_the_site_and_the_apps() -> None:
    page = _render(PLATFORM, EmailView("Waitlist", "You're on the list.", ("x",)))
    assert '<meta name="color-scheme" content="light">' in page
    assert "prefers-color-scheme" not in page


def test_demo_emails_embed_only_referenced_bundled_images() -> None:
    from scripts.preview_emails import browser_html, samples

    for mail in samples().values():
        assert mail.html is not None
        assert "localhost:8710" not in mail.html
        assert "https://clientbridge.ca/email/" not in mail.html
        expected = {image.content_id for image in mail.images}
        assert expected
        assert expected == set(re.findall(r'src="cid:([^"]+)"', mail.html))
        for image in mail.images:
            assert image.content.startswith(b"\x89PNG\r\n\x1a\n")
        preview = browser_html(mail)
        assert "cid:" not in preview
        assert "data:image/png;base64," in preview
    assert len(samples()["login-code"].images) == 2


async def test_smtp_embeds_images_as_related_parts_and_preserves_plain_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from scripts.preview_emails import samples

    delivered: list[EmailMessage] = []

    def deliver(_self: SmtpEmailSender, message: EmailMessage) -> None:
        delivered.append(message)

    monkeypatch.setattr(SmtpEmailSender, "_deliver", deliver)
    mail = samples()["login-code"]
    await SmtpEmailSender("smtp://localhost:8716", "from@example.com").send(mail)
    message = delivered[0]
    assert message.get_content_type() == "multipart/alternative"
    plain = message.get_body(preferencelist=("plain",))
    body = message.get_body(preferencelist=("html",))
    assert plain is not None and plain.get_content().strip() == mail.body.strip()
    assert body is not None and body.get_content().strip() == mail.html
    images = {part["Content-ID"]: part for part in message.walk() if part["Content-ID"]}
    for image in mail.images:
        part = images[f"<{image.content_id}>"]
        assert part.get_content_disposition() == "inline"
        assert part.get_payload(decode=True) == image.content
        assert part.get_content_type() == image.content_type
        assert part.get_filename() == image.filename
