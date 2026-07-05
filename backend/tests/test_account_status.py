"""The KYC parser against a full, real-shaped Stripe Account object (the golden fixture).

`account_status_from` has to pick the right buckets out of an account payload that carries far more
than we read (capabilities, individual, future_requirements, tos_acceptance, …) — this pins that.
"""

import json
from pathlib import Path
from typing import cast

from clientbridge.integrations.payments import account_status_from
from clientbridge.services.business_service import derive_kyc_status

FIXTURES = Path(__file__).parent / "fixtures" / "stripe"


def _account_object(name: str) -> dict[str, object]:
    raw = json.loads((FIXTURES / name).read_text())
    return cast("dict[str, object]", raw["data"]["object"])


def test_parses_a_full_account_object() -> None:
    obj = _account_object("account_updated.json")
    status = account_status_from(str(obj["id"]), obj)
    assert status.id == "acct_1NG8Du2eZvKYlo2C"
    assert status.charges_enabled is False and status.payouts_enabled is False
    assert status.details_submitted is True
    assert status.currently_due == ["external_account", "individual.id_number"]
    assert status.past_due == ["external_account"]
    assert status.eventually_due == [
        "external_account",
        "individual.id_number",
        "tos_acceptance.date",
    ]
    assert status.disabled_reason == "requirements.past_due"


def test_derives_restricted_when_stripe_still_needs_things() -> None:
    status = account_status_from("acct_x", _account_object("account_updated.json"))
    # details submitted, but currently_due/past_due are non-empty → the provider must act
    assert derive_kyc_status(status) == "restricted"
