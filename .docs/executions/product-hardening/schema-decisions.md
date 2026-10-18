# Revised schema proposals — minimal stored facts

These proposals supersede the earlier S1–S4 designs. The user approved proceeding after reviewing the revised designs; implementation is now authorized. Minimize stored facts, retain necessary historical evidence, and use one-word names for new tables. JSON is for structured documents/transport payloads, not a way to conceal duplicated state or an unbounded relational history.

## S1 — Stock: reuse existing tables

Withdraw the proposed `stock_reservations` table. Derive held quantities from checkout orders, their lines, payment lifecycle and recorded sale movements. Lock item rows in a consistent order when checking availability and creating holds; apply the same rule to every stock-consuming path. Settlement must remove the derived hold and record the sale atomically. A deadline makes a checkout eligible for cancellation; it does not itself release stock while a provider can still collect payment.

No schema change proposed. Prove concurrent checkout/POS, retries, cancellation failures, late settlement and no-double-counting with tests. Audit existing pending orders before enabling enforcement. Any measured index requirement is a separate concrete proposal.

## S2 — One durable deliveries table

Approved revised design after the schema discussion: one server-only `deliveries` table, no attempts table or JSON attempt history. Columns: prefixed `id` primary key; nullable `business_id` FK; required unique `key`; required immutable typed JSONB `payload` (recipient/channel/rendered content and necessary metadata); required checked `state` (queued/sending/accepted/delivered/failed/ambiguous); nullable timestamptz `next_at` (retry/lease deadline); nullable text `claim` (worker fencing token); nullable `provider_ref`; nullable safe `error` code; required `created_at` timestamp. Due-work index on next_at for eligible rows, provider-reference lookup index, and business/time index. No attempt count, payload hash, actor copy, updated_at, or separate attempts table. Admin initiation is attributable through the immutable payload’s trusted actor tag; platform test messages have no business to attach to the tenant-only audits table. Full network attempt history is deliberately out of scope.

Worker claims commit before external I/O; completion checks its fencing token. Expired sends are ambiguous and are not blindly retried. Acceptance is not delivery. Data impact: additive empty table, new events only, no historical resends; excluded from PowerSync. Rollback stops dispatch and retains pending/ambiguous records. No live external sends are authorized by schema approval.

## S3 — Forms: two columns on responses

- `definition`: required JSONB structured snapshot containing provenance (`issued` or `reconstructed`), form name, signature requirement and ordered field definitions/validation. Provenance belongs to the snapshot and is not a separate column.
- `signature`: nullable JSONB signature evidence: signer name, IP and optional normalized drawing strokes. Typed/drawn presentation is derived from validated evidence shape. Signing occurs atomically with submission, so the existing submitted_at is the signing timestamp.

Remove definition_hash (compute when needed) and definition_provenance columns. Do not duplicate submitted_at inside signature. Snapshot content cannot be derived from a form that is later edited, so it must remain stored. Existing signatures are contract-specific with a required contract FK; generalizing them would introduce optional relationships and touch unrelated contract behavior merely to avoid this one field.

Data impact: preserve answers unchanged. Backfill existing response definitions from current forms and mark all such snapshots reconstructed, including previously issued drafts whose original wording is unknown. Newly issued responses use issued provenance. Historical unsigned submissions remain unsigned; do not fabricate evidence. Enforce signatures on new submissions under the captured definition. Keep new evidence server-only unless an explicit safe read projection is approved.

Rollback: retain captured evidence; pause submissions if reverting would discard or bypass it. No destructive downgrade.

## S4 — SMS: one column on businesses

- `sms_number`: nullable normalized E.164 text with a unique constraint/index (multiple nulls allowed).

Withdraw sms_assignments. The current integration uses one configured Twilio account and one assigned sending number per business. Resolve inbound To against sms_number after validating provider credentials/signature, then find From only inside that business. Outbound routing reads the same assignment. The existing contact phone, where present elsewhere, is not the sending-number assignment.

No stored provider account/number ID (not needed for the current send/routing path), active flag (derive from null/non-null), activation timestamps or separate assignment history table. Record provisioning/removal in existing business audits with old/new numbers. Numbers cannot be transferred between businesses in this scope: retired ownership must be checked from audit history under a number-specific lock before assignment, preventing delayed/retried inbound events from being silently rerouted to a different tenant. If number reuse or multiple provider accounts becomes necessary, reconsider a dedicated ownership model then.

Data impact: existing businesses get null, no shared-number backfill. Unassigned SMS sending fails explicitly. Provider provisioning is separate; no purchases or releases are authorized here. Existing messages/consents remain intact. Exclude sms_number from device projections unless a specific UI needs it. Rollback disables affected SMS, retains assignments/audits and never restores cross-tenant last-sender routing.

## Approval scope

Approved revised proposal: one new table (`deliveries`), two columns on responses and one column on businesses. No stock table, no duplicate derived counters/hashes/status copies. The user’s subsequent instruction to proceed follows the concrete schema review and approval of the single-table delivery design. S1 requires no schema change. Additional schema outside S2/S3/S4 remains a separate decision.
