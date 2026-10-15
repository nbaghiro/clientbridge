"""The branded HTML each email is sent with, beside its plain text."""

from dataclasses import dataclass, field
from functools import lru_cache
from html import escape
from importlib.resources import files

# the Pewter theme from @clientbridge/tokens, which the marketing site and the apps use
INK = "#191D22"
INK_SOFT = "#3E454D"
MUTED = "#646A73"
BORDER = "#DBDEE3"
BG = "#F3F4F6"
SURFACE = "#FFFFFF"
HEAD = "#F2F3F5"
ACCENT = "#3F5E80"
ACCENT_WEAK = "#E4EAF1"
_FONT = (
    "'Schibsted Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, "
    "sans-serif"
)
_MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
_WIDTH = 560
_HEADER_HEIGHT = 100
_ART_HEIGHT = 90


@dataclass(frozen=True)
class InlineImage:
    content_id: str
    filename: str
    content: bytes
    content_type: str = "image/png"


@lru_cache
def _image(name: str) -> InlineImage:
    return InlineImage(
        content_id=f"clientbridge-{name}",
        filename=f"{name}.png",
        content=files("clientbridge").joinpath("email_assets", f"{name}.png").read_bytes(),
    )


def inline_images(html: str) -> tuple[InlineImage, ...]:
    return tuple(
        _image(name) for name in ("header", "contours") if f'"cid:clientbridge-{name}"' in html
    )


@dataclass(frozen=True)
class Action:
    label: str
    url: str


@dataclass(frozen=True)
class Row:
    label: str
    value: str
    total: bool = False


@dataclass(frozen=True)
class Brand:
    """Who an email comes from: Clientbridge itself, or a business writing to its clients."""

    name: str
    accent: str = ACCENT
    # Clientbridge's own header: the logo over the site's contour lines, the card's full width
    header_url: str | None = None
    # the site's contour lines along the foot of the card
    art_url: str | None = None
    logo_url: str | None = None
    logo_width: int | None = None
    logo_height: int = 36
    sent_with: str | None = None


@dataclass(frozen=True)
class EmailView:
    eyebrow: str
    heading: str
    paragraphs: tuple[str, ...]
    action: Action | None = None
    code: str | None = None
    rows: tuple[Row, ...] = ()
    note: str | None = None
    footer: tuple[str, ...] = field(default_factory=tuple)
    footer_link: Action | None = None


def _text(value: str) -> str:
    return escape(value).replace("\n", "<br>")


def _ink_on(color: str) -> str:
    """White or ink, whichever reads better on a brand colour."""
    red, green, blue = (int(color[i : i + 2], 16) for i in (1, 3, 5))
    return INK if (0.299 * red + 0.587 * green + 0.114 * blue) > 186 else SURFACE


def _width(width: int | None) -> str:
    return f' width="{width}"' if width else ""


def _art(brand: Brand) -> str:
    if not brand.art_url:
        return ""
    return (
        f'<tr><td style="padding:0;background:{SURFACE};border-radius:0 0 8px 8px;">'
        f'<img src="{escape(brand.art_url)}" width="{_WIDTH}" height="{_ART_HEIGHT}" alt="" '
        'style="display:block;border:0;outline:none;width:100%;height:auto;'
        'border-radius:0 0 8px 8px;"></td></tr>'
    )


def _header(brand: Brand) -> str:
    if brand.header_url:
        return (
            '<tr><td style="padding:0;background:#FFFFFF;'
            'border-radius:8px 8px 0 0;">'
            f'<img src="{escape(brand.header_url)}" width="{_WIDTH}" height="{_HEADER_HEIGHT}" '
            f'alt="{escape(brand.name)}" style="display:block;border:0;outline:none;width:100%;'
            'height:auto;border-radius:8px 8px 0 0;"></td></tr>'
        )
    if brand.logo_url:
        mark = (
            f'<img src="{escape(brand.logo_url)}"{_width(brand.logo_width)} '
            f'height="{brand.logo_height}" alt="{escape(brand.name)}" '
            f'style="display:block;border:0;outline:none;height:{brand.logo_height}px;'
            f'width:auto;max-width:240px;">'
        )
    else:
        mark = (
            f'<span style="font-family:{_FONT};font-size:20px;font-weight:700;'
            f'letter-spacing:-0.02em;color:{INK};">{escape(brand.name)}</span>'
        )
    return (
        f'<tr><td style="height:4px;line-height:4px;font-size:0;background:{brand.accent};'
        f'border-radius:8px 8px 0 0;">&nbsp;</td></tr>'
        f'<tr><td class="cb-pad" style="padding:28px 40px 20px 40px;'
        f'background:{SURFACE};">{mark}</td></tr>'
    )


