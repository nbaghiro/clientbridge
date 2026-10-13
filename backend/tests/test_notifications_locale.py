import inspect
import math
import re
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import get_args

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.locale import (
    PSEUDO_LOCALE,
    SOURCE_LOCALE,
    currency_for,
    format_day_and_time,
    format_money,
    format_number,
    format_percent,
    locale_for,
    message,
    plural,
    pseudo,
)
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.schemas.auth import AuthEmailIn, AuthEmailType
from clientbridge.services import notifications as n
from tests.conftest import FakeEmailSender

BIZ = "bz_birchbark"
NAME = "Birchbark"
LINK = "https://pay.test/i/tok"
ADDRESS = "12 Main St, Victoria, BC"
CONTACT = "hi@birchbark.example"
INPUTS = [
    *(LINK, NAME, "123456", "CODE", "Intake", "Waiver", "Too far", "REF-1", "pay@x.ca"),
    *("CN-1", "GC-1", "GST", "Shampoo", "Sale", "STOP", ADDRESS, CONTACT),
]
MOMENT = datetime(2026, 10, 9, 21, 30, tzinfo=UTC)

Render = Callable[[str], tuple[str, ...] | list[str] | str]


def _builders() -> dict[str, Render]:
    def when(locale: str) -> str:
        return format_day_and_time(locale, MOMENT, "America/Vancouver")

    def whens(locale: str) -> str:
        return message(locale, "series.separator").join([when(locale), when(locale)])

    def amount(locale: str) -> str:
        return format_money(locale, 123456, "CAD")

    def auth_email(locale: str, template_type: AuthEmailType) -> tuple[str, str]:
        email = AuthEmailIn(
            template_type=template_type, to="a@x.ca", code="123456", expires_in_minutes=15
        )
        if template_type == "verification_code_valid":
            email.link = LINK
        return n.auth_email_message(locale, email)

    return {
        "returning_code": lambda c: n.returning_code(c, NAME, "123456", 10),
        "staff_invite": lambda c: n.staff_invite(c, LINK),
        "auth_email_message": lambda c: tuple(
            text for kind in get_args(AuthEmailType) for text in auth_email(c, kind)
        ),
        "receipt_message": lambda c: n.receipt_message(c, NAME, amount(c), ["Shampoo"]),
        "receipt_pickup_line": lambda c: n.receipt_pickup_line(c, NAME),
        "online_order_alert_message": lambda c: n.online_order_alert_message(c, amount(c)),
        "sale_receipt_message": lambda c: (
            n.sale_receipt_message(c, NAME, 42, LINK) + n.sale_receipt_message(c, NAME, None, LINK)
        ),
        "order_ready_message": lambda c: n.order_ready_message(c, NAME),
        "order_reminder_message": lambda c: n.order_reminder_message(c, NAME),
        "receipt_detail_lines": lambda c: n.receipt_detail_lines(
            c,
            [("Shampoo", format_number(c, 2), amount(c))],
            amount(c),
            [("GST", amount(c))],
            amount(c),
        ),
        "dispute_alert_text": lambda c: n.dispute_alert_text(c, amount(c)),
        "invoice_sent_message": lambda c: (
            n.invoice_sent_message(c, 1001, amount(c), NAME, LINK)
            + n.invoice_sent_message(c, 1001, amount(c), NAME, "")
        ),
        "invoice_overdue_message": lambda c: (
            n.invoice_overdue_message(c, 1001, amount(c), NAME, LINK)
            + n.invoice_overdue_message(c, 1001, amount(c), NAME, "")
        ),
        "estimate_sent_message": lambda c: (
            n.estimate_sent_message(c, 7, amount(c), NAME, LINK)
            + n.estimate_sent_message(c, 7, amount(c), NAME, "")
        ),
        "estimate_accepted_message": lambda c: n.estimate_accepted_message(c, 7),
        "estimate_declined_message": lambda c: (
            n.estimate_declined_message(c, 7, "Too far") + n.estimate_declined_message(c, 7, None)
        ),
        "payment_failed_message": lambda c: n.payment_failed_message(c, amount(c), NAME),
        "refund_failed_message": lambda c: n.refund_failed_message(c, amount(c), NAME),
        "refund_message": lambda c: (
            n.refund_message(c, amount(c), NAME, "CN-1")
            + n.refund_message(c, amount(c), NAME, None)
        ),
        "subscription_past_due_message": lambda c: n.subscription_past_due_message(c, NAME),
        "subscription_canceled_message": lambda c: n.subscription_canceled_message(c, NAME),
        "gift_card_issued_message": lambda c: n.gift_card_issued_message(
            c, NAME, amount(c), "GC-1"
        ),
        "booking_reminder_message": lambda c: (
            n.booking_reminder_message(c, NAME, when(c), LINK)
            + n.booking_reminder_message(c, NAME, when(c), None)
        ),
        "booking_confirmed_message": lambda c: (
            n.booking_confirmed_message(c, NAME, when(c), LINK)
            + n.booking_confirmed_message(c, NAME, when(c), None)
        ),
        "booking_rescheduled_message": lambda c: n.booking_rescheduled_message(c, NAME, when(c)),
        "booking_canceled_message": lambda c: n.booking_canceled_message(c, NAME, when(c)),
        "booking_reassigned_message": lambda c: (
            n.booking_reassigned_message(c, NAME, [when(c)], NAME)
            + n.booking_reassigned_message(c, NAME, [when(c), when(c)], NAME)
        ),
        "booking_requested_message": lambda c: n.booking_requested_message(c, NAME, when(c)),
        "booking_released_message": lambda c: n.booking_released_message(c, NAME, when(c)),
        "series_booked_message": lambda c: n.series_booked_message(c, NAME, whens(c)),
        "series_moved_message": lambda c: n.series_moved_message(c, NAME, whens(c)),
        "series_canceled_message": lambda c: n.series_canceled_message(c, NAME, whens(c)),
        "form_sent_message": lambda c: n.form_sent_message(c, NAME, "Intake", LINK),
        "contract_sent_message": lambda c: n.contract_sent_message(c, NAME, "Waiver", LINK),
        "review_requested_message": lambda c: n.review_requested_message(c, NAME, LINK),
        "inbound_message_alert_text": lambda c: n.inbound_message_alert_text(c, NAME, "Sale"),
        "broadcast_text": lambda c: (
            n.broadcast_text(c, NAME, "sms", "Sale", LINK, ADDRESS, CONTACT),
            n.broadcast_text(c, NAME, "email", "Sale", LINK, ADDRESS, CONTACT),
        ),
    }


