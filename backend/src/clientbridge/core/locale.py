import gettext
import math
import re
from datetime import datetime
from decimal import Decimal
from functools import cache
from io import BytesIO
from pathlib import Path

from babel import Locale, dates, numbers
from babel.messages.mofile import write_mo
from babel.messages.pofile import read_po

from clientbridge.core.config import get_settings
from clientbridge.core.zones import zone
from clientbridge.models.business import Business, User
from clientbridge.models.clients import Client

LOCALES = Path(__file__).resolve().parents[1] / "locales"
SOURCE_LOCALE = "en_CA"
PSEUDO_LOCALE = "en_XA"
Value = str | int

_PLACEHOLDER = re.compile(r"(\{[^{}]*\})")
_ACCENTS = str.maketrans(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ",
)
# CLDR's narrow and no-break spaces would push an SMS out of the GSM-7 alphabet
_SPACES = str.maketrans({"\u202f": " ", "\u00a0": " "})


def locale_for(
    *, business: Business | None = None, client: Client | None = None, user: User | None = None
) -> str:
    """The locale backend text for this audience renders in; every surface asks here."""
    return PSEUDO_LOCALE if get_settings().pseudo_locale else SOURCE_LOCALE


def currency_for(business: Business) -> str:
    """The currency a business prices in when a record carries none of its own."""
    return numbers.get_territory_currencies(get_settings().stripe_connect_country)[0]


def message(locale: str, key: str, **values: Value) -> str:
    return _catalog(locale).gettext(key).format(**values)


def plural(locale: str, key: str, count: int, **values: Value) -> str:
    return _catalog(locale).ngettext(key, key, count).format(count=count, **values)


def format_money(locale: str, cents: int, currency: str) -> str:
    amount = Decimal(cents).scaleb(-2)
    return _value(locale, numbers.format_currency(amount, currency.upper(), locale=_cldr(locale)))


def format_number(locale: str, value: Decimal | float) -> str:
    return _value(locale, numbers.format_decimal(value, locale=_cldr(locale)))


def format_percent(locale: str, value: Decimal | float) -> str:
    return _value(locale, numbers.format_percent(value, locale=_cldr(locale)))


def format_day_and_time(locale: str, moment: datetime, timezone: str) -> str:
    """A moment as the business's clock shows it: "Friday, October 9 at 2:30 p.m." in en_CA."""
    tz = zone(timezone)
    cldr = _cldr(locale)
    day = dates.format_date(moment.astimezone(tz), _long_day(cldr), locale=cldr)
    time = dates.format_time(moment, "short", tzinfo=tz, locale=cldr)
    return message(
        locale, "datetime.day_at_time", day=_value(locale, day), time=_value(locale, time)
    )


def format_time(locale: str, moment: datetime, timezone: str) -> str:
    """A moment's time of day on the business's clock: "2:30 p.m." in en_CA."""
    cldr = _cldr(locale)
    return _value(locale, dates.format_time(moment, "short", tzinfo=zone(timezone), locale=cldr))


def pseudo(text: str) -> str:
    """The en_XA form of a message: accented, about 35% longer and bracketed."""
    parts = _PLACEHOLDER.split(text)
    visible = sum(len(part) for i, part in enumerate(parts) if i % 2 == 0)
    accented = "".join(part if i % 2 else part.translate(_ACCENTS) for i, part in enumerate(parts))
    return f"[{accented}{'~' * math.ceil(visible * 0.35)}]"


@cache
def _catalog(locale: str) -> gettext.GNUTranslations:
    with (LOCALES / f"{locale}.po").open("rb") as po:
        catalog = read_po(po, locale=locale)
    compiled = BytesIO()
    write_mo(compiled, catalog)
    compiled.seek(0)
    return gettext.GNUTranslations(compiled)


def _cldr(locale: str) -> Locale:
    return Locale.parse(SOURCE_LOCALE if locale == PSEUDO_LOCALE else locale)


def _value(locale: str, formatted: str) -> str:
    plain = formatted.translate(_SPACES)
    return plain.translate(_ACCENTS) if locale == PSEUDO_LOCALE else plain


@cache
def _long_day(locale: Locale) -> str:
    pattern = locale.datetime_skeletons["MMMEd"].pattern
    return re.sub(r"M{3,}", "MMMM", re.sub(r"E+", "EEEE", pattern))
