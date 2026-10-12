# Interac e-Transfer removal: plan

Status: implemented on the `interac-removal` branch on 2026-10-12, with the user's final decisions below. Where the sections after them disagree, the decisions apply.

## Final decisions (2026-10-12)

- Interac e-Transfer requests are removed completely: the request command, the public pay-link flow and route, the inbound webhook, matching, reference codes, the request notification, the components and hooks, the catalog keys, the site copy and the docs (ENG-40 and backend-hardening T41 are deleted).
- Staff keep a plain manual "e-Transfer received" option for payments taken outside the app, with no request and no matching. Its stored method value is `etransfer` (renamed from `interac` so it cannot be confused with Interac debit), with provider `manual`, and it posts to the `bank` ledger account as before.
- A pay page for a business without Stripe charges enabled shows the balance, "This business isn't taking online payments yet" and the phone and email from the business's public page (`PublicInvoice.contact_phone` and `contact_email`).
- The approved migration is `backend/migrations/versions/20261012_000000_remove_interac.py` (revision `cb0004`, down `cb0003`). Step A deletes Interac payments that never settled. Step B copies `reference_code` into `reference` and rewrites settled rows to method `etransfer` and provider `manual` (not `bank_eft` as proposed in section 3). Step C clears `subscriptions.payment_method_id` for saved Interac methods and deletes them. Step D deletes `interac` webhook rows. Step E swaps the CHECK constraints and drops `ck_payments_channel`, `ix_payments_reference_code` and the columns `reference_code`, `channel` and `expires_at`. The downgrade restores the structure and renames `etransfer` back to `interac` so the old CHECK holds; deleted rows are not restored.
- Interac debit on Tap to Pay (`interac_present`) is out of scope and is tracked as a before-launch story in `.docs/launch-readiness.md`.
- The staff-pay line about paying staff by e-Transfer or direct deposit stays, since it is not a payment we take.

## Decision and scope

The product has no real users, so this is a full removal with no compatibility, legacy or transition code: no kept enum values for old rows, no read-only fallbacks for historical e-Transfer data, no deprecated or redirected routes. We remove the request command, the public pay-link e-Transfer flow, reference codes, the inbound `/webhooks/interac` matching endpoint, the request notification, the manual "e-Transfer received" method, and all copy that markets any of it. Clients pay online only through Stripe methods on pay and booking links; staff can still record cash and cheques by hand.

The manual "e-Transfer received" method goes too. Nothing outside e-Transfer depends on the `interac` method value: cheque and bank EFT have their own values, the ledger's `bank` category is shared with them, and reports group by whatever methods exist. An owner who still receives an e-Transfer can record it as a cheque or leave it out; that is a product trade-off for the user to confirm (open question 1).

Interac debit is a different thing and is not part of this removal. Our Stripe Terminal path (`integrations/stripe.py:871`) creates PaymentIntents with `payment_method_types=["card_present"]` only, and there is no `interac_present` anywhere in the repo. So we do not support Interac debit on Tap to Pay today; Interac-only Canadian debit cards cannot pay at the reader. Stripe requires `interac_present` in the intent for Canadian Interac debit, which is a separate ticket. Nothing in this plan touches Terminal.

Overlap: another worker is editing `services/payments.py`, `core/config.py`, `tests/conftest.py` and other Stripe files on `stripe-setup-and-tax`. This work should start after that branch lands, or on a branch rebased on it.

## 1. Inventory

Counts exclude `interact`/`interactive` false positives (`git grep -ciP 'interac(?!t)|e-transfer|etransfer'`).

### Backend source

