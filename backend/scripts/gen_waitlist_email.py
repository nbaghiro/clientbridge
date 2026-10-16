"""Write the waitlist confirmation the site server sends, from the shared email layout."""

import json
from dataclasses import replace
from pathlib import Path

from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.services.notifications import email_html, platform_brand, waitlist_message

# the site's server sends this one, so its images come from the site rather than as attachments
SITE = "https://clientbridge.ca"
OUT = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "apps"
    / "site"
    / "server"
    / "waitlist-email.json"
)


def _email(*, already: bool) -> dict[str, str]:
    notice = waitlist_message(SOURCE_LOCALE, f"{SITE}/features", already=already)
    brand = replace(
        platform_brand(),
        header_url=f"{SITE}/email/header.png",
        art_url=f"{SITE}/email/contours.png",
    )
    html = email_html(brand, notice.view, SOURCE_LOCALE)
    return {"subject": notice.subject, "text": notice.body, "html": html}


def main() -> None:
    payload = {"joined": _email(already=False), "already": _email(already=True)}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=4) + "\n")


if __name__ == "__main__":
    main()
