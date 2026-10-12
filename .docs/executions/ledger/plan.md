# Ledger production readiness plan

Status: implemented on `ledger-audit` (2026-10-12); every task is done and its test passes. This plan closes the findings of the [ledger audit of 2026-10-12](../../reviews/ledger/2026-10-12-ledger-audit.md) and a second pass over the same code on the same day that covered the command paths, the Interac webhook, timestamps, concurrency and operability. The ledger stays in Postgres; the storage decision is recorded below so it is not reopened. The [task queue](tasks.json) lists each task's scope, the findings it covers and its acceptance test.

The audit's failing tests are in `backend/tests/test_ledger_drift.py` on this branch, one per audit finding. Each task turns its finding into a test in the concept's test file before the fix, so the test fails first and passes after. Tasks L7 and L10 touch the schema (a trigger, possibly a column) and stop for explicit approval of the exact migration before any model or migration file is edited, following the schema rule in `CLAUDE.md`; every other task makes no schema change.

## Storage decision

We keep the ledger in Postgres and do not adopt TigerBeetle. Everything a dedicated ledger engine enforces natively is already enforced by the database here: a deferred constraint trigger rejects an unbalanced journal, a second trigger rejects any update or delete of an entry, a unique index on ref and leg makes every post idempotent, and the overspend checks for gift cards, packages and stock run under a row lock in the same transaction as the post. Stripe custodies the funds, so the ledger is a book of record and not the authority on whether money moves. The hottest row is one business's cash account seeing a few events a minute, and the platform fee accounts are per business, so there is no global hot row.

A separate engine could not join the transaction that today holds the payment status, the legs, the audit row, the idempotency row and the stock movement, so every settlement would become two systems with an outbox and a reconciler. The reports and the PowerSync replica both read `accounts` and `entries` straight from Postgres, so a second engine would need its change feed copied back into the same two tables. The result would be a weaker consistency story for no capability we use. The volume at which this changes (platform-held balances, tens of thousands of transfers a second, many writers on a few accounts) is not on the roadmap.

## Findings

Severities follow the audit. A1 to A7 are the audit's findings; N1 to N8 were found in the second pass.

| Id | Severity | Finding | Where |
|---|---|---|---|
| A1 | High | A refund that Stripe fails after it succeeded is acknowledged and ignored; the journal, the credit note, the reopened document and the client notice all stand | `payments._reconcile_refund` returns on a succeeded refund |
| A2 | Medium | A won dispute reverses the amount journal but not the fee, so the ledger's Stripe balance ends below Stripe's by what Stripe reinstated | `payments._close_dispute`, `ledger.close_dispute` |
| A3 | Medium | Payouts post on `payout.paid`, days after Stripe deducts them at creation; `payout.canceled` is not handled | `payments._dispatch` |
| A4 | Medium | A charge whose balance transaction is not yet readable books gross: zero fees in, zero legs dropped, nothing retries | `stripe.get_payment_fees`, `ledger.post` |
| A5 | Low | `accounts.balance_cents` is a cache nothing verifies; only `demo-check` runs the equality, on demo tenants | `ledger._lock_accounts`, `scripts/demo_validate.py` |
| A6 | Low | A lost dispute leaves the client's receivable open and the sale's revenue and tax booked; undecided | `payments._close_dispute` |
| A7 | Low | Any unique violation at webhook commit is treated as a duplicate delivery and acknowledged | `payments.process_stripe_event` |
| N1 | Medium | A saved-card charge confirms inside the Stripe call before its pending row is committed; a crash after the call leaves a real charge whose webhook is refused with retry-later until Stripe stops retrying after three days | `payments.open_card_payment`, `payments._assert_not_ours` |
| N2 | Medium | An under-paid e-Transfer is recorded nowhere but the webhook payload and burns its reference code, so the client's second transfer is dropped as a duplicate | removed with Interac on `main` (2026-10-12) |
| N3 | Medium | Failures on the money path are invisible: a raising handler rolls back its own webhook row, drift audits are written and never read, and no error tracker is initialised in the backend | `payments.process_stripe_event`, `ledger.run_reconcile_ledger` |
| N4 | Low | Settlement holds the payment row lock and a pool connection across up to three Stripe round trips for fees | `payments._settle_payment`, `payments._fees` |
| N5 | Low | Journals are stamped with the webhook's arrival time, not the charge's time, so a delayed or retried delivery moves revenue and tax to the wrong business day | `payments._settle_payment`, `payments._reconcile_refund` |
| N6 | Low | A lost race on an idempotency key, a ledger ref or an inventory line surfaces as a 500 outside the paths that catch it, and nothing retries a deadlock | `core/command.run_command` |
| N7 | Low | Redemption, forfeit and the reconcile job assume CAD while recurring payments take the currency from Stripe's payload | `ledger.post_redemption`, `ledger.post_forfeit`, `ledger.run_reconcile_ledger` |
| N8 | Low | No test races the ledger: two posts on one ref, two redemptions of one card, two consumes of one package, a cash payment against a settling webhook | `backend/tests/` |

Recorded so it is not re-raised: the platform keeps its application fee on a refund, which matches what `stripe.refund` asks Stripe for.

## Tasks

