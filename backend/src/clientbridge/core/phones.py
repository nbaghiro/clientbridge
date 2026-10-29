import re
from typing import Annotated

from pydantic import AfterValidator
from sqlalchemy import ColumnElement, func
from sqlalchemy.orm import InstrumentedAttribute


def e164(value: str) -> str | None:
    """A North American number with or without +1, or any +country number, as E.164; else None."""
    digits = re.sub(r"[^0-9]", "", value)
    international = value.strip().startswith("+")
    if not international and len(digits) == 10:
        digits = "1" + digits
    if international and 8 <= len(digits) <= 15 and not digits.startswith("0"):
        return "+" + digits
    if len(digits) == 11 and digits.startswith("1") and digits[1] not in "01":
        return "+" + digits
    return None


def reserved_phone(value: str) -> bool:
    """A North American 555-0100 to 555-0199 number, which is set aside for fiction."""
    number = e164(value)
    return number is not None and re.fullmatch(r"\+1\d{3}55501\d{2}", number) is not None


def _phone(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    parsed = e164(value)
    if parsed is None:
        raise ValueError("enter a 10-digit phone number, or a number with its + country code")
    return parsed


Phone = Annotated[str | None, AfterValidator(_phone)]


def _required_phone(value: str) -> str:
    parsed = _phone(value)
    if parsed is None:
        raise ValueError("provide a mobile number")
    return parsed


RequiredPhone = Annotated[str, AfterValidator(_required_phone)]


def same_phone(column: InstrumentedAttribute[str | None], *numbers: str) -> ColumnElement[bool]:
    """Matches E.164 numbers against a stored phone, whether stored as E.164 or as typed."""
    digits = func.regexp_replace(column, "[^0-9]", "", "g")
    local = [
        form
        for number in numbers
        for form in ([number[1:], number[2:]] if number.startswith("+1") else [number[1:]])
    ]
    return digits.in_(local)
