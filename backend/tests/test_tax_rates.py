"""Published sales-tax rates pinned per province; review them each release and after any budget."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.services.tax import rates_for_business, rates_on, supply_date
from tests.conftest import BIZ

TODAY = date(2026, 10, 12)

# https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
PUBLISHED: dict[str, list[tuple[str, str]]] = {
    "AB": [("GST", "0.05")],
    # https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst
    "BC": [("GST", "0.05"), ("PST", "0.07")],
    # https://www.gov.mb.ca/finance/taxation/taxes/retail.html
    "MB": [("GST", "0.05"), ("PST", "0.07")],
    "NB": [("HST", "0.15")],
    "NL": [("HST", "0.15")],
    "NS": [("HST", "0.14")],
    "NT": [("GST", "0.05")],
    "NU": [("GST", "0.05")],
    "ON": [("HST", "0.13")],
    "PE": [("HST", "0.15")],
    # https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/calculating-the-taxes/
    "QC": [("GST", "0.05"), ("QST", "0.09975")],
    # https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax
    "SK": [("GST", "0.05"), ("PST", "0.06")],
    "YT": [("GST", "0.05")],
}
COMBINED = {
    "AB": "0.05",
    "BC": "0.12",
    "MB": "0.12",
    "NB": "0.15",
    "NL": "0.15",
    "NS": "0.14",
    "NT": "0.05",
    "NU": "0.05",
    "ON": "0.13",
    "PE": "0.15",
    "QC": "0.14975",
    "SK": "0.11",
    "YT": "0.05",
}


@pytest.mark.parametrize("province", sorted(PUBLISHED))
def test_each_province_charges_its_published_rates(province: str) -> None:
    rates = rates_on(province, TODAY)
    assert [(r.jurisdiction, r.rate) for r in rates] == [
        (code, Decimal(rate)) for code, rate in PUBLISHED[province]
    ]
    assert sum(r.rate for r in rates) == Decimal(COMBINED[province])


def test_api_rates_round_qst_to_whole_basis_points() -> None:
    assert [(r.id, r.rate_bps) for r in rates_on("QC", TODAY)] == [("QC_GST", 500), ("QC_QST", 998)]


def test_nova_scotia_hst_dropped_to_14_on_april_1_2025() -> None:
    # https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html
    assert [r.rate for r in rates_on("NS", date(2025, 3, 31))] == [Decimal("0.15")]
    assert [r.rate for r in rates_on("NS", date(2025, 4, 1))] == [Decimal("0.14")]


def test_unknown_or_unset_province_and_dates_before_the_table_charge_nothing() -> None:
    assert rates_on(None, TODAY) == []
    assert rates_on("ZZ", TODAY) == []
    assert rates_on("BC", date(2007, 12, 31)) == []


async def test_date_of_supply_is_the_business_calendar_date(db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(province="NS", timezone="America/Halifax")
    )
    late_march = datetime(2025, 4, 1, 2, 30, tzinfo=UTC)  # still March 31 in Halifax
    assert await supply_date(db, BIZ, late_march) == date(2025, 3, 31)
    assert [r.rate_bps for r in await rates_for_business(db, BIZ, late_march)] == [1500]
    april = datetime(2025, 4, 1, 4, 0, tzinfo=UTC)
    assert [r.rate_bps for r in await rates_for_business(db, BIZ, april)] == [1400]
