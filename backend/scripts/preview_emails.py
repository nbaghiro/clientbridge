"""Render the emails with demo data into one page, for reviewing the designs in a browser."""

import argparse
import asyncio
import html
from dataclasses import replace
from pathlib import Path

from clientbridge.core.config import get_settings
from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.integrations.resend import Email, ResendEmailSender, SmtpEmailSender
from clientbridge.services.email_samples import browser_html, samples

OUT = Path(__file__).resolve().parents[2] / ".scratchpad" / "emails"
LOCALE = SOURCE_LOCALE


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
