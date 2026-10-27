import base64
from datetime import UTC, datetime

from clientbridge.core.locale import SOURCE_LOCALE, format_day_and_time
from clientbridge.integrations.resend import Email
from clientbridge.models.business import Business
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services import notifications as n

LOCALE = SOURCE_LOCALE


def emails() -> list[tuple[str, Email]]:
    business = Business(
        id="bz_demo", name=n.message(LOCALE, "admin_demo.business"), timezone="America/Vancouver"
    )
    when = format_day_and_time(LOCALE, datetime(2026, 10, 22, 17, 30, tzinfo=UTC), "UTC")
    code = AuthEmailIn(
        template_type="login_code_valid", to="you@example.com", code="482913", expires_in_minutes=15
    )
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
    keys = ("login-code", "staff-invite", "trial-ending", "estimate-declined")
    return dict(zip(keys, (mail for _, mail in emails()), strict=True))
