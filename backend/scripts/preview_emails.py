"""Render the emails with demo data into one page, for reviewing the designs in a browser."""

import html
from datetime import UTC, datetime
from pathlib import Path

from clientbridge.core.config import get_settings
from clientbridge.core.email_layout import Brand
from clientbridge.core.locale import SOURCE_LOCALE, format_day_and_time, format_money
from clientbridge.integrations.resend import Email
from clientbridge.models.business import Business
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services import notifications as n

# the images the emails show are served by the marketing site
SITE = "https://clientbridge.ca"
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
        art_url=f"{SITE}/email/contours.png",
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


def main() -> None:
    get_settings().site_base_url = SITE
    OUT.mkdir(parents=True, exist_ok=True)
    cards: list[str] = []
    for index, (title, mail) in enumerate(emails()):
        name = f"email-{index}.html"
        (OUT / name).write_text(mail.html or "")
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
