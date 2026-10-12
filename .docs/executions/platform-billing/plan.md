# Platform billing plan

Status: accepted with the decisions below; the schema change in section 1 still needs its own explicit approval. The non-schema parts (the KYC fix and account reuse, the platform billing adapter, `stripe_setup.py`, the site pricing page and the docs) are implemented. Nothing in `models/`, `migrations/` or the Stripe sandbox has changed. This plan covers Clientbridge charging businesses for the app: Premium ($49.99 a month or $499.90 a year, owner only, $10 a month per staff seat) and Team ($99.99 a month or $999.90 a year, unlimited staff up to an internal cap), with a 14-day trial that needs no card.

Sources (read with `stripe docs`, CLI 1.53.1): [charge SaaS fees to connected accounts](https://docs.stripe.com/connect/integrate-billing-connect), [SaaS platform billing with Accounts v2](https://docs.stripe.com/connect/accounts-v2/saas-platform-payments-billing), [customer_account in v1 APIs](https://docs.stripe.com/changelog/clover/2025-12-15/accounts-v2-v1-api-support), [mixed interval subscriptions](https://docs.stripe.com/changelog/basil/2025-07-30/support-mixed-intervals), and the API reference for `POST /v1/checkout/sessions`, `POST /v1/billing_portal/sessions` and `POST /v1/subscriptions`.

## Stripe model

The business's Accounts v2 account is the billing customer. An account gets the `customer` configuration next to its `merchant` configuration, and since `2025-12-15.clover` the v1 Billing APIs take `customer_account=acct_...` in place of `customer`: Subscriptions, Checkout Sessions, Billing Portal Sessions, Invoices, SetupIntents and PaymentMethods. At our pin (`2026-09-30.endive`) this is GA; the guide's examples still send preview versions, so the e2e tier confirms each call at endive. Subscription objects and their events then carry `customer_account`, which resolves the business through the existing unique `ix_businesses_stripe_account`.

Platform subscriptions live on the platform account, so their events do not reach the Connect endpoint (`connect=true`). They need a second v1 webhook endpoint at the platform scope, pinned to the same API version, with its own signing secret.

A business may have no Stripe account when it subscribes (payments not set up yet). Checkout then creates the account with only the `customer` configuration, and `start_onboarding` and `account_session` later add the `merchant` configuration to that account (with the same responsibilities, `dashboard=none` and capabilities as today) instead of creating a second one. The KYC derivation must treat an account without the merchant configuration as `not_started`: today `derive_kyc_status` would read it as `pending`, because no terms entry is open.

The trial is app-side. No Stripe object exists during it, so signup makes no Stripe call and needs no card. A Stripe subscription is created only through Checkout, and when the owner subscribes during the trial the remaining trial days carry over through `subscription_data.trial_end` (Checkout requires it at least 48 hours ahead; with less left, billing starts immediately).

Platform billing is not business money, so it posts nothing to the ledger. Stripe's invoices are the record.

## 1. Schema change (needs approval)

Four columns on `businesses` (one row per business, so no new table), in one increment `backend/migrations/versions/20261012_000100_plans.py`:

| Column | Type | Constraint | Purpose |
|---|---|---|---|
| `plan` | `text NULL` | `ck_businesses_plan`: `plan IS NULL OR plan IN ('premium','team')` (`PlanTier`, `enum_check(..., nullable=True)`) | The subscribed tier, read from the subscription's price lookup key. NULL while trialing or after the plan lapses. |
| `plan_status` | `text NOT NULL DEFAULT 'trialing'` | `ck_businesses_plan_status`: `IN ('trialing','active','past_due','lapsed')` (`PlanStatus`) | The gating state. Stripe `active` and `trialing` map to `active`, `past_due` to `past_due`, and `unpaid`, `canceled`, `paused` and `incomplete_expired` to `lapsed`; `incomplete` leaves the row unchanged. |
| `trial_ends_at` | `timestamptz NOT NULL` | none | Set by onboarding to now plus 14 days (`PLAN_TRIAL_DAYS`). A `trialing` business past this time is lapsed; that is derived at read time, so no job flips it. |
| `stripe_subscription_id` | `text NULL` | none | The current platform subscription. An event for any other subscription id is ignored, and portal and plan changes act on this one. |

No new index: webhooks resolve the business by `customer_account` through `ix_businesses_stripe_account`. A business with `plan_status='active'` and no `stripe_subscription_id` is complimentary (demo and internal businesses); the portal and plan change answer `plan_not_managed` for it.

Sync: `business_full` (owner and admin) gains `plan`, `plan_status` and `trial_ends_at`; `staff_limited` gains `plan_status` and `trial_ends_at` so a staff device can show that the business is paused. `stripe_subscription_id` stays server-only. Update `tests/fixtures/sync_projections.json`, then `make gen-sync-schema`. Billing details (interval, renewal date, seat quantity, cancel at period end) are not mirrored; the owner's plan page reads them live from Stripe.

Data impact: the migration backfills existing rows with `plan_status='trialing'`, `plan=NULL`, `stripe_subscription_id=NULL` and `trial_ends_at = greatest(created_at, now()) + interval '14 days'`, so no existing local business lapses on upgrade. The seed sets the demo businesses (`bz_birchbark`, `bz_demo_second`) to `plan='team'`, `plan_status='active'` and no subscription id (complimentary), so the demo is never gated. No other table changes and no rows are deleted.

Rollback: the downgrade drops the two CHECK constraints and the four columns. The plan state is lost but can be rebuilt from Stripe by refetching each subscription. Stripe subscriptions created meanwhile keep billing until cancelled in Stripe.

## 2. Surfaces

Command/RPC (FastAPI `POST`, `api/plans.py` over `services/plans.py`, owner only):

- `GET /v1/plan`: live read of the current subscription (tier, interval, seat quantity and amount, current period end, cancel at period end) through the gateway; the trial state when there is none. Online only.
- `POST /v1/plan/checkout` `{plan, interval}`: ensures the account and its customer configuration, then creates a hosted Checkout Session (`mode=subscription`, `customer_account`, the plan price, `subscription_data.billing_mode.type=flexible`, `subscription_data.trial_end` when at least 48 hours of trial remain, `automatic_tax.enabled=true`, `metadata.business_id`, success and cancel URLs at `/setup/plan`). Returns the URL. 409 `plan_active` when the business is `active` or `past_due` with a subscription. Audited; the URL is not stored in command responses, like Account Sessions.
- `POST /v1/plan/change` `{plan, interval}`: swaps the plan item's price and adds or removes the seat item, with `proration_behavior=create_prorations`, through `run_command` with a Stripe idempotency key derived from the command key. 409 `plan_not_managed` without a subscription.
- `POST /v1/plan/portal`: a Billing Portal Session (`customer_account`, our portal configuration, return URL `/setup/plan`) for the payment method, invoices, billing address and cancellation. Plan switching is off in the portal because it cannot manage the seat item. 409 `plan_not_managed` without a subscription.

Hosted Checkout and the hosted portal instead of embedded Checkout: no new shared component or Stripe.js work, and the same redirect works from any web page.

Webhook (`/webhooks/stripe`, unchanged route): the platform endpoint sends `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. `verify_webhook` picks the secret by shape: a thin event uses `STRIPE_THIN_WEBHOOK_SECRET`, a snapshot event with `account` uses `STRIPE_WEBHOOK_SECRET`, and one without uses the new `STRIPE_PLATFORM_WEBHOOK_SECRET`. `_dispatch` sends `customer.subscription.*` with `event.account is None` to `plans.apply_subscription_event`; with an account they stay client memberships as today. The handler resolves the business by `customer_account` (and checks `metadata.business_id`), then fetches the subscription from Stripe and mirrors that, so out-of-order deliveries cannot regress the state. On `created` it adopts the subscription unless the business already has a different live one (logged, not adopted), then reconciles the seat item. Dedupe stays on the `webhooks` table. Payment-failure and renewal emails come from Stripe Billing's own emails (a Dashboard step), so no new notifier outcome.

Jobs (bodies in `services/plans.py`, schedule in `tasks/worker.py`):

- `run_sync_seats` (daily): sets the seat quantity of every Premium subscription to the current seat count. It catches invites that expired (7-day `INVITE_TTL`) and any decrease whose Stripe call failed.
- `run_trial_reminders` (hourly, through `businesses_at_hour` at 9:00 local): emails the owner 3 days before the trial ends and on the day it lapses, matched by local date so it needs no stored flag. New backend messages in `en_CA.po`.

## 3. Gating

`services/plans.py` owns one derivation, `plan_access(business, now)`: `trial` (trialing, before `trial_ends_at`), `active`, `past_due` (full access, with a notice) or `lapsed` (trialing past its end, or `lapsed`). App-core mirrors it as `planAccess` over the synced columns.

Seats: a seat is a non-owner staff row that is `active`, or `invited` with an unexpired invite. Limits: trial and Team allow up to `PLAN_SEAT_CAP` (50); Premium has no cap and bills each seat.

- `StaffService.create_invite` and `resend_invite`: `lapsed` answers 402 `plan_required`; reaching the cap answers 409 `seat_limit`. On Premium the command sets the seat quantity in Stripe (absolute, so a retry is safe) before commit, so a failed Stripe call fails the invite and no unpaid seat exists.
- `StaffService.accept_invite`: rechecks `plan_required` and the cap, since the plan may have changed since the invite.
- `StaffService.remove`, `revoke_invite`: never gated; after commit they lower the seat quantity on Premium, best effort, with `run_sync_seats` as the backstop.
- `PlanService.change` to Premium keeps every member and adds the seat item at the current count.

Lapsed (the trial ended without a subscription, or Stripe ended or stopped the subscription): the business keeps all data and can sign in and read. Writes answer 402 `plan_required`, except the plan endpoints, auth, staff removal and data export. The gate is a dependency on the authenticated `/v1` router for unsafe methods, with those routes exempted, and services reached outside it check `plans.assert_writable` themselves: public booking, shop and estimate acceptance answer 409 `business_unavailable`. Paying an existing invoice and every webhook keep working, since that money is owed to the business. Outbound client jobs (reminders, broadcasts, review requests, intake forms) skip lapsed businesses. Offline outbox commands that come back `plan_required` are rejected terminally on the device, not retried.

New error codes, each with an `api.*` catalog message in app-core `FAILURES`: `plan_required` (402), `seat_limit` (409), `plan_active` (409), `plan_not_managed` (409), `business_unavailable` (409).

## 4. stripe_setup.py and docs

`stripe_setup.py`:

- Prices come from one table, `PLAN_PRICES` in `services/plans.py`, in CAD and tax-exclusive: `premium_month` 4999, `premium_year` 49990, `team_month` 9999, `team_year` 99990, `seat_month` 1000. Products are created with fixed ids (`clientbridge_premium`, `clientbridge_team`, `clientbridge_seat`), so finding them is a retrieve. Each price is found by `lookup_keys[]` and kept when amount, currency and interval match; otherwise a new price is created with `transfer_lookup_key=true`, so existing subscriptions keep their price and the key moves. Rerunning is a no-op.
- A Billing Portal configuration found by `metadata.clientbridge=portal`: payment method update, invoice history, customer update (email, address), cancellation at period end, no subscription update; default return URL `/setup/plan`. It prints `STRIPE_PORTAL_CONFIGURATION`.
- A platform webhook endpoint (`connect=false`, at the pin, `metadata.clientbridge=platform_webhook`) for the three subscription events, with the same blocked and update rules as `plan_webhook`. It prints `STRIPE_PLATFORM_WEBHOOK_SECRET`.
- `listen_args`: the snapshot listener forwards with both `--forward-to` and `--forward-connect-to` and adds the platform events, so locally all three settings take the `stripe listen` secret.
- Remove the "platform products and prices: none needed" line. Dashboard steps gain: Billing customer emails (receipts, failed payments, upcoming renewals), Smart Retries with the subscription cancelled after the last retry, and the platform's Stripe Tax settings (head office address and GST/HST and QST registrations).
- The backend reads prices by lookup key (cached per process) and fails with `payments_not_configured` if one is missing.

Settings: `STRIPE_PLATFORM_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION`, `PLAN_TRIAL_DAYS=14`, `PLAN_SEAT_CAP=50`; production config validation requires the first two.

Gateway (`PaymentGateway` protocol, `StripeGateway`, `FakePaymentGateway`): `create_connected_account` takes the configurations to apply; new `add_merchant_configuration`, `add_customer_configuration`, `create_plan_checkout`, `create_portal_session`, `get_plan_subscription`, `set_plan_items` (plan price and seat quantity).

Docs: `architecture.md` gains a "Platform billing" subsection under Payments (customer configuration, the three-secret routing, trial and gating, no ledger), the new columns in the sync stream list, and "billing" in the owner role row now meaning the plan endpoints. `engineering.md` replaces "Platform prices are not needed" in the setup section with the products, lookup keys, portal configuration and platform endpoint, and adds the plan flows to the e2e tier. `launch-readiness.md` records the remaining live-mode steps. Add this execution to `.docs/executions/README.md`.

## 5. Frontend and tests

App-core: `domain/plans.ts` (`planAccess`, `usePlan` over `GET /v1/plan`, `usePlanActions` for checkout, change and portal, seat cost for the invite confirm), `strings.plans`, the five failure codes, and plan prices served by `GET /v1/plan` so the apps hold no amounts. `make gen-api`, `make gen-strings`.

Web: a `Plans.tsx` page at `/setup/plan` (nav label "Plan", mapped to `plans` in `check-structure.mjs` `PAGE_CONCEPT`) with the trial countdown, the two tiers, monthly or yearly, and portal and change actions. A shell notice for `past_due` and `lapsed`, and for a trial in its last 3 days (owner only). The Team page's invite confirm shows the added seat cost on Premium and the cap message on `seat_limit`.

Mobile: a read-only plan section in settings and the same paused and past-due notices. No purchase button and no link to buy on the web, to stay inside App Store guideline 3.1.3(f) for companion apps.

Site: the pricing page shows two plans instead of one, with monthly and yearly prices, the seat price on Premium, "14-day free trial, no card needed" and the trial FAQ answer updated. Amounts are cents in `apps/site/src/content/plans.ts` formatted through the site formatter, and the placeholder notes are removed. The home pricing section changes from "One plan" to the two tiers. `make gen-strings`, `make test-site`.

Backend tests (`test_plans.py`, `test_plans_seats.py`, plus `test_sync_projections`, `test_integrity` and the setup script tests):

- Happy: checkout for each tier and interval; trial carryover with at least 48 hours left and none below; `created`, `updated` (past_due) and `deleted` events; plan change both ways with the seat item; portal URL; trial access; a complimentary business is never gated.
- Each 4xx: admin and staff get 403 on every plan endpoint; `plan_active`; `plan_not_managed` for portal and change; invalid tier or interval 422; `plan_required` on a lapsed write and on invite; `seat_limit` at the cap on trial and Team; `business_unavailable` on a public booking.
- Security: an event whose `customer_account` matches no business, or whose metadata names another business, changes nothing; a platform-shaped event signed with the Connect secret is rejected; a connected-account `customer.subscription.updated` never touches plan columns and a platform one never touches client subscriptions; staff sync never carries `stripe_subscription_id`; `GET /v1/plan` is tenant-scoped.
- Idempotency and edge: a repeated event is deduped; out-of-order events end at the fetched state; a checkout and a change replay with the same key; a seat update retry sets the same quantity; an expired invite drops out at `run_sync_seats`; a second live subscription is not adopted; a customer-only account reads `not_started` and `start_onboarding` adds the merchant configuration to it; lapsed outbound jobs send nothing; invoice payment and webhooks still work while lapsed.
- Contract tier (stripe-mock): Checkout Session, Portal Session and subscription update shapes. The account configuration updates are v2, so the fake and the e2e tier cover them.
- E2E tier (Test Clock): Checkout with `customer_account` at endive, trial carryover, renewal, a failed payment through past_due to cancellation, and an annual plan with the monthly seat item in flexible billing mode.

Frontend tests: app-core `plans.test.ts` (`planAccess` at the trial edge, seat cost), the web page and notices under `en-XA`, and the site pricing values.

## 6. Decisions

Accepted with the plan:

- Yearly prices give two months free: Premium $499.90 a year and Team $999.90 a year. Monthly prices stay $49.99 and $99.99, and a Premium seat stays $10 a month.
- Clientbridge charges sales tax on its own plan fees through Stripe automatic tax, on plan Checkout only. The customer configuration requests `automatic_indirect_tax`, and the business address is set on the account as `identity.business_details.address` when the account has no identity address yet (a verified address is never overwritten). The businesses' own tax engine is unchanged.
- Lapsed scope as written in section 3: the business becomes read-only, invoice payments and webhooks keep working, public booking closes, and data is kept indefinitely after a lapse.
- Pending, unexpired invites count as billed Premium seats, so an invite cannot be used to get a free seat until acceptance.
