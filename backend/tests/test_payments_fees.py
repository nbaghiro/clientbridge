import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.ids import new_id
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.services.payments import FeeMethod, application_fee_cents
from tests.conftest import FakePaymentGateway
from tests.helpers import card_pay, client_id, enable_payments, provider_ref, sent_invoice

BIZ = "bz_birchbark"
LATTE = {"description": "Latte", "quantity": 2, "unit_amount_cents": 500}


@pytest.mark.parametrize(
    ("method", "fee"),
    [("card", 30), ("card_present", 50), ("acss_debit", 200)],
)
def test_each_method_keeps_the_total_within_the_ceiling(method: FeeMethod, fee: int) -> None:
    assert application_fee_cents(10_000, method, converted=False) == fee


@pytest.mark.parametrize("method", ["card", "card_present"])
def test_a_converted_card_charge_carries_no_fee_of_ours(method: FeeMethod) -> None:
    assert application_fee_cents(10_000, method, converted=True) == 0


def test_a_converted_debit_keeps_what_is_left_under_the_ceiling() -> None:
    assert application_fee_cents(10_000, "acss_debit", converted=True) == 20


def test_the_fee_is_clamped_to_the_maximum_and_never_negative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "platform_fee_max_bps", 150)
    assert application_fee_cents(10_000, "acss_debit", converted=False) == 150
    monkeypatch.setattr(settings, "platform_fee_ceiling_bps", 250)
    assert application_fee_cents(10_000, "card", converted=False) == 0


async def _saved(db: AsyncSession, cid: str, ref: str, method: str) -> str:
    pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=BIZ,
        client_id=cid,
        method=method,
        provider_ref=ref,
        mandate_status="active" if method == "bank_eft" else "none",
    )
    db.add(pm)
    await db.flush()
    return pm.id


async def _charge_saved(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, method_id: str
) -> int:
    cid = await db.execute(select(PaymentMethod.client_id).where(PaymentMethod.id == method_id))
    inv = await sent_invoice(db, client=cid.scalar_one(), total=10_000)
    body = {"method": "card", "amount_cents": 10_000, "payment_method_id": method_id}
    res = await api.post(f"/v1/invoices/{inv}/payments", json=body)
    assert res.status_code == 201, res.text
    ref = await provider_ref(db, res.json()["payment_id"])
    return gateway.charges[ref][1]


@pytest.mark.parametrize(
    ("ref", "method", "fee"), [("pm_saved", "card", 30), ("pm_pad", "bank_eft", 200)]
)
async def test_a_saved_method_is_charged_its_own_fee(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    ref: str,
    method: str,
    fee: int,
) -> None:
    await enable_payments(db)
    method_id = await _saved(db, await client_id(db), ref, method)
    assert await _charge_saved(as_owner, db, gateway, method_id) == fee


async def test_a_new_card_on_the_pay_link_takes_the_domestic_card_fee(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    inv = await sent_invoice(db, total=10_000)
    ref = await provider_ref(db, await card_pay(as_owner, db, inv))
    assert gateway.charges[ref] == (10_000, 30)


async def test_tap_to_pay_takes_the_card_present_fee(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    checkout = await as_owner.post(f"/v1/orders/{order['id']}/checkout")
    assert checkout.status_code == 200, checkout.text
    payment = await db.get(Payment, checkout.json()["payment_id"])
    assert payment is not None and payment.provider_ref is not None
    amount, fee = gateway.charges[payment.provider_ref]
    assert fee == amount * 50 // 10_000


async def test_every_saved_card_takes_the_domestic_card_fee_without_asking_stripe(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def abroad(*args: object, **kwargs: object) -> str:
        return "US"

    monkeypatch.setattr(gateway, "get_card_country", abroad, raising=False)
    await enable_payments(db)
    method_id = await _saved(db, await client_id(db), "pm_abroad", "card")
    assert await _charge_saved(as_owner, db, gateway, method_id) == 30