def _texts(rendered: tuple[str, ...] | list[str] | str) -> list[str]:
    return [rendered] if isinstance(rendered, str) else list(rendered)


def test_every_builder_is_rendered_here() -> None:
    builders = {
        name
        for name, fn in inspect.getmembers(n, inspect.isfunction)
        if fn.__module__ == n.__name__
        and next(iter(inspect.signature(fn).parameters), "") == "locale"
    }
    assert builders - {"_when"} == set(_builders())


def test_every_builder_renders_only_pseudo_text_in_en_xa() -> None:
    for name, render in _builders().items():
        for text in _texts(render(PSEUDO_LOCALE)):
            assert "[" in text and "]" in text, name
            leftover = text
            for value in INPUTS:
                leftover = leftover.replace(value, "")
            assert re.search(r"[A-Za-z]", leftover) is None, (name, text)


def test_english_builders_render_complete_text() -> None:
    for name, render in _builders().items():
        for text in _texts(render(SOURCE_LOCALE)):
            assert "[" not in text and "{" not in text and "~" not in text, (name, text)


def test_sms_opt_out_keeps_the_carrier_keyword() -> None:
    assert n.broadcast_text(SOURCE_LOCALE, NAME, "sms", "Sale", LINK, ADDRESS, CONTACT) == (
        "Birchbark: Sale Reply STOP to opt out."
    )
    pseudo_sms = n.broadcast_text(PSEUDO_LOCALE, NAME, "sms", "Sale", LINK, ADDRESS, CONTACT)
    assert " STOP " in pseudo_sms


def test_a_broadcast_email_identifies_the_business() -> None:
    text = n.broadcast_text(SOURCE_LOCALE, NAME, "email", "Sale", LINK, ADDRESS, CONTACT)
    assert text == (
        f"Sale\n\nBirchbark\n{ADDRESS}\nContact: {CONTACT}\n"
        f"Unsubscribe or change what you get: {LINK}"
    )