- `models/payments.py:23,24,27,49,77,78,88,89`: `PayMethod` has `interac`; `PaymentProvider` has `interac`; `SavedMethod` has `interac`; unique index `ix_payments_reference_code`; columns `reference_code`, `channel` and `expires_at` exist only for e-Transfer requests (`channel` CHECK `ck_payments_channel`). `reference` (line 78) is shared with cheques and stays.
- `models/platform.py:22`: `WebhookProvider` has `interac`.
- `migrations/versions/20261010_000000_baseline.py:118,1137,1611,1646,1654,1658,1690,2349`: the CHECKs, column and index above.
- `schemas/payments.py`: `InteracRequestIn` (96), `InteracRequest` (104), `InteracWebhookBody` (130), `PublicInterac` (230), `PublicInvoice.interac_email` (254) and `.interac` (266), `InvoicePaymentIn.method` literal and field descriptions (291-302), `RefundPreview.by_hand` description (91).
- `api/billing.py:23-24,189-208`: `POST /v1/invoices/{id}/interac-request`.
- `api/public.py:32,101-105`: `POST /pay/{token}/interac`.
- `api/webhooks.py:14,21,24,63-75`: `POST /webhooks/interac` with `X-Interac-Secret`.
- `core/deps.py:29-33` (`get_interac_secret`, `InteracSecretDep`), `core/config.py:61` (`interac_webhook_secret`).
- `services/payments.py`: `_INTERAC_DAYS` (71), docstring of `record_invoice_payment` (210), `request_interac` (682-730), `open_interac_payment` (1329-1385), `interac_out` (1387), `waiting_interac` (1398-1428), `refunded_by_hand` docstring (1431), `match_interac` (2227), `process_interac_event` (2248-2270).
- `services/public.py:43,122,126,130,1189,1201,1246-1253`: imports, `interac_email`, `interac=waiting_interac(...)`, `pay_interac`.
- `services/notifications.py:221-235,632-651`: `_interac_requested` builder and `Notifier.on_interac_requested`.
- `services/ledger.py:27-29`: `_CASH` maps provider `interac` to category `bank`; `_BANKED_BY_HAND` includes method `interac`.
- `locales/en_CA.po:145-152`, `en_XA.po:139-145`, `messages.pot:133-139`: `interac_requested.*`.
- `scripts/seed_demo.py:623,985-1000,1879-1883`: a client note, every third demo invoice paid with provider `interac` and `reference_code=BIRCH<n>`, and saved method `pm_amelie_interac`.
- `.env.example:53-54`: `INTERAC_WEBHOOK_SECRET`. `README.md:6`.
- Nothing in `tasks/worker.py`, reconciliation, payouts, remittances or reports code beyond the method breakdown below. `services/reports.py` groups by `Payment.method`, so its keys follow the stored value (`method:interac`).

### Backend tests

- Delete: `tests/test_payments_interac.py` (23), `tests/test_payments_interac_requests.py` (19).
- Edit: `test_flows_billing.py:1,15,129-144` (drop the matched-request flow); `test_payments.py:217,252,334` (overpay guard, canceled-intent room and tenant 404 use the request endpoint as a second method; switch to a recorded cash payment or drop the 404 case); `test_public_pay.py:78-86,129,228-249,278,291` (drop the interac tests; move the rate-limit test onto `/pay/{token}/card`; credits test uses the renamed method); `test_payments_recorded.py:65-87,176` (method value); `test_reports.py:55,182,191`; `test_notifications.py:210-219`; `test_notifications_locale.py:92-94`; `conftest.py:13,483`; `helpers.py:36` (`INTERAC` header).
- `tests/fixtures/sync_projections.json:570` and the payments row: drop `reference_code`, `channel`, `expires_at`.

### Sync

- `infra/powersync/sync-rules.yaml:75`: the payments stream selects `reference_code`, `channel`, `expires_at`.
- `frontend/packages/sync/src/schema.ts:664,673,674,689` (generated): those columns and the `payments_reference_code` index.

### Frontend app-core

