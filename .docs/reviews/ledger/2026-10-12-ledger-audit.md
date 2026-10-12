# Ledger audit — 2026-10-12

Scope: `services/ledger.py`, `services/payments.py` (Stripe webhook path), `models/ledger.py`, the baseline
migration's ledger triggers, and the readers in `services/reports.py`, `app-core/domain/{clients,billing,payouts}.ts`.
Branch `ledger-audit` off `main` at f3d20a5.

## How the ledger is built

- **Double entry, append only.** Every money movement is one journal written by `ledger.post`: legs must sum to
  zero (`UnbalancedJournal` in Python, `entries_balanced` deferred constraint trigger per currency in Postgres)
  and `entries` rejects UPDATE/DELETE (`entries_append_only` trigger). Corrections are only `ledger.reverse`
  (exact negation, new ref). A journal is idempotent on `ref` (`ux_entries_ref_leg`).
- **Balances.** `accounts.balance_cents` is a running total kept in the same transaction as the legs under
  `SELECT … FOR UPDATE` (`_lock_accounts`). It is a cache of `SUM(entries)`; nothing in the schema enforces that
  equality. Per-entity figures are derived from entries by subject: invoice balance = net of `receivable` legs
  with `subject = invoice`; deposit held = `deposit` legs with `subject = booking`; gift card / package balance =
  the entity's own liability account.
- **Customer balance.** There is no client "claim" or wallet table. A client's balance is the `receivable`
  account owned by (`client`, id): invoices credit it, payments/applications debit it, disputes credit it. The
  app reads `SUM(accounts.balance_cents)` for the client (`clients.ts`); invoice status/paid-at are SQL
  expressions over entries (`invoice_status_expr`), never stored.
- **Business totals.** Sales, refunds, tax, tips, received-by-method and monthly net are all sums over entries by
  account category and event in a date window (`reports.py`); dashboard "awaiting payment" and "tax set aside"
  are `SUM(accounts.balance_cents)` by category. Stripe balance shown to the business =
  `SUM(balance_cents)` of the business's `stripe` account (`payouts.ts`).
- **Stripe mirror.** Charge: `stripe +amount`, then a `fee` journal `stripe -(processing+app)`. Refund:
  `stripe -returned`, fees kept. Dispute: `stripe -amount`, `stripe -fee`, payer `receivable +amount`; on `won`
  the amount journal is reversed. Payout: `bank +amount / stripe -amount` on `payout.paid`, reversed on
  `payout.failed`. `run_reconcile_ledger` (04:00 daily) compares the `stripe` account to Stripe's
  available+pending balance and writes a `ledger.drift` audit.

## Webhook handling that is right

- Dedupe on `webhooks.id = event.id`; a concurrent duplicate loses on commit and is acknowledged.
- Settlement happens only in the webhook (`_settle_payment`); no client-driven confirm path exists.
- `_assert_not_ours` returns 503 for an intent whose command has not committed yet, so Stripe retries.
- `_reconcile_refund` locks the parent payment `FOR UPDATE`, the same row the refund commands lock, so a
  dashboard refund webhook and an in-app refund on the same charge serialise; `provider_ref` is unique so the
  loser cannot mint a second refund row.
- Room checks lock the invoice/order and count pending intents, so a cash payment cannot race an open card
  intent into an overpayment; `void_invoice` refuses while an intent is pending.
- Journal refs are deterministic per Stripe object, so re-delivery, re-ordering (`refund.updated` before
  `refund.created`) and a crashed command followed by the webhook all converge on one journal.

## Findings

### High — a refund that fails after it succeeded is never unwound
Stripe can flip a card refund from `succeeded` to `failed` up to 30 days later (bank cannot process it); the
money returns to the connected balance via `failure_balance_transaction`. `_reconcile_refund` returns early when
the stored refund is already `succeeded`, so the `refund.updated(status=failed)` event is acknowledged and
ignored: the refund journal, the credit note, the reopened invoice/entitlement and the client notification all
stay as if the client had been paid back. Ledger `stripe` is low by the refund amount until someone notices the
drift audit. Fix: on `failed` after `succeeded`, reverse `refund:{id}` (and its tip journal), set the refund
row `failed`, re-sync the parent and re-activate a voided entitlement.