def test_pseudo_keeps_placeholders_and_grows_the_text() -> None:
    source = "Hello {name}, you owe {amount}"
    out = pseudo(source)
    assert out.startswith("[") and out.endswith("]")
    assert "{name}" in out and "{amount}" in out
    assert out.count("~") == math.ceil(len("Hello , you owe ") * 0.35)
    assert re.search(r"[A-Za-z]", out.replace("{name}", "").replace("{amount}", "")) is None


def test_plural_follows_the_count() -> None:
    one = plural(SOURCE_LOCALE, "returning_code.body", 1, code="1")
    many = plural(SOURCE_LOCALE, "returning_code.body", 10, code="1")
    assert "expires in 1 minute." in one and "expires in 10 minutes." in many


@pytest.mark.parametrize(
    ("cents", "currency", "expected"),
    [
        (4800, "CAD", "$48.00"),
        (4800, "cad", "$48.00"),
        (123456789, "CAD", "$1,234,567.89"),
        (-1250, "CAD", "-$12.50"),
        (5, "CAD", "$0.05"),
        (4800, "USD", "US$48.00"),
    ],
)
def test_money_uses_the_amount_currency(cents: int, currency: str, expected: str) -> None:
    assert format_money(SOURCE_LOCALE, cents, currency) == expected


@pytest.mark.parametrize(
    ("moment", "zone", "expected"),
    [
        (MOMENT, "America/Vancouver", "Friday, October 9 at 2:30 p.m."),
        (MOMENT, "America/Halifax", "Friday, October 9 at 6:30 p.m."),
        (MOMENT, "Asia/Tokyo", "Saturday, October 10 at 6:30 a.m."),
        (
            datetime(2027, 1, 4, 17, 5, tzinfo=UTC),
            "America/Toronto",
            "Monday, January 4 at 12:05 p.m.",
        ),
    ],
)
def test_dates_render_in_the_business_zone(moment: datetime, zone: str, expected: str) -> None:
    assert format_day_and_time(SOURCE_LOCALE, moment, zone) == expected


def test_numbers_and_percentages() -> None:
    assert format_number(SOURCE_LOCALE, Decimal("2.000")) == "2"
    assert format_number(SOURCE_LOCALE, Decimal("1.50")) == "1.5"
    assert format_number(SOURCE_LOCALE, 1234.5) == "1,234.5"
    assert format_percent(SOURCE_LOCALE, Decimal("0.05")) == "5%"
    assert format_percent(PSEUDO_LOCALE, Decimal("0.13")) == "13%"


def test_locale_is_en_ca_unless_the_pseudo_switch_is_on(monkeypatch: pytest.MonkeyPatch) -> None:
    assert locale_for() == SOURCE_LOCALE
    monkeypatch.setattr(get_settings(), "pseudo_locale", True)
    assert locale_for() == PSEUDO_LOCALE


async def test_estimate_currency_comes_from_the_business_country(db: AsyncSession) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    assert currency_for(business) == "CAD"


async def test_pseudo_switch_reaches_sent_notifications(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    email: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "pseudo_locale", True)
    business = await db.get(Business, BIZ)
    client = (await db.execute(select(Client).where(Client.business_id == BIZ))).scalars().first()
    item_id = (
        await db.execute(
            select(Item.id)
            .where(Item.business_id == BIZ, Item.duration_min.isnot(None), Item.active.is_(True))
            .limit(1)
        )
    ).scalar_one()
    assert business is not None and client is not None
    client.email = "pseudo@example.ca"
    await db.flush()
    res = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": client.id,
            "item_id": item_id,
            "staff_id": "st_owner",
            "starts_at": "2027-05-01T17:00:00Z",
        },
    )
    assert res.status_code == 201, res.text
    sent = next(m for m in email.sent if m.to == "pseudo@example.ca")
    assert sent.subject == message(
        PSEUDO_LOCALE, "booking_confirmed.subject", business=business.name
    )
    assert "Šåţûŕðåý, Ṁåý 1 åţ 10:00 å.ɱ." in sent.body