- `domain/payments.ts`: saved method comment and `interacNoun` label (74,102-110), `TENDER_METHOD.etransfer = "interac"` (169), recorder copy (229,240,272), the whole request feature `InteracRequestRow`, `INVOICE_INTERAC_SQL`, `useInteracRequestForm` (410-530).
- `domain/publicPay.ts`: `PayMethod = "interac" | "card"` and ranking (19-23), `interac_email`/`interac` fields (62-80), printed fallback (178-189), `InteracRequest` client and `payInterac` (197-298), `usePublicInterac` (380-460).
- `domain/billing.ts:883,1768`: printed invoice line "Interac e-Transfer to {email}".
- `ui.ts:790`: BrandMark method comment.
- `strings.ts` (generated accessors) and `locales/en-CA.json` (75 lines; `en-XA.json` generated): `billing.method.interac`, `billing.rec.etransfer*`, the "Interac reference" key near 956, `printing.payInterac`, `refunds.method.interac`, `payments.interacNoun`, all `payments.interac.*` (about 40 keys), `reports.method.interac`, `publicReceipt.method.interac`, `publicPay.cardNotConfigured`, `publicPay.interacLabel`, `interacBadge`, `payByInterac`, `interacStartError`, `method.interac`, `etransferTitle` and the step copy near 10230, `refunds.empty` copy near 7928. `earnings.paidVia` (2184) is about the owner paying staff outside the app; it can stay.
- Tests: `publicPay.test.ts:38,49,133,201`, `billing.test.ts:76-81`, `sql.test.ts:412-417,1087-1088`.

### Frontend apps, ui and playground

- Delete: `apps/web/src/components/InteracRequest.tsx`, `apps/mobile/src/components/InteracRequest.tsx`, `apps/connect/src/pages/PublicInterac.tsx`.
- Edit: `apps/web/src/pages/Invoices.tsx:52,421,505`; `apps/mobile/src/screens/Invoices.tsx:52,284,312,322,480`; `apps/connect/src/App.tsx:11,33` (route `/i/:token/etransfer`); `apps/connect/src/pages/PublicPay.tsx:35,196-252` (method choice becomes card only); `apps/web/src/components/RecordPayment.tsx:167-174` and `apps/mobile/src/components/RecordPayment.tsx:152-157` (drop the `etransfer` tender and its reference hint).
- `packages/ui/src/web/BrandMark.tsx:11,15` and `src/mobile/BrandMark.tsx:14,19`: the `INTERAC` word for saved methods.
- Stories: `BrandMark.tsx:7,33-37`, `Choice.tsx:75`, `CopyField.tsx:45`, `PrintedDocument.tsx:97`.
- E2E: `apps/connect/e2e/connect.e2e.ts:171-180,245-246,297`; `apps/web/e2e/web.e2e.ts:524,535`. No Maestro flow or CI workflow mentions it.
- `packages/api-client/src/generated.ts` (36, generated).

### Marketing site

- `apps/site/locales/en-CA.json`: 28 messages, including the trade-mark notice (84), payments feature copy (135,180,246,252,642,648), pricing and FAQ (357,399,447,489,516,561), trade pages (894,1236,1239,1497,1986,1989,2043,2058,2229,2523,2772,2775,3006,3009) and the receipt method select (3269). `en-XA.json:3261` is generated.
- `apps/site/src/content/trades.ts:602,1020,1155` (capability cards with `icon: "interac"`), `apps/site/src/art/LineIcon.tsx:120`.

### Docs

- `.docs/architecture.md:26,45,194,248,250,326,425,437,454`.
- `.docs/engineering.md:77` (connect walk lists "invoice and e-Transfer").
- `.docs/launch-readiness.md:43` (ENG-40 row), `637,653,659` (ENG-36 text), `709-726` (ENG-40 epic).
- `.docs/executions/backend-hardening/plan.md:124,579` and `tasks.json:1178-1181` (T41 "Complete Interac event matching", status planned).
- `.docs/design/app-explorer.html` (13 mentions in mock data and screens).
- Dated reviews (`.docs/reviews/backend/files.csv`, `overview.md:65,167`, `reviews/product/mobile.md`, `web-and-connect.md`) are point-in-time audits; we leave them unchanged.

## 2. Delete outright versus careful edit

