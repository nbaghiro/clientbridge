from scripts.payment_accounts import audit_account, plan_account


def test_missing_account_fields() -> None:
    plan = plan_account(
        {}, name="Birch & Bark", email="help@example.com", url="https://example.com"
    )
    assert plan["business_profile"] == {
        "name": "Birch & Bark",
        "support_email": "help@example.com",
        "url": "https://example.com",
    }
    assert plan["settings"] == {
        "payments": {"statement_descriptor": "BIRCH & BARK"},
        "card_payments": {"statement_descriptor_prefix": "BIRCH & BA"},
    }


def test_custom_prefix_survives_missing_full_descriptor() -> None:
    current = {"settings": {"card_payments": {"statement_descriptor_prefix": "MY SHOP"}}}
    plan = plan_account(current, name="New Name", email=None, url="https://example.com")
    assert plan["settings"]["card_payments"] == {"statement_descriptor_prefix": "MY SHOP"}
    assert plan["settings"]["payments"] == {"statement_descriptor": "NEW NAME"}


def test_profile_changes_preserve_custom_descriptors() -> None:
    current = {
        "settings": {
            "payments": {"statement_descriptor": "CUSTOM SHOP"},
            "card_payments": {"statement_descriptor_prefix": "CUSTOM"},
        }
    }
    plan = plan_account(current, name="Other Name", email=None, url="https://example.com")
    assert plan["settings"] == current["settings"]


def test_complete_account_is_noop_and_email_is_not_overwritten() -> None:
    current = {
        "business_profile": {"name": "Custom", "support_email": "old@example.com", "url": "old"},
        "settings": {
            "payments": {"statement_descriptor": "CUSTOM SHOP"},
            "card_payments": {"statement_descriptor_prefix": "CUSTOM"},
        },
        "email": "account@example.com",
    }
    plan = plan_account(current, name="Other Name", email="new@example.com", url="new")
    assert plan == {}
    report = audit_account(current, plan)
    assert report["account_email_present"] is True
    assert "account@example.com" not in str(report)


def test_invalid_descriptor_is_not_sent() -> None:
    plan = plan_account({}, name="1234", email=None, url="https://example.com")
    assert "settings" not in plan


def test_missing_prefix_uses_existing_custom_descriptor() -> None:
    current = {
        "business_profile": {"name": "Custom", "support_email": "a@example.com", "url": "old"},
        "settings": {"payments": {"statement_descriptor": "MY CUSTOM STORE"}},
    }
    plan = plan_account(current, name="Different Name", email=None, url="new")
    assert "business_profile" not in plan
    assert plan["settings"]["payments"] == {"statement_descriptor": "MY CUSTOM STORE"}
    assert plan["settings"]["card_payments"] == {"statement_descriptor_prefix": "MY CUSTOM"}


def test_numeric_prefix_is_not_generated() -> None:
    plan = plan_account({}, name="12345678901 Shop", email=None, url="new")
    assert "card_payments" not in plan["settings"]
