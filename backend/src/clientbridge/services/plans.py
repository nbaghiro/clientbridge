from dataclasses import dataclass
from typing import Literal

from clientbridge.core.locale import message

type PlanInterval = Literal["month", "year"]


@dataclass(frozen=True)
class PlanPrice:
    product: str
    amount_cents: int
    interval: PlanInterval


PLAN_CURRENCY = "cad"
# Stripe's tax code for business-use software as a service
PLAN_TAX_CODE = "txcd_10103001"
# keyed by Stripe price lookup key; tax-exclusive, and a year costs ten months
PLAN_PRICES: dict[str, PlanPrice] = {
    "premium_month": PlanPrice("clientbridge_premium", 4999, "month"),
    "premium_year": PlanPrice("clientbridge_premium", 49990, "year"),
    "team_month": PlanPrice("clientbridge_team", 9999, "month"),
    "team_year": PlanPrice("clientbridge_team", 99990, "year"),
    "seat_month": PlanPrice("clientbridge_seat", 1000, "month"),
}


def product_names(locale: str) -> dict[str, str]:
    """The Stripe product names owners see in Checkout, on invoices and in the portal."""
    return {
        "clientbridge_premium": message(locale, "plans.premium"),
        "clientbridge_team": message(locale, "plans.team"),
        "clientbridge_seat": message(locale, "plans.seat"),
    }