Delete outright: the two request/public endpoints and the webhook, the four schemas, `request_interac`, `open_interac_payment`, `interac_out`, `waiting_interac`, `match_interac`, `process_interac_event`, `_INTERAC_DAYS`, the secret setting and dependency, the notification builder and its messages, the three frontend components/pages, `useInteracRequestForm`, `usePublicInterac`, `payInterac`, the `etransfer` tender and its recorder copy, every `payments.interac.*`, `*.method.interac`, `billing.rec.etransfer*` and publicPay Interac key, the `INTERAC` BrandMark word and story variants, the two backend test files, ENG-40 and backend-hardening T41.

Careful edits on shared code:

- `PayMethod` becomes `card | bank_eft | cash | cheque | other`; `PaymentProvider` becomes `stripe | manual`; `SavedMethod` becomes `card | bank_eft`; `WebhookProvider` becomes `stripe | twilio | sendgrid`. No production code creates an `interac` saved method; only the seed does.
- `InvoicePaymentIn.method` becomes `cash | cheque | card`, and the `reference`/`received_on` descriptions drop e-Transfer. The `reference` column stays for cheque numbers.
- Ledger: `_CASH` loses the `interac` key and `_BANKED_BY_HAND` loses `interac`; the `bank` category stays for manual cheques and bank EFT. This matters for historical rows: `cash_category` decides where a refund posts, so a settled e-Transfer row that is rewritten rather than deleted must land on a method that still maps to `bank` (`bank_eft`), or its refund would post to the till while its payment sat in the bank.
- `refunded_by_hand` (`provider != "stripe"`) needs no logic change; its docstring and the `by_hand` field description drop e-Transfer.
- Public pay page: with Interac gone, an invoice whose business has no Stripe charges enabled has no online method. The page shows the balance and a "contact the business to pay" state instead of `cardNotConfigured`'s "Please use Interac e-Transfer". `PublicInvoice.interac_email` and `.interac` are removed; whether to expose the business email under a neutral name is open question 3.
- Printed invoices lose the "Interac e-Transfer to {email}" payment line.

## 3. Schema and data changes (each needs explicit approval)

Recommended path: because there are no real users, reset local databases after the change (`make down`, remove the Postgres volume, `make up migrate seed`) and let the updated seed stop producing e-Transfer rows. A migration is still required so that any database already at `cb0003` reaches the new head; its data steps clean whatever e-Transfer rows exist. One new increment, `backend/migrations/versions/20261012_000000_remove_interac.py` (revision `cb0004`, down `cb0003`), plus the matching model edits. The baseline stays as is.

Ledger entries are append-only (`entries_append_only` trigger), so a settled payment cannot be deleted without leaving journals that still count it as paid. The data steps therefore delete rows that never reached the ledger and rewrite the settled ones.

Step A, delete e-Transfer requests that never settled. Pending, canceled, expired or failed requests posted no journal, so deleting them leaves balances unchanged and releases the room a pending request reserved on its invoice. Refund rows cannot point at these, because only settled payments are refundable.

```sql
DELETE FROM payments
 WHERE provider = 'interac' AND status <> 'succeeded' AND status <> 'refunded';
```

Step B, rewrite settled e-Transfer rows (request-flow and manually recorded, including their refunds) as manual bank transfers. `bank_eft` with provider `manual` resolves to the `bank` cash account the journals already used, so later refunds stay balanced. The reference code is folded into `reference` before its column is dropped.

```sql
UPDATE payments SET reference = COALESCE(reference, reference_code)
 WHERE reference_code IS NOT NULL;
UPDATE payments SET method = 'bank_eft', provider = 'manual'
 WHERE method = 'interac' OR provider = 'interac';
```

Step C, delete saved "Interac contact" methods (seed only). `subscriptions.payment_method_id` references `payment_methods`, so any reference is cleared first.

```sql
UPDATE subscriptions SET payment_method_id = NULL
 WHERE payment_method_id IN (SELECT id FROM payment_methods WHERE method = 'interac');
DELETE FROM payment_methods WHERE method = 'interac';
```

Step D, delete `interac` webhook log rows (dedupe records for the removed endpoint).

```sql
DELETE FROM webhooks WHERE provider = 'interac';
```