### Medium — a won dispute reverses the amount but not the fee
`close_dispute` reverses only `dispute:{id}`; `dispute_fee:{id}` stays. Since 2025-06-17 Stripe charges a
"dispute received" fee (never returned) and a "dispute countered" fee (returned on a win); earlier disputes
returned the whole fee. Either way the ledger's Stripe balance ends below Stripe's by the returned fee on
every win. The dispute object's `balance_transactions` lists the actual withdrawal and reinstatement
transactions; post what Stripe reinstated (`charge.dispute.funds_reinstated` or the `closed` payload) instead
of negating our own journal.

### Medium — payouts are booked a day or more after Stripe deducts them
Stripe's payout balance transaction is created at `payout.created` (funds leave the balance, status
`in_transit`); we post on `payout.paid`. In between, the business's "Stripe balance" tile shows money that has
already left, and the 04:00 reconcile reports drift for every business with a payout in flight. Post on
`payout.created`/`payout.pending` and reverse on `payout.failed` or `payout.canceled` (the latter is not handled
at all today).

### Medium — fees silently not booked when the balance transaction is not yet readable
`get_payment_fees` returns `ChargeFees(0, 0, None)` when the charge has no `balance_transaction` yet; the
`fee:{payment.id}` journal is then skipped (all-zero legs write nothing) and nothing retries it, so the charge
stays booked gross. Rare for cards, likelier for delayed-notification methods (PAD/ACSS). Treat a missing
balance transaction as "retry later" (raise the 503 `retry_later` path) instead of zero fees.

### Low — `accounts.balance_cents` is an unverified cache
It is maintained correctly today (row lock + same transaction) but no trigger or integrity test asserts
`balance_cents = SUM(entries.amount_cents)`. Add a check to `test_integrity` (or a nightly job next to
`run_reconcile_ledger`) so a future code path that touches `accounts` directly cannot drift the figures every
screen reads.

### Low — lost disputes leave the client owing and revenue intact
On `lost`, the payer's `receivable +amount` stays open (client shows a balance due) and the sale's revenue/tax
are not unwound. Stripe and ledger agree on cash, so this is a product decision rather than drift, but it
should be deliberate: either keep it as a receivable to chase, or write it off (reverse revenue/tax to a
`dispute` loss) when the case closes lost.

### Low — webhook `IntegrityError` at commit is swallowed as "duplicate"
`process_stripe_event` treats any unique violation at commit as a concurrent duplicate and returns 200.
Everything money-related is flushed earlier (so a real conflict surfaces as a 500 and Stripe retries), but the
catch should check for the `webhooks` primary key specifically so a future late-flushed row cannot be lost.

### Not a finding — Interac over-payment is truncated by design
`match_interac` books the requested amount and ignores the excess. `test_overpaid_etransfer_matches_at_requested_amount`
pins this as intended, so it is listed here only so the next reader does not re-raise it.

## Proof

`backend/tests/test_ledger_drift.py` has one failing test per finding above (the swallowed `IntegrityError` is
latent and has no natural trigger, so it has no test). Each test states the correct outcome and fails on
today's code at the line that encodes the finding:

| Test | Finding | Fails with |
| --- | --- | --- |
| `test_refund_that_fails_after_succeeding_returns_the_money` | refund failed after succeeded | refund still `succeeded`, Stripe account 8000 low |
| `test_won_dispute_reinstates_what_stripe_reinstated` | won dispute fee | Stripe account 1500 low |
| `test_lost_dispute_writes_the_sale_off` | lost dispute leaves AR | client receivable 8000 |
| `test_payout_leaves_the_stripe_balance_when_created` | payout timing | nothing booked on `payout.created` |
| `test_canceled_payout_comes_back` | `payout.canceled` unhandled | no payout journal |
| `test_charge_without_a_readable_balance_transaction_is_retried` | fees silently skipped | 200 instead of 503, charge booked gross |
| `test_account_balance_cannot_leave_its_entries` | `balance_cents` unguarded | direct UPDATE succeeds |

The shared local database is on the `kratos-auth` schema, so this worktree uses its own: create
`clientbridge_test_ledger`, then with `ADMIN_DATABASE_URL`, `MIGRATION_DATABASE_URL` and `DATABASE_URL` pointed
at it run `scripts.db_access roles`, `alembic upgrade head`, `scripts.db_access grants`, `scripts.seed_demo` and
`pytest tests/test_ledger_drift.py`.

## Suggested order
1. Refund failure reversal (High) with a webhook test: `refund.updated` failed after succeeded.
2. Dispute close by Stripe's reinstatement transactions; payout at creation with cancel handling.
3. Fee retry-later; `balance_cents` integrity assertion.
