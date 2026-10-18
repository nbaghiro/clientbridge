from urllib.parse import parse_qsl

from pydantic import ValidationError

from clientbridge.core.config import get_settings
from clientbridge.core.locale import locale_for, message
from clientbridge.integrations.resend import Email, EmailSender
from clientbridge.schemas.site import ContactForm


async def contact(body: bytes, sender: EmailSender) -> bool:
    try:
        pairs = parse_qsl(body.decode("utf-8"), max_num_fields=10, strict_parsing=True)
        fields = dict(pairs)
        if fields.get("website"):
            return True
        if len(fields) != len(pairs):
            return False
        data = ContactForm.model_validate(fields)
    except (UnicodeError, ValueError, ValidationError):
        return False
    try:
        await sender.send(
            Email(
                to=get_settings().contact_to,
                reply_to=data.email,
                subject=message(locale_for(), "contact.subject", name=data.name),
                body=f"{data.name} <{data.email}>\n\n{data.message}",
            )
        )
    except Exception:
        return False
    return True
