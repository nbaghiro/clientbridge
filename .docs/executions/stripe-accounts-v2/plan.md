# Stripe Accounts v2 plan

Status: in progress. The Clientbridge sandbox (`acct_1UPkgSFGqw7iO9oD`, Canada, test mode) rejects `POST /v1/accounts` with "Stripe no longer recommends Accounts v1 for new Connect integrations". This plan moves connected-account creation, status and onboarding to Accounts v2. It makes no schema change: `businesses.stripe_account_id` keeps the `acct_` id, and the KYC mirror keeps its columns and the keys of `stripe_requirements`.

Sources (read with `stripe docs`, CLI 1.53.1): [Accounts v2 overview](https://docs.stripe.com/connect/accounts-v2.md), [use v2 in an existing integration](https://docs.stripe.com/connect/accounts-v2/migrate-integration.md), [configure connected accounts](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md), [integration recommendations](https://docs.stripe.com/connect/integration-recommendations.md), [fee behaviour](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior.md), [hosted onboarding (v2)](https://docs.stripe.com/connect/hosted-onboarding.md?accounts-namespace=v2), [track onboarding (v2)](https://docs.stripe.com/connect/track-account-onboarding.md?dashboard-or-api=api&accounts-namespace=v2), [handle verification (v2)](https://docs.stripe.com/connect/handling-api-verification.md?accounts-namespace=v2), [testing (v2)](https://docs.stripe.com/connect/testing.md?accounts-namespace=v2), [how events work](https://docs.stripe.com/events/how-events-work.md), and the API reference for `POST /v2/core/accounts`, `POST /v2/core/account_links` and `v2.core.account[requirements].updated`.

## Call map

| Today (v1) | Accounts v2 |
|---|---|
| `POST /v1/accounts` with `type=custom`, `country=CA` | `POST /v2/core/accounts` with `identity.country=ca`, `dashboard=none`, `configuration.merchant`, `defaults`, `include=[configuration.merchant, requirements]` |
| `capabilities.card_payments`, `capabilities.transfers` | `configuration.merchant.capabilities.card_payments` and `link_payments`; `stripe_balance.payouts` comes with the merchant configuration; no recipient configuration |
| `POST /v1/accounts/{id}/capabilities/acss_debit_payments` | `POST /v2/core/accounts/{id}` with `configuration.merchant.capabilities.acss_debit_payments.requested=true`, then read its status |
| `business_profile.name`, `support_email`, `url` | `display_name`, `contact_email`, `configuration.merchant.support.email` and `.url`, `defaults.profile.business_url` |
| `settings.payments.statement_descriptor`, `settings.card_payments.statement_descriptor_prefix` | `configuration.merchant.statement_descriptor.descriptor` and `.prefix` |
| `settings.branding` | `configuration.merchant.branding` |
| `default_currency`, account locale | `defaults.currency=cad`, `defaults.locales=[en-CA]` |
| `GET /v1/accounts/{id}` | `GET /v2/core/accounts/{id}?include=configuration.merchant&include=requirements` |
| `POST /v1/account_links` | `POST /v2/core/account_links` with `use_case.type=account_onboarding` and `configurations=[merchant]` |
| `POST /v1/account_sessions` | unchanged; v1 endpoints accept v2 account ids and answer in the v1 shape |
| `account.updated`, `capability.updated` (Connect endpoint) | thin `v2.core.account[requirements].updated`, `v2.core.account[configuration.merchant].capability_status_updated`, `v2.core.account.closed` through an event destination; the handler fetches the account |

Payments on the connected account (PaymentIntents, refunds, customers, setup intents, mandates, prices, subscriptions, invoice payments, balance, payment methods, Terminal) keep their v1 calls with the `Stripe-Account` header. The migration guide states that `/v1` endpoints accept accounts created through `/v2/core/accounts`, and direct-charge events stay in the "Connected accounts" scope, so the Connect webhook endpoint keeps every payment event.

## Responsibilities and dashboard

We create accounts with `dashboard=none`, `fees_collector=stripe` and `losses_collector=stripe`. Stripe recommends Stripe loss liability for direct charges, and lists the embedded (no dashboard) setup as supported for direct charges. With `fees_collector=stripe`, Stripe takes its processing fee from the connected account and our `application_fee_amount` stays our fee alone, which is what `get_payment_fees` and the ledger's fee legs assume today. The other option, `fees_collector=application` with `losses_collector=application`, is the closest to today's Custom accounts in liability and lets the platform submit KYC and accept the terms itself, but the platform would then pay Stripe's processing fee on every direct charge and the application fee would have to include it, which changes the fee model and the ledger. Stripe does not allow `losses_collector=application` with `fees_collector=stripe`. Both values are fixed once the merchant configuration is added. This needs the user's confirmation before live accounts are created.

With `losses_collector=stripe`, `defaults.responsibilities.requirements_collector` is `stripe`. Stripe collects KYC through the embedded `account_onboarding` component (or the account link), the platform can prefill identity only before the first account link or session, and the terms of service cannot be accepted on the account's behalf (`tos_acceptance_on_behalf_not_allowed`). An account without a Stripe dashboard where Stripe owns losses must use embedded components for updates, which we already do; Stripe also recommends the `notification_banner` component, which we have not added.

## Status mapping

`ConnectAccount` keeps its fields and is read from the v2 account:

- `charges_enabled`: `configuration.merchant.capabilities.card_payments.status == active`.
- `payouts_enabled`: `configuration.merchant.capabilities.stripe_balance.payouts.status == active`.
- `currently_due`, `eventually_due`, `past_due`: the `description` of each `requirements.entries[]` item awaiting the user, grouped by `minimum_deadline.status`.
- `pending_verification`: entries awaiting Stripe.
- `current_deadline`: `requirements.summary.minimum_deadline.time` as a Unix time.
- `details_submitted`: v2 has no such field. The account counts as submitted once no entry for `identity.attestations.terms_of_service` is open, because accepting the service agreement is the last onboarding step.
- `disabled_reason`: `closed` for a closed account; otherwise the `card_payments` status detail code when the capability is unsupported or its resolution is `contact_stripe` or `no_resolution`. Any value means the business cannot fix it in the app, so `kyc_status` reports `disabled`.

The requirement codes the API returns change from v1 field names (`individual.id_number`) to v2 descriptions (`identity.individual.id_numbers`). The app maps them to the existing catalog messages by prefix, with the generic message as the fallback. The CA field names come from Stripe's requirements data for the Accounts v2 API.

## Events

v2 accounts send v1 snapshot events (connected-account scope) and v2 thin events (platform scope). We handle the thin account events and stop subscribing to `account.updated` and `capability.updated`. Thin events are unversioned, so the API version check applies only to snapshot events. The webhook route stays `/webhooks/stripe`: a body with `object=v2.core.event` is verified with `STRIPE_THIN_WEBHOOK_SECRET` (the event destination's secret), anything else with `STRIPE_WEBHOOK_SECRET` (the Connect endpoint's). Locally, `stripe listen --events` accepts thin event types and forwards both kinds with one secret, so both settings take the `stripe listen` secret. The sandbox renders snapshot events at `2026-09-30.endive`; the user accepted it for local webhooks through `STRIPE_WEBHOOK_API_VERSIONS=["2026-09-30.endive"]`. A read-only `GET /v2/core/accounts` at our pinned `2026-05-27.dahlia` succeeds, so the pin stays.

## Setup script and tests

`scripts/stripe_setup.py` creates each demo account through `POST /v2/core/accounts` (JSON body through the CLI), found by `metadata.clientbridge_demo`, with Stripe's v2 test identity (date of birth 1901-01-01, `address_full_match`, SIN 000000000) prefilled at creation. It cannot accept the terms or add the bank account, so it prints the remaining steps: finish embedded onboarding once per demo business in the web app (SMS code 000-000, test bank 11000-000 / 000123456789). With `--webhook-url` it also creates the thin event destination. `scripts/stripe_demo_account.py` (a second v1 account creator) is removed in favour of `make stripe-setup`.

stripe-mock has no `/v2` routes (`POST /v2/core/accounts` answers "Unrecognized request URL"), so v2 calls move from the contract tier to fake-based integration tests and the e2e tier against the sandbox.
