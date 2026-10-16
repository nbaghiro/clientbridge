import base64
from datetime import UTC, datetime

from clientbridge.core.email_layout import Brand
from clientbridge.core.locale import SOURCE_LOCALE, format_day_and_time, format_money
from clientbridge.integrations.resend import Email
from clientbridge.models.business import Business
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services import notifications as n

LOCALE = SOURCE_LOCALE


def _business() -> Business:
    return Business(
        id="bz_demo",
        name=n.message(LOCALE, "admin_demo.business"),
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
            (n.message(LOCALE, "admin_demo.groom"), "1", format_money(LOCALE, 7200, "CAD")),
            (n.message(LOCALE, "admin_demo.nails"), "1", format_money(LOCALE, 1000, "CAD")),
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
        n.message_notice(LOCALE, business.name, n.message(LOCALE, "admin_demo.message")),
    ]
    to_team = [
        n.staff_invite(LOCALE, business.name, "https://app.test/accept-invite?token=demo"),
        n.trial_ending_message(LOCALE, business.name, when, "https://app.test/plan", last_day=True),
        n.estimate_declined_message(LOCALE, 318, n.message(LOCALE, "admin_demo.declined")),
    ]
    return [
        (
            n.message(LOCALE, "admin_demo.login"),
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
