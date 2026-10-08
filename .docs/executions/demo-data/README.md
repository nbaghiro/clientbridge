# Seeded demo accounts

Demo accounts are ordinary accounts in the main local `clientbridge` database. There is no demo runtime mode, separate presentation server, payment simulator, or account-specific application behavior. Authentication, permissions, workflows and provider adapters are the same for every account.

## Run locally

```sh
make up
make migrate
make seed             # adds the seed when absent; existing accounts are left alone
make demo-reset       # explicitly replaces only seeded businesses and their data
make demo-check       # read-only scenario and financial validation
```

Use the standard development servers: `make dev-api` (8701), `make dev-web` (8700), `make dev-connect` (8709), and `make dev-mobile` (8707). Both native apps use API8701 and PowerSync8704. PowerSync's `powersync_storage` database is infrastructure storage, not a second set of accounts.

## Accounts

Password: `demo1234`. Approval PIN: `2468`.

| Login | Role |
| --- | --- |
| hannah@birchbarkpets.ca | Hannah, owner |
| admin@birchbarkpets.ca | Alex, administrator |
| diego@birchbarkpets.ca | Diego, commissioned staff |
| priya@birchbarkpets.ca | Priya, employee |
| owner@cedarcoast.example.test | Rowan, separate-business isolation fixture |

Sam is an invitation, not a working login. Birchbark contains realistic schedules, rich client and pet records, classes, recurrence, estimates, invoices, ledger history, stock, packages, subscriptions, gifts, conversations, consent, forms, signed documents, reviews and public branding. Cedar Coast is a smaller independent business.

The scenario is anchored to the current Vancouver date. `seed_demo.build_demo(as_of)` assembles the fixture graph; seed modules enrich it before validation and persistence. Source assets live in `backend/scripts/demo_assets/` and upload to the normal configured storage bucket before SQL replacement. The reset replaces only known seeded businesses, their dependent rows, and their users' sessions/tokens; unrelated accounts are preserved. It refuses replacement when a seeded user also belongs to an unrelated business. Ledger reset temporarily disables its append-only trigger under a transaction-held table lock, then restores it before committing. Normal runtime ledger protections are unchanged.

## Providers and tests

Historical provider references are fixture data, not usable Stripe objects. New card payments, onboarding, saved methods, bank authorization, refunds against provider history, and real message delivery need the same configured test-provider accounts and credentials as ordinary accounts. There are no simulation buttons, fake-success routes or demo-specific delivery overrides. Without credentials the normal not-configured behavior applies; use cash/manual payments for local financial walkthroughs.

The partial cash refund follows the prior day's nail-trim sale by 30 minutes. Completed-visit invoices are dated at the visit's end, with settlement afterward. Before opening, today's collections can correctly be zero; seed generation does not invent completed visits or clamp real negative net collections. Regression checks cover five times of day, and database validation rejects future settlements and refunds preceding their original payment.

Run backend integration tests with the existing recording adapters and per-test rollback. CI uses an isolated `clientbridge_test*` database. Database destruction is not part of normal application behavior. `make test-web`, `make test-connect`, and `make test-mobile` exercise the standard app surfaces. Tests that change data should use isolated test fixtures or be followed by an explicit reseed.

The prior separate presentation/audit/execution/demo-test databases and demo PowerSync service have been retired. The original [D01–D26 review](../../reviews/demo-data/overview.md) remains historical context; its seed repairs are retained. The prior demo-only runtime infrastructure is intentionally removed.

Independent verification on October 8, 2026 passed the read-only database preflight, all five ordinary account login/logout flows, and 16 seed validation/calendar/engagement/finance tests. The remaining `clientbridge_backend_review_20261007` and `clientbridge_hardening_20261007` databases were archived with `pg_dump`, their archive catalogs checked, and removed after confirming no active connections. Recovery archives are in `.scratchpad/database-archives/20261008/`. The local PostgreSQL instance now contains only `clientbridge`, `powersync_storage`, and the standard `postgres` maintenance database, besides PostgreSQL templates.
