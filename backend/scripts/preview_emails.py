"""Render the emails with demo data into one page, for reviewing the designs in a browser."""

import argparse
import asyncio
import base64
import html
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from clientbridge.core.config import get_settings
from clientbridge.core.email_layout import Brand
from clientbridge.core.locale import SOURCE_LOCALE, format_day_and_time, format_money
from clientbridge.integrations.resend import Email, ResendEmailSender, SmtpEmailSender
from clientbridge.models.business import Business
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services import notifications as n

OUT = Path(__file__).resolve().parents[2] / ".scratchpad" / "emails"
LOCALE = SOURCE_LOCALE


def _business() -> Business:
    return Business(
        id="bz_demo",
        name="Birchbark Pet Studio",
        timezone="America/Vancouver",
        billing_email="hello@birchbark.example",
        brand={
            "primary": "#2F6B4F",
            "address": "1204 Fort St, Victoria, BC",
            "phone": "(250) 555-0142",
        },
    )


def emails() -> list[tuple[str, Email]]:
    business = _business()
    brand = Brand(
        name=business.name,
        accent="#2F6B4F",
        art_url="cid:clientbridge-contours",
        sent_with=n.message(LOCALE, "email.sent_with"),
    )
    when = format_day_and_time(LOCALE, datetime(2026, 10, 22, 17, 30, tzinfo=UTC), "UTC")
    total = format_money(LOCALE, 8610, "CAD")
    itemised = n.receipt_detail_lines(
        LOCALE,
        [
            ("Full groom, large dog", "1", format_money(LOCALE, 7200, "CAD")),
            ("Nail grind", "1", format_money(LOCALE, 1000, "CAD")),
        ],
        format_money(LOCALE, 8200, "CAD"),
        [("GST", format_money(LOCALE, 410, "CAD"))],
        total,
    )
    code = AuthEmailIn(
        template_type="login_code_valid", to="you@example.com", code="482913", expires_in_minutes=15
    )
    to_client = [
        n.invoice_sent_message(LOCALE, 1042, total, business.name, "https://pay.test/i/demo"),
        n.receipt_message(LOCALE, business.name, total, itemised)[0],
        n.booking_confirmed_message(LOCALE, business.name, when, "https://book.test/m/demo"),
        n.estimate_sent_message(LOCALE, 318, total, business.name, "https://pay.test/e/demo"),
        n.gift_card_issued_message(LOCALE, business.name, total, "GC-7K2Q-91"),
        n.message_notice(LOCALE, business.name, "See you Thursday.\n\nBring Biscuit's leash."),
    ]
    to_team = [
        n.staff_invite(LOCALE, business.name, "https://app.test/accept-invite?token=demo"),
        n.trial_ending_message(LOCALE, business.name, when, "https://app.test/plan", last_day=True),
        n.estimate_declined_message(LOCALE, 318, "Too far out of town"),
    ]
    return [
        (
            "Sign-in code",
            n.account_email("you@example.com", n.auth_email_message(LOCALE, code), locale=LOCALE),
        ),
        *((m.subject, n.business_email(business, "owner@example.com", m)) for m in to_team),
        *((m.subject, n.client_email(business, brand, "grace@example.com", m)) for m in to_client),
    ]


def browser_html(mail: Email) -> str:
    page = mail.html or ""
    for image in mail.images:
        encoded = base64.b64encode(image.content).decode("ascii")
        page = page.replace(
            f'"cid:{image.content_id}"', f'"data:{image.content_type};base64,{encoded}"'
        )
    return page


def samples() -> dict[str, Email]:
    keys = (
        "login-code",
        "staff-invite",
        "trial-ending",
        "estimate-declined",
        "invoice",
        "receipt",
        "booking-confirmed",
        "estimate",
        "gift-card",
        "message",
    )
    return dict(zip(keys, (mail for _, mail in emails()), strict=True))


async def send_sample(mail: Email, recipient: str, transport: str) -> str | None:
    settings = get_settings()
    if transport == "resend":
        if not settings.resend_api_key or not settings.email_from:
            raise ValueError("resend requires RESEND_API_KEY and EMAIL_FROM")
        sender = ResendEmailSender(settings.resend_api_key, settings.email_from)
    else:
        if not settings.smtp_url:
            raise ValueError("smtp requires SMTP_URL")
        sender = SmtpEmailSender(
            settings.smtp_url, settings.email_from or "no-reply@clientbridge.ca"
        )
    demo = replace(
        mail,
        to=recipient,
        subject=f"[TEST] {mail.subject}",
        reply_to=None,
        idempotency_key=None,
        tags={"purpose": "email-preview"},
    )
    return await sender.send(demo)


def main() -> None:
    choices = samples()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="list the demo email names")
    parser.add_argument("--email", choices=choices, help="preview or send one demo email")
    parser.add_argument("--send-to", help="send the selected demo to one recipient")
    parser.add_argument(
        "--transport", choices=("smtp", "resend"), help="explicit delivery transport"
    )
    args = parser.parse_args()
    if args.list:
        for key, mail in choices.items():
            print(f"{key}: {mail.subject}")
        return
    if args.send_to:
        if not args.email or not args.transport:
            parser.error("--send-to requires --email and --transport")
        if "@" not in args.send_to or any(c in args.send_to for c in "\r\n,;"):
            parser.error("--send-to must be one email address")
        ref = asyncio.run(send_sample(choices[args.email], args.send_to, args.transport))
        print(f"sent {args.email} via {args.transport}; delivery id: {ref or 'SMTP accepted'}")
        return
    if args.transport:
        parser.error("--transport requires --send-to")
    OUT.mkdir(parents=True, exist_ok=True)
    cards: list[str] = []
    for key, mail in choices.items():
        if args.email and args.email != key:
            continue
        title = key
        name = f"{key}.html"
        (OUT / name).write_text(browser_html(mail))
        cards.append(
            f"<section><h2>{html.escape(title)}</h2><p>{html.escape(mail.subject)}</p>"
            f'<iframe src="{name}" width="640" height="760"></iframe>'
            f'<iframe src="{name}" width="375" height="760"></iframe></section>'
        )
    (OUT / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>emails</title>'
        "<style>body{font-family:sans-serif;background:#e9ebee;margin:24px}"
        "section{background:#fff;padding:16px;margin-bottom:24px;border-radius:8px}"
        "iframe{border:1px solid #dbdee3;margin-right:16px;vertical-align:top}</style>"
        + "".join(cards)
    )
    print(f"wrote {len(cards)} emails to {OUT / 'index.html'}")


if __name__ == "__main__":
    main()