Step E, constraints, index and columns.

```sql
ALTER TABLE payments DROP CONSTRAINT ck_payments_method,
  ADD CONSTRAINT ck_payments_method
  CHECK (method IN ('card', 'bank_eft', 'cash', 'cheque', 'other'));
ALTER TABLE payments DROP CONSTRAINT ck_payments_provider,
  ADD CONSTRAINT ck_payments_provider CHECK (provider IN ('stripe', 'manual'));
ALTER TABLE payment_methods DROP CONSTRAINT ck_payment_methods_method,
  ADD CONSTRAINT ck_payment_methods_method CHECK (method IN ('card', 'bank_eft'));
ALTER TABLE webhooks DROP CONSTRAINT ck_webhooks_provider,
  ADD CONSTRAINT ck_webhooks_provider CHECK (provider IN ('stripe', 'twilio', 'sendgrid'));
ALTER TABLE payments DROP CONSTRAINT ck_payments_channel;
DROP INDEX ix_payments_reference_code;
ALTER TABLE payments DROP COLUMN reference_code, DROP COLUMN channel, DROP COLUMN expires_at;
```

Audits and idempotency records with the action `payment.interac_request` are plain text history with no CHECK; we leave them, since rewriting audit history is not part of removing a feature.

Data impact. Seed and demo: the seed is changed to stop writing e-Transfer rows (every third demo invoice payment becomes a cheque, and `pm_amelie_interac` and the "Pays by Interac" client note go), so a reset database contains none. On a database migrated in place, every third demo invoice payment (`pay_<n>`, code `BIRCH<n>`) becomes a manual `bank_eft` payment with the code in `reference`, and `pm_amelie_interac` and any unsettled requests are deleted. No real data exists; we have not checked for any shared staging or demo database (open question 4).

Rollback. The downgrade restores the three nullable columns, the unique index and the old CHECKs. It cannot restore deleted request rows, saved methods or webhook rows, `channel` and `expires_at` values, or which `bank_eft` rows were e-Transfers. On local databases the practical rollback is to check out the previous commit and reset and reseed; for any non-disposable database we would take a `pg_dump` of `payments`, `payment_methods`, `webhooks` and `subscriptions` first.

Sync. Remove `reference_code`, `channel` and `expires_at` from the payments stream in `sync-rules.yaml`, run `make gen-sync-schema`, and update `tests/fixtures/sync_projections.json`. The `powersync` publication lists tables, not columns, so `scripts/db_access.py` needs no change. Client replicas drop the columns on the next schema load; there is no client fallback for them.

## 4. API contract and regeneration

Removed with no replacement or redirect: `POST /v1/invoices/{invoice_id}/interac-request`, `POST /pay/{token}/interac`, `POST /webhooks/interac`, and the Connect route `/i/:token/etransfer`. Removed schemas: `InteracRequestIn`, `InteracRequest`, `InteracWebhookBody`, `PublicInterac`. Removed fields: `PublicInvoice.interac_email`, `PublicInvoice.interac`. Narrowed enums: `InvoicePaymentIn.method` (`cash | cheque | card`) and `PayMethod` everywhere it appears (`PublicCredit.method`, `PublicReceiptPayment.method`, payment rows). Removed setting: `INTERAC_WEBHOOK_SECRET`.

Regenerate: `make gen-api` (api-client), `make gen-sync-schema`, `make gen-messages` (drops `interac_requested.*` from `messages.pot` and `en_XA.po` after removing them from `en_CA.po`), `make gen-strings` (app-core and site accessors and `en-XA` locales). `make codegen-check` must be clean.

## 5. Marketing site and docs

Site: rewrite the 28 `en-CA.json` messages so payments read as card online, Tap to Pay in person, and Canadian pre-authorized debit where we offer it; remove the Interac trade-mark notice, the "What does an Interac e-Transfer cost?" FAQ, the pricing sentences about e-Transfers carrying no card fee, the "matched by reference code" feature and the cleaning example's "Interac matched · Ref CB-8T3W". Replace the three `icon: "interac"` capability cards in `trades.ts` with card or bank copy and delete `LineIcon.interac`. Drop `interac` from the receipt method select at 3269. Pricing copy that contrasts card fees with free e-Transfers needs a plain statement of the card fee instead.

