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
- **F5.** Each renewal backs tax out using the rates and registration at the period start (registration date from S3, below).
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
- **Not built here:** the proportional commission cut (C10), which moved to `staff-pay`. Deposit re-application and the registration date followed on 2026-10-27, below.

## Follow-ups, 2026-10-27

- **S3.** `businesses.tax_registered_on` (migration `cb0034`, [schema.md](schema.md)) records the day GST/HST registration took effect. `services/business.registered_on` decides registration on a business day, and `business_tax_registered` now takes the instant, so a renewal is split with the registration at its period start (F5). The Taxes settings on web and mobile show an optional Registered since date while registered, and device tax previews (`useTaxSetup`) apply the same rule. Remittances still read the current setting, since their periods and amounts come from the tax actually booked. Tests: `test_business_migration.py`, the registration helper and settings cases in `test_business.py`, the late renewal in `test_entitlements_subscriptions.py`, and the app-core hook tests.
- **Deposit after a failed refund.** `bookings.restore_deposit` puts a held deposit back on the booking's open invoice under an application keyed by the failed refund (`application:{booking}:{invoice}:again:{refund}`), and `ledger.applied_invoices`/`reverse_application` read every live application, so a later refund takes it off again. A re-forfeited deposit is marked `forfeited` instead of `refunded`. Tests: `test_a_failed_deposit_refund_goes_back_on_the_invoice`, `test_a_failed_deposit_refund_stays_held_once_the_invoice_is_void`, and the status check in `test_a_refund_that_fails_later_forfeits_the_deposit_again`.
- **Network retries (A6) closed by decision.** Calls stay one attempt; a retry with the same idempotency key reaches Stripe with the same key (`test_retrying_a_refund_after_a_network_error_reuses_the_stripe_key`). Recorded in `payments.md`.
- **Stale intents.** `run_cancel_stale_intents` logs and skips any error on one intent instead of failing the job (`test_a_network_error_on_one_intent_does_not_stop_the_run`).
- **C10 moved.** The proportional commission clawback is built on `staff-pay` (PR #61, CLI-44) as negative pending earnings, so it is not repeated here.
- **Sandbox checks (2026-10-27).** Run against the Clientbridge sandbox on Birchbark (`acct_1UPnLpFGqw5ObEW5`) at `2026-09-30.endive`. Summary below; the eight mismatches it found are fixed in the items that follow.

  | Check | Objects | Result |
  | --- | --- | --- |
  | 1. PAD refund | `pi_3UV9NTFGqw5ObEW50YLhtfF7`, `pyr_1UV9PsFGqw5ObEW53BnAYjve`, `txn_1UV9PsFGqw5ObEW5EbcPkT3K` | `pyr_` refund with a `payment_refund` transaction of -2000 that exists while the refund is pending; `Refund.retrieve` works. Matches, except M7. |
  | 2. Returned application fee | `ch_3UV9IiFGqw5ObEW51mmgt0DW`, `re_3UV9IiFGqw5ObEW51RFT36Ja`, `txn_1UV9JLFGqw5ObEW5BTlr9sd7` | The fee comes back as an `adjustment` (category `fee`, +120 of 300, pro rata) whose source is the charge; `?source=` returns neither it nor anything but the primary row. M1, M2. |
  | 3. Failed refund | `re_3UV9JpFGqw5ObEW50zW5eBu7`, `txn_1UV9M1FGqw5ObEW5vp32TGxa` | Reported only by `refund.failed`; the `refund_failure` (+2000, source the refund) is missing from `?source=`. M2. |
  | 4. Dispute after a partial refund | `du_1UV9LxFGqw5ObEW5pv72TyEY`, `re_3UV9LuFGqw5ObEW51NH84Cxf` | Not observed; an inquiry kept its full 6000 after a 1000 refund. Docs say a lost dispute can reinstate the refunded part. M4. |
  | 5. Refund during a dispute | `du_1UV9K5FGqw5ObEW5RLrvtdnC`, `txn_1UV9K5FGqw5ObEW5KT1VrtR1` | Refused with `charge_disputed` while disputed, allowed during an inquiry; dispute ids and the withdrawal's source are `du_`. M3. |
  | 6. Off-session PAD charge | `seti_1UV9N1FGqw5ObEW5kainZLyJ`, `mandate_1UV9N2FGqw5ObEW5wikXrsZS`, `pi_3UV9NTFGqw5ObEW50YLhtfF7` | Succeeds only with `allowed_payment_method_types=["acss_debit"]` and `mandate`; `default_for` with an interval schedule is refused at setup. M5, M6. |
  | 7. `delivery_success=false` | `evt_3UUs9SFGqw5ObEW50HeXW0Am` | Works on the platform and per account, 30 days back. Matches; the thin-event comment was wrong. |
  | 8. Closed v2 account | `acct_1UV9OGFGqwSdYFTi` | Retrievable with our includes, `closed: true`, configuration null; maps to `disabled_reason: closed`. Matches. |
  | 9. Bank change in account management | none | Docs only: Stripe's own sign-in gates it; whether only the representative can pass it needs a browser test. |
  | 10. Standalone `tax_fee` / `stripe_fee` | 18 connected accounts | None exist in the sandbox. M8 from the docs. |

- **M1, returned fee on the charge.** Reconciliation counts `fee_return:<refund>` (and `:failed`) for every refund of a payment under the charge's source instead of the refund's (`recover_stripe_source`). An orphan's returned fee posts as `orphan:<txn>` against the platform fee (`_orphan_transactions`, `ledger.post_orphan`). Tests: `test_a_returned_application_fee_reconciles_on_the_charge_it_came_from`; `test_orphan_charge_refund_and_returned_fee_reconcile_once` now uses Stripe's shape.
- **M2, whole source history.** `_source_history` reads the `source=` rows, then `refund_failure` and `adjustment` rows by type from the source's first `created` and keeps those with that source. The gateway's `balance_transactions` takes `kind` (Stripe's `type`), and the fake gateway's `source` filter now leaves out the same rows Stripe does. Used by the windowed refetch and for open findings. Tests: `test_a_refund_that_failed_reconciles_against_its_reversal`, the window part of the fee-return test, `test_lists_balance_transactions_by_type` (contract).
- **M3, `du_` disputes.** `DISPUTES = ("du_", "dp_")` routes both to the dispute branch, whose refs now read every `dispute:<id>` and `dispute_fee:<id>` journal. Fixtures in `test_payments_disputes.py` and `test_ledger_drift.py` use `du_`; `test_webhooks.py` keeps `dp_`. Test: `test_a_dispute_withdrawal_is_recovered_and_reconciled[du_recovered|dp_recovered]`.
- **M4, reinstated funds on a lost dispute.** The lost journal is unchanged (the overlap with a refund goes to `loss`); `ledger.reinstate_dispute` then books the dispute's positive balance transactions as `dispute:<id>:reinstated` (Stripe up, `loss` down, any returned fee off `processing_fee`), only the increase per event, so a later `charge.dispute.funds_reinstated` is booked too. Built from the documented `balance_transactions`, not observed. Test: `test_a_lost_dispute_that_reinstates_the_refunded_part_loses_only_the_rest`.
- **M5, PAD charges name the mandate.** `create_payment_intent` takes `mandate` and then sends `allowed_payment_method_types=["acss_debit"]` with it; `pad_mandate` finds the active mandate for a saved `bank_eft` method from the client's setup links and Stripe, and the four charge builders pass it. No active mandate answers 409. Tests: `test_a_saved_bank_account_is_charged_under_its_mandate`, `test_a_bank_account_whose_mandate_stripe_no_longer_holds_is_not_charged`, `test_charges_a_saved_bank_account_under_its_mandate` (contract). The PAD cases in `test_payments_fees.py` now record a setup link with an active mandate.
- **M6, PAD setup with a `default_for` mandate.** Stripe refuses `default_for` together with `payment_schedule`/`interval_description`. In the sandbox an interval mandate charged one-off payments but left a membership's first invoice at `requires_confirmation` (`sub_1UVBMaFGqw5ObEW5OOAqbrGW`), while a `default_for: ["invoice", "subscription"]` mandate (Stripe makes it `combined`, `mandate_1UVBN7FGqw5ObEW59uyfzvwk`) took a one-off charge with `mandate` (`processing`) and billed a membership unprompted (`active`, intent `processing`). `create_pad_setup_intent` now asks for that mandate, and the unused `stripe.pad_interval_description` copy is gone. Test: `test_pad_setup_asks_for_a_mandate_that_covers_invoices_and_memberships` (contract).
- **M7, pending refunds.** A refund source whose refund is pending records no finding, every pending Stripe refund is re-read each run until it settles, and the balance check adds pending refunds back. Test: `test_a_pending_refund_is_expected_until_it_settles`.
- **M8, other Stripe fees.** `stripe_fee`, `tax_fee`, `stripe_fx_fee` and any non-adjustment `fee` row post through `post_stripe_fee` wherever they sit in a source. Test: `test_standalone_stripe_fee_is_booked_once` over the three types.
- **Thin events comment.** `_resync_account` now says they list without a delivery filter.

## Gate, 2026-10-26

On the uncommitted worktree, after all of the above:

- `make test-backend`: 2,830 passed, 54 deselected, 93.51% branch coverage (final run, after the cross-check fixes).
- `make test-frontend`: 615 app-core tests in each of Vancouver, Halifax and Tokyo, plus every other package.
- `make format-check`, `lint-backend`, `lint-frontend`, `lint-infra`, `test-infra` (113): pass.
- Generators: running every `gen-*` target twice leaves the generated files unchanged.
- `make test-contract` against stripe-mock: 38 passed, including the new `update_customer` and `undelivered_events` calls.
- Not run: the Stripe sandbox checks and the Stripe browser lane.

## Sandbox checks

Run on 2026-10-27; the results and fixes are under Follow-ups, 2026-10-27.