def _button(action: Action, brand: Brand) -> str:
    ink = _ink_on(brand.accent)
    url = escape(action.url)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:28px 0 4px 0;"><tr>'
        f'<td style="border-radius:6px;background:{brand.accent};">'
        f'<a href="{url}" target="_blank" style="display:inline-block;padding:13px 22px;'
        f"font-family:{_FONT};font-size:15px;font-weight:600;line-height:1.2;color:{ink};"
        f'text-decoration:none;border-radius:6px;">{escape(action.label)}</a></td></tr></table>'
        f'<p style="margin:14px 0 0 0;font-family:{_FONT};font-size:12px;'
        f'line-height:1.5;color:{MUTED};word-break:break-all;">'
        f'<a href="{url}" style="color:{MUTED};text-decoration:underline;">{url}</a></p>'
    )


def _code(code: str) -> str:
    spacing = "0.28em" if len(code) <= 8 else "0.08em"
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin:24px 0 4px 0;"><tr>'
        f'<td align="center" style="background:{HEAD};border:1px solid {BORDER};'
        f"border-radius:8px;padding:18px 12px;font-family:{_MONO};font-size:30px;"
        f'font-weight:600;letter-spacing:{spacing};color:{INK};">{escape(code)}</td></tr></table>'
    )


def _rows(rows: tuple[Row, ...]) -> str:
    cells = []
    for row in rows:
        weight = "600" if row.total else "400"
        color = INK if row.total else INK_SOFT
        rule = f"border-top:1px solid {BORDER};" if row.total else ""
        pad = "12px 0 0 0" if row.total else "6px 0"
        cells.append(
            f'<tr><td style="{rule}padding:{pad};font-family:{_FONT};font-size:14px;'
            f'font-weight:{weight};color:{color};">{_text(row.label)}</td>'
            f'<td align="right" style="{rule}padding:{pad};font-family:{_MONO};font-size:14px;'
            f'font-weight:{weight};color:{color};white-space:nowrap;">{_text(row.value)}</td></tr>'
        )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="margin:24px 0 0 0;background:{HEAD};border:1px solid {BORDER};'
        'border-radius:8px;"><tr><td style="padding:14px 18px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
        f"{''.join(cells)}</table></td></tr></table>"
    )


def _body(brand: Brand, view: EmailView) -> str:
    parts = [
        f'<p style="margin:0 0 10px 0;font-family:{_FONT};font-size:12px;font-weight:600;'
        f'letter-spacing:0.08em;text-transform:uppercase;color:{brand.accent};">'
        f"{_text(view.eyebrow)}</p>",
        f'<h1 style="margin:0 0 16px 0;font-family:{_FONT};font-size:28px;'
        f'line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:{INK};">'
        f"{_text(view.heading)}</h1>",
    ]
    parts.extend(
        f'<p style="margin:0 0 14px 0;font-family:{_FONT};font-size:16px;'
        f'line-height:1.6;color:{INK_SOFT};">{_text(paragraph)}</p>'
        for paragraph in view.paragraphs
    )
    if view.code:
        parts.append(_code(view.code))
    if view.rows:
        parts.append(_rows(view.rows))
    if view.action:
        parts.append(_button(view.action, brand))
    if view.note:
        parts.append(
            f'<p style="margin:24px 0 0 0;font-family:{_FONT};font-size:14px;'
            f'line-height:1.6;color:{MUTED};">{_text(view.note)}</p>'
        )
    bottom = "8px" if brand.art_url else "36px"
    return (
        f'<tr><td class="cb-pad" style="padding:24px 40px {bottom} 40px;'
        f'background:{SURFACE};">{"".join(parts)}</td></tr>{_art(brand)}'
    )


def _footer(brand: Brand, view: EmailView) -> str:
    style = f"margin:0 0 6px 0;font-family:{_FONT};font-size:12px;line-height:1.6;color:{MUTED};"
    text = "".join(f'<p style="{style}">{_text(line)}</p>' for line in view.footer)
    if view.footer_link:
        text += (
            f'<p style="{style}"><a href="{escape(view.footer_link.url)}" '
            f'style="color:{MUTED};text-decoration:underline;">'
            f"{_text(view.footer_link.label)}</a></p>"
        )
    if brand.sent_with:
        text += f'<p style="{style}">{_text(brand.sent_with)}</p>'
    return f'<tr><td class="cb-pad" style="padding:24px 40px 0 40px;">{text}</td></tr>'


_PHONE = (
    "@media (max-width: 600px) "
    "{ .cb-pad { padding-left:24px !important; padding-right:24px !important; } }"
)


def render_html(brand: Brand, view: EmailView, *, preheader: str, lang: str) -> str:
    """The whole document: table layout and inline styles, which every mail client keeps."""
    return (
        "<!doctype html>"
        f'<html lang="{escape(lang)}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light">'
        '<meta name="supported-color-schemes" content="light">'
        f"<title>{escape(view.heading)}</title><style>{_PHONE}</style></head>"
        f'<body style="margin:0;padding:0;background:{BG};">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        f"{escape(preheader)}</div>"
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="background:{BG};"><tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="{_WIDTH}" style="width:100%;max-width:{_WIDTH}px;">'
        '<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="border:1px solid {BORDER};border-radius:8px;'
        f'background:{SURFACE};">'
        f"{_header(brand)}{_body(brand, view)}</table></td></tr>"
        f"{_footer(brand, view)}"
        "</table></td></tr></table></body></html>"
    )
