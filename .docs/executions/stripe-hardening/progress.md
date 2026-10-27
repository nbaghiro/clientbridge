# Stripe hardening progress

## Baseline

- Date: 2026-10-26.
- Base: `origin/main` at `a9366132`.
- Branch `fix/stripe-hardening`, worktree `/Users/naib/Documents/code/clientbridge-stripe`.
- Schema: S1 (`transit` and `loss` account categories) approved on 2026-10-26 ([schema.md](schema.md)).
- Decisions: all twelve decided on 2026-10-26; Q4 and Q6 to Q11 took the defaults ([plan](plan.md#decisions)).
- Harness: `uv run python -m scripts.fresh_database pytest ...` runs in the worktree against the shared Postgres and auth (40 refund and drift tests passed at the base).

## Done

### Schema

- **S1.** `transit` and `loss` added to `AccountCategory`; migration `cb0033` (`20261026_000000_transit_and_loss.py`) widens `ck_accounts_category`, and its downgrade refuses while either category has an account. `tests/test_ledger_migration.py` covers both directions.

### Alerts, configuration and currency

- **A1.** The ledger-drift log metric now filters on `clientbridge.services.payments`. The infra test finds the module that logs `ledger drift` in `backend/src` and asserts the filter names it.
- **A2.** `providers_init.stripe()` skips prod entirely and reports the live Dashboard steps; tests for prod and staging.
- **A3.** `api/webhooks.py` logs signature and version rejections at ERROR, and a `webhook-rejections` log metric alerts on them.
- **A4.** `core/config.py` requires a live Stripe key in prod and refuses one elsewhere.
- **B1, B2.** `ledger.SUPPORTED_CURRENCIES` (CAD) and `ledger.supported()` gate journals, item create and update (422 `unsupported_currency`), sale creation and every charge builder through `charge_fee_cents` and the Terminal fee. Hard-coded `"CAD"` in services now reads `BUSINESS_CURRENCY`.

### Refunds and disputes

- **C1, C2.** `ledger._unwind` caps the unwind at what the sale still carries and caps gift card and package legs at what they still hold; the rest posts to `loss`. A $112 invoice refunded then lost ends with revenue and tax at 0 and $112 in `loss`; a $50 card with $30 used loses $30.
- **C3, C4.** `_give_back` in payments runs the deposit steps (take back forfeit and applications, then mark refunded) for refunds and lost disputes alike. Forfeit reversals are keyed by the refund or dispute, so a refund that fails later forfeits the deposit again (`restore_forfeit`), and a later refund can take it back once more. Re-applying a deposit to an invoice after a failed refund is not covered: the deposit stays held and the invoice reopened.
- **C5.** Refunds of a payment with an open or lost dispute answer 409 `payment_disputed`, and the preview reports it as blocked.
- **C6.** The refund service requires the idempotency key, which the route already demanded; the attempts-count fallback is gone.
- **C7.** A `warning_needs_response` inquiry alerts staff once (`dispute.inquiry_push`) and books nothing.
- **C8.** `refund.failed` is subscribed and handled like `refund.updated`.
- **C9.** The income report counts lost-dispute reversals with refunds instead of lowering sales.
- **C10 deferred.** A proportional commission cut on partial refunds needs earnings to carry a net amount through approval, payment and the app-core earnings SQL. Left for its own slice.

### Charges

- **D1.** Completing a visit cancels its unpaid deposit intent, and a deposit that settles after the visit finished without it is refunded, as after a cancel.
- **D2.** Superseding an invoice payment cancels declined attempts as well as pending ones.
- **D7.** `core/errors.stripe_error_handler` maps Stripe errors to stable codes (`payment_disputed`, `amount_too_small`, `idempotency_mismatch`, `card_declined`, otherwise 502 `payment_provider_error`) with catalog copy in app-core.

### Reconciliation and KYC

- **H7.** `GET /admin/v1/businesses/{id}/drift` lists the latest finding per source, without resolved ones; acknowledge refuses superseded (`finding_superseded`) and resolved (`finding_resolved`) findings. The admin business page has a drift panel.
- **J1.** `derive_kyc_status` adds `payouts_paused` (charges on, payouts off or something past due); `restricted` now means cards are off, with its own copy; the finish action shows whenever anything is due. A past deadline uses the no-date wording.
- **J3.** Requirement error codes are mirrored into `stripe_requirements` and shown under each requirement through `gettingPaid.reqError.*` copy with a fallback.

### Charges, fees and Customers (continued)

- **A5.** Wallet domain registration runs after the onboarding session is issued and committed, outside the business lock, and a failure is logged instead of blocking onboarding.
- **A6 dropped.** Stripe network retries stay at 0: product-hardening M4 made Stripe calls one bounded 10-second attempt because they run under row and advisory locks.
- **D3.** `POST /v1/orders/{id}/checkout/cancel` cancels a desk sale's open card or Terminal intents (409 `checkout_paid` once it went through); a tip change supersedes the open intent. The pay sheets and the mobile reader have a cancel action.
- **D4.** Subscription creates key on the command's idempotency key; the no-show charge keys on the card, so a new default card after a decline is a new charge.
- **D5.** `run_cancel_stale_intents` (hourly at :45) cancels staff-opened desk, gift card and package intents older than a day, in batches of 200.
- **D6.** `charge_method` labels a saved bank account's debit `bank_eft`, in the invoice, deposit, entitlement and sale builders.
- **D8.** Card setup and PAD links need card payments on. Staff may charge saved cards at the desk and lapsed businesses may collect deposits from manage links (Q8, Q9), unchanged.
- **D9.** Terminal connection tokens are scoped to the business's Location, and the old Location is deleted after an address change.
- **E1.** A test pins the platform fee on a tipped sale (fees apply to every transaction, Q1).
- **E2.** Memberships pass `application_fee_percent` at the one-off rate for their payment method (0.3% card, 2% PAD at current settings), and renewals book the fee Stripe actually took.
- **E3.** Refunds we start for an expired or out-of-stock online order return the platform fee, and `ledger.post_fee_return` books it.
- **E4.** A client name or email edit updates the Stripe Customer after the edit commits, best effort; the next edit retries a miss.

### Memberships and plans

- **F1.** Memberships carry `business_id`, `client_id` and `tax_class` metadata; an event for a membership we haven't recorded yet retries when that metadata names one of our businesses on the same account.
- **F2.** `incomplete_expired` maps to `canceled`.
- **F3.** The past-due notice is scoped by the failing invoice.
- **F4.** Lapsed businesses can cancel memberships, and the owner is emailed once when the plan lapses with live memberships.
- **F5.** Each renewal backs tax out using the rates and registration at the period start (the current registration; there is no registration history).
- **F6.** Archiving a client cancels their memberships at period end; a lost membership dispute cancels now.
- **F7.** The item editor says current members keep their price.
- **F8.** A paid invoice with no InvoicePayment is audited once as paid outside Stripe; renewal amounts come from the InvoicePayment.
- **G6.** An event for an ended, non-current plan subscription no longer repoints the business.
- **G7.** A paying plan subscription whose created event was missed is adopted at Checkout, on `GET /v1/plan` and before the portal.

### Webhooks and KYC

- **G1.** Version-rejected and deferred events keep a `failed` webhook row with their payload.
- **G2.** `run_replay_missed_events` (hourly at :27) lists `delivery_success=false` events for the platform and each connected account (100 per account, 500 per run, last 7 days), re-fetches each object at the pinned version, maps it to the event its current state stands for and applies it through the normal handlers once.
- **G3.** Notices about events more than a day old are not sent from the webhook path either; gift card issuance still is.
- **G4.** A retried `failed` webhook row is locked before it is applied.
- **G5 dropped.** Connect events always carry an account and the platform endpoint subscribes only plan events.
- **J2.** `POST /v1/connect/refresh` reads the account from Stripe (six per minute per business); Getting paid's Refresh and onboarding exit use it.
- **J4.** A closed account that can no longer be read is marked disabled from the event itself.
- **J6.** Tests cover an admin opening every Stripe component and the payouts list, a lapsed business finishing payment setup, and refresh.

### Reconciliation and payouts

- **I1.** `payout.created` books `transit + / stripe −`; `payout.paid` books `bank + / transit −` at the arrival date (`ledger.arrive_payout`); a failure reverses whichever journals exist, dated at the failure (H5). Reports and the Deposited figure already read only `bank` legs, so an in-transit payout no longer counts as deposited. The demo finance seed arrives its payouts.
- **I2.** A malformed payout id answers 404 without calling Stripe; other provider errors answer 502 through the shared handler.
- **H1.** Reconciliation is hourly at :45. Each business stores a `ledger.reconciled` audit cursor; a run reads from the cursor less a day, plus the full history of any source with an open finding, re-reads a windowed source in full before calling it drift, takes the least recently reconciled businesses first and stops starting new ones after ten minutes.
- **H2.** A `retry_later` source becomes a finding once its first transaction is a day old.
- **H3, H4.** The balance finding stores only the residual; failed sources are deduplicated in the same lineage as drift findings and count toward what explains the balance. The admin drift list includes failed sources.
- **H6.** Every finding lookup filters `entity_type` for `ix_audit_entity`.
- **H8.** Orphan journals (`orphan:` refs) are left out of the dashboard's revenue; the business keeps the Stripe fee (Q11).
- **H9.** Refund and settlement lookups are scoped to the event account's business; an account that matches no business is ignored. Events with no account still match by Stripe id, which only test fixtures send.
- **B3.** A refused non-CAD payout or payment is audited once; payout contents list CAD transactions only.

### Fixes from the documentation cross-check

- **J4.** Reconciliation and replay skip an account whose mirrored `disabled_reason` is `closed`.
- **G2.** Thin v2 account events can't be listed again, so each replay run also re-reads every merchant account that isn't fully enabled.
- **E3.** The fee return is booked when the refund succeeds, also through a later `refund.updated`, reversed if the refund fails, and counted with the refund when reconciling it.
- **H.** `ledger.cache_drift` and `ledger.reconciliation_failed` alert on a change or once a day rather than every hour, and the cursor audit is written only when it moves.
- **H7.** The admin drift list reports the balance finding's residual (`residual_cents`).
- **G1 scope.** Deferred and version-rejected events keep a failed row; the existing `webhook-failures` (5xx, including deferrals) and `webhook-rejections` alerts cover them, so no separate audit was added.
- **Not built:** the proportional commission cut (C10), reapplying a deposit to an invoice after a failed refund, and registration history for renewal tax (F5 uses the current registration).

## Gate, 2026-10-26

On the uncommitted worktree, after all of the above:

- `make test-backend`: 2,830 passed, 54 deselected, 93.51% branch coverage (final run, after the cross-check fixes).
- `make test-frontend`: 615 app-core tests in each of Vancouver, Halifax and Tokyo, plus every other package.
- `make format-check`, `lint-backend`, `lint-frontend`, `lint-infra`, `test-infra` (113): pass.
- Generators: running every `gen-*` target twice leaves the generated files unchanged.
- `make test-contract` against stripe-mock: 38 passed, including the new `update_customer` and `undelivered_events` calls.
- Not run: the Stripe sandbox checks and the Stripe browser lane.

## Sandbox checks

None run yet.
