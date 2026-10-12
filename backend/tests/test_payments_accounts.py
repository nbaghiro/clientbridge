from scripts.payment_accounts import audit_account, plan_account


def _account(merchant: dict[str, object], **top: object) -> dict[str, object]:
    return {"configuration": {"merchant": merchant}, **top}


def test_missing_account_fields() -> None:
    plan = plan_account(
        {}, name="Birch & Bark", email="help@example.com", url="https://example.com"
    )
    assert plan["display_name"] == "Birch & Bark"
    assert plan["defaults"] == {"profile": {"business_url": "https://example.com"}}
    assert plan["configuration"] == {
        "merchant": {
            "support": {"email": "help@example.com"},
            "statement_descriptor": {"descriptor": "BIRCH & BARK", "prefix": "BIRCH & BA"},
        }
    }


def test_custom_prefix_survives_missing_full_descriptor() -> None:
    current = _account({"statement_descriptor": {"prefix": "MY SHOP"}})
    plan = plan_account(current, name="New Name", email=None, url="https://example.com")
    assert plan["configuration"]["merchant"]["statement_descriptor"] == {
        "descriptor": "NEW NAME",
        "prefix": "MY SHOP",
    }


def test_profile_changes_preserve_custom_descriptors() -> None:
    descriptors = {"descriptor": "CUSTOM SHOP", "prefix": "CUSTOM"}
    current = _account({"statement_descriptor": descriptors})
    plan = plan_account(current, name="Other Name", email=None, url="https://example.com")
    assert plan["configuration"]["merchant"]["statement_descriptor"] == descriptors


def test_complete_account_is_noop_and_email_is_not_overwritten() -> None:
    current = _account(
        {
            "support": {"email": "old@example.com"},
            "statement_descriptor": {"descriptor": "CUSTOM SHOP", "prefix": "CUSTOM"},
        },
        display_name="Custom",
        defaults={"profile": {"business_url": "old"}},
        contact_email="account@example.com",
    )
    plan = plan_account(current, name="Other Name", email="new@example.com", url="new")
    assert plan == {}
    report = audit_account(current, plan)
    assert report["account_email_present"] is True
    assert report["profile_present"] == {
        "display_name": True,
        "support_email": True,
        "business_url": True,
    }
    assert "account@example.com" not in str(report)


def test_invalid_descriptor_is_not_sent() -> None:
    plan = plan_account({}, name="1234", email=None, url="https://example.com")
    assert "configuration" not in plan


def test_missing_prefix_uses_existing_custom_descriptor() -> None:
    current = _account(
        {
            "support": {"email": "a@example.com"},
            "statement_descriptor": {"descriptor": "MY CUSTOM STORE"},
        },
        display_name="Custom",
        defaults={"profile": {"business_url": "old"}},
    )
    plan = plan_account(current, name="Different Name", email=None, url="new")
    assert set(plan) == {"configuration"}
    assert plan["configuration"]["merchant"]["statement_descriptor"] == {
        "descriptor": "MY CUSTOM STORE",
        "prefix": "MY CUSTOM",
    }


def test_numeric_prefix_is_not_generated() -> None:
    plan = plan_account({}, name="12345678901 Shop", email=None, url="new")
    assert plan["configuration"]["merchant"]["statement_descriptor"] == {
        "descriptor": "12345678901 SHOP"
    }