Docs: update `architecture.md` (stack table, surfaces table, uniqueness lists, the `payment_methods.method` note, sync note, the "Interac e-Transfer: request + auto-match" line, the `open_*` builders list, and the ledger "payment settled" row), `engineering.md:77`, `launch-readiness.md` (delete the ENG-40 row and epic, fix ENG-36 "pay link by card or Interac" and the record-payment lines), `backend-hardening` (delete T41 from `tasks.json` and the Interac row and T41 section from `plan.md`), `design/app-explorer.html` mock data, `README.md:6` and `.env.example`. If the user wants Interac debit tracked, add it under launch work as a Terminal item.

## 6. Execution order

1. Get answers to the open questions and approval for steps A to E.
2. Wait for or rebase on `stripe-setup-and-tax`.
3. Backend code: remove routes, schemas, services, settings, the notification builder and messages; narrow `InvoicePaymentIn` and the model vocabularies; fix the ledger maps; write the increment migration; update the seed. Reset the local database and run `make migrate seed`; separately run the migration on a copy of a pre-change database to confirm steps A to E pass the CHECKs.
4. Backend tests: delete the two Interac test files; in the shared tests, use a recorded cash payment wherever a request was the "second method" (`test_payments.py` overpay and canceled-intent cases), drop the request-only tenant 404 case, move the public rate-limit test to `/pay/{token}/card`, switch credits/report/recorded tests to cheque, and remove the `INTERAC` header, secret override and notification-locale entries. Update `sync_projections.json`. Add a migration test that rows from every step end in the expected state, and keep the 4-part matrix for recorded payments (happy, each 4xx including a 422 for `method: "interac"`, tenant isolation, idempotent replay).
5. Sync rules, then `make gen-sync-schema`, `make gen-api`, `make gen-messages`.
6. app-core: remove the request and public e-Transfer hooks and the `etransfer` tender, simplify `publicPay` to card plus a no-online-method state, fix the printed invoice line, update locales, run `make gen-strings`; update `publicPay.test.ts`, `billing.test.ts`, `sql.test.ts`.
7. Apps and ui: delete the three components/pages, edit Invoices (web and mobile), RecordPayment (web and mobile), Connect `App.tsx` and `PublicPay.tsx`, the BrandMark twins and the four stories; update the Connect and web e2e walks.
8. Site copy and content, then docs.
9. Gate: `make check` (lint including structure checks and knip, codegen-check, backend tests at 90 percent branch coverage, frontend tests), plus `make test-connect`, `make test-web` and `make test-site`, then the milestone audit from CLAUDE.md.
10. `git grep -iP 'interac(?!t)|e-transfer|etransfer'` returns only the new migration, `earnings.paidVia` (staff pay outside the app, if kept) and the dated reviews under `.docs/reviews/`.

## 7. Open questions for the user

1. Manual e-Transfer: we recommend dropping it entirely, so staff record only cash, cheques and saved cards by hand. Confirm, or say if owners should be able to record a bank transfer under a neutral manual method instead.
2. Approve steps A to E: delete unsettled requests, rewrite settled e-Transfer rows to manual `bank_eft` (deleting them is blocked by the append-only ledger), delete saved `interac` methods and `interac` webhook rows, and drop the three columns, the index and the `interac` CHECK values.
3. Pay pages for businesses without Stripe charges enabled: show the balance and a "contact the business" message; should `PublicInvoice` expose the business email for that?
4. Is there any shared staging or demo database, beyond local ones, that the migration would run against?
5. Interac debit: Terminal intents use `card_present` only, so Interac debit cards cannot pay by Tap to Pay. Open a separate ticket to add `interac_present`?
6. `earnings.paidVia` ("Pay them by e-Transfer or direct deposit") describes how owners pay staff outside the app, not a payment we take. Keep it or reword it?
