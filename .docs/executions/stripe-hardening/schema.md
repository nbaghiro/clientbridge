# Stripe hardening schema

Status: S1 approved on 2026-10-26. S2 not taken. S3 approved on 2026-10-27.

## S1 (approved): two account categories, `transit` and `loss`

Widen the `accounts.category` CHECK constraint (rendered by `enum_check` from `AccountCategory` in `models/ledger.py`) with two values.

- **`transit`:** money that has left the Stripe balance in a payout and hasn't reached the bank yet. `payout.created` books `transit + / stripe −`, `payout.paid` books `bank + / transit −` at the arrival date, and a failure or cancellation reverses whichever legs exist. Reports and the 30-day Deposited figure read only `bank`, so a payout counts as deposited when Stripe says it arrived. (I1)
- **`loss`:** money the business lost beyond what it had collected, such as a dispute lost after a full refund, or the used part of a gift card lost in a dispute. Revenue, tax and liabilities are unwound only up to what is left on them, and the rest lands here, so a tax return never reclaims tax that was never collected. (C1, C2)

**Migration.** One increment after `20261024_000000_foreign_key_indexes.py` that drops and recreates the CHECK with the two added values. No column, index or trigger changes. `sync-rules.yaml` already syncs `accounts` in full, so no stream changes; `make gen-sync-schema` confirms.

**Data impact.** Existing rows are unaffected. Payouts already booked as `bank +` keep that journal; demo and staging data are reseeded, so no historical repair runs. There is no production data yet.

**Rollback.** The downgrade recreates the narrower CHECK. It fails while any `transit` or `loss` account exists, which is intended, since those journals are append-only. Rolling back after use means reverting the code and reseeding.

**Not chosen.** Reusing `revenue` for losses would make the reports read a lost dispute as negative sales, and reusing `bank` for transit is today's behaviour.

## S2 (not taken): `inquiry` dispute status

Widen `payments.dispute_status` (`DisputeStatus` in `models/payments.py`) with `inquiry`, so the payment and the client page can show an inquiry before it escalates. Without it, C7 still notifies the owner and audits the inquiry, but the payment shows no status until a chargeback opens. Data impact: none. Rollback: narrow again after clearing any `inquiry` values to null.

Recommendation: skip S2 for now; the notice is what the business needs.

## S3 (approved): `businesses.tax_registered_on`

A nullable `DATE` column: the day the business's GST/HST registration took effect. NULL means unregistered, or registered with no known start, which counts as registered throughout. A business collects tax at an instant when `tax_registered` is on and `tax_registered_on` is NULL or on or before that instant's date in the business time zone (`services/business.registered_on`). Every tax computed for a moment uses it, so a membership renewal booked late for a period that started before the registration date is split as untaxed. (F5)

The owner or an admin sets it through `PATCH /v1/business` beside `tax_registered`. Turning registration off clears it, turning it on without a date leaves it NULL, and a date while registration is off answers 422 `tax_registration_off`. It syncs with `tax_registered` in both `businesses` streams.

**Migration.** `20261027_000000_tax_registered_on.py` (`cb0034`, after `cb0033`) adds the column. No index, constraint or other table, and no history table.

**Data impact.** Existing rows stay NULL with no backfill, so registered businesses behave as registered throughout, as they do today. Demo seeds leave it NULL. There is no production data yet.

**Rollback.** The downgrade drops the column, which loses only the stored registration dates. Tax already booked keeps its journals.

**Not chosen.** A registration history table would cover a business that registers, deregisters and registers again, which one date can't express. That case is rare for a small business, and turning registration off clears the date.

## Needs without a schema change

| Need                          | Where it lives                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Reconciliation cursor (H1)    | A `ledger.reconciled` audit per business per run, holding the last balance transaction id and `created`.            |
| Deferred and rejected events (G1) | A `failed` row in `webhooks` with the payload, plus a `webhook.deferred` or `webhook.version_rejected` audit.   |
| Payouts-paused phase (J1)     | Derived from `stripe_charges_enabled`, `stripe_payouts_enabled` and the mirrored requirements.                     |
| Customer sync (E4)            | A job keyed by client id; the Customer is the record.                                                              |
| Drift findings list (H7)      | The existing `ledger.transaction_drift` audits.                                                                    |

The earlier proposal of a server-only `checkpoints` table is dropped: the audit row carries the cursor with no new table.