In order. A task depends on the ones above it only where stated.

- L1. Refund failure after success. On `refund.updated` with status failed or canceled for a refund stored as succeeded, reverse `refund:{id}` and its tip journals, set the refund row to the new status, clear its credit note, re-sync the parent document, re-activate an entitlement the refund voided, and notify the client that the refund did not go through. Covers A1. Test: the audit's refund test, plus the entitlement and notification cases.
- L2. The webhook builds a missing payment. When `payment_intent.succeeded` names an intent that carries our metadata and has no row, create the pending payment from the metadata and the intent's amount and currency, then settle it as usual; keep retry-later only for an intent with no usable metadata. Covers N1. Test: a succeeded event for an intent with invoice metadata and no row settles the invoice; a repeat delivery is a no-op.
- L3. Disputes from Stripe's transactions. On `charge.dispute.closed`, post what the dispute's balance transactions reinstated instead of negating our own journal, so a won case returns the amount and whatever fee Stripe returned. Handle `charge.dispute.funds_reinstated` the same way when it arrives first. For a lost case apply the decision in the open questions below. Covers A2 and A6. Test: the audit's won and lost tests.
- L4. Payouts at creation. Post the payout journal on `payout.created` or `payout.pending`, treat `payout.paid` as an idempotent repeat, and reverse on `payout.failed` and `payout.canceled`. Covers A3. Test: the audit's two payout tests.
- L5. Fees before locks, retried when unreadable. Fetch the charge's fees before the first write in `_settle_payment` and in the recurring path; when the balance transaction is not readable, refuse the event with the retry-later status instead of booking gross. Covers A4 and N4. Test: the audit's fee test; a fee lookup that raises leaves the payment pending with no lock held.
- L6. Interac under-payment. Dropped: Interac requests and matching were removed from `main` on 2026-10-12, which closes N2 with no code.
- L7. Balance by trigger. Needs schema approval. Maintain `accounts.balance_cents` from an `AFTER INSERT` trigger on `entries` and refuse any other update of the column; remove the Python increment from `ledger.post`; add the equality query from `demo_validate.py` to the nightly reconcile job, writing an audit when it fails. Covers A5. Test: the audit's balance test, with every existing ledger test unchanged.
- L8. Command hardening. In `run_command`, map a unique violation on the idempotency table to a replay of the stored response, and map one on `entries` or `inventory`, or a deadlock, to a 409 `concurrent_change` (callers lock their row before the command, so a rerun would run unguarded). Narrow the webhook catch from A7 to the `webhooks` primary key. Covers A7 and N6. Test: two concurrent commands with one key return the same response; a forced deadlock is a conflict, not a rerun.
- L9. Charge time on journals. Take `paid_at` from the event's `created` (the success time; the intent's own `created` is when checkout opened) and from the refund's created time in the refund payload, falling back to now; a payout is dated by its `created` and available on its `arrival_date`. Covers N5. Test: a late delivery books to the charge's day, not the delivery's or the checkout's.
- L10. Visible failures. Needs schema approval if a column is added for the error. Record a failed delivery in its own transaction as a `webhooks` row with status failed and the error, so retries and dead events are visible in our database; log a drift audit at error level with the business id so the error tracker from the launch-readiness backups and alerts item carries it. Covers N3. Test: a handler that raises leaves a failed row and still returns 500. A deliberate retry-later refusal (fees not readable yet, an intent whose command has not committed) is logged at info and leaves no row, and a failed row never overwrites a processed one.
- L11. Currency guard. Refuse a journal, a payment or a payout in a currency other than the business's with a stable error code until multi-currency is a feature; pass the entity's currency in redemption and forfeit. Covers N7. Test: a USD payout event is refused and audited.
- L12. Race tests. Add `backend/tests/test_ledger_races.py` in the pattern of the bookings race tests: two posts on one ref, two redemptions of one card, two consumes of one package, and a cash payment racing a settling webhook, each against the real database. Covers N8.

## Open questions

- Lost dispute: decided as a write-off. `ledger.lose_dispute` clears the receivable and unwinds the sale pro rata, like a refund, and the loss runs a full refund's side effects (parent sync, package or gift card voided). Document status counts a dispute's legs only once the payment's `dispute_status` is `lost`: an open or won case leaves the invoice or sale paid (no second charge, dunning or restock), a loss reads refunded. Income reports and GST line 101 count dispute legs as they post, since the money really moved. A `disputed` document status was considered and left for a ticket.
- Orphaned purchases: a gift card or package charged off-session whose command never committed has no row to rebuild, so the webhook refunds the charge and audits it (`payment.orphan_refunded`).
- An inquiry that escalates to a chargeback books the dispute on `charge.dispute.updated` or `funds_withdrawn`, since `created` carried no funds, and alerts staff then. A `closed` for a dispute never booked books it first.
- An off-session purchase with no row is refunded (platform fee included) only an hour after its intent opened; inside that window it is retried, since its command may still be committing.
- The failed webhook row carries no error text (that would be a new column, not approved); the error goes to the log at error level with the event id.
- Refunding the application fee: the platform keeps it today. If that changes, the refund journal gains a platform leg and `stripe.refund` passes the flag.
