# Clientbridge — Architecture & Conventions

Decisions locked 2026-06-24. This is the source of truth for stack, structure, and conventions.

## Stack
| Layer | Choice |
|---|---|
| Backend | **Python 3.12 + FastAPI** |
| Database | **PostgreSQL** + **SQLAlchemy** (ORM) + **Alembic** (migrations) |
| Web | **React + Vite + Tailwind + shadcn/ui** |
| Mobile | **React Native (Expo)** |
| Repo | **Monorepo** (pnpm + turborepo) |
| Background jobs | arq/Celery (TBD) — reminders, recurring invoices, payouts, reconciliation |
| Offline sync | **PowerSync** — on-device SQLite (web WASM + Expo op-sqlite/SQLCipher), WAL server-push, per-business Sync Rules buckets; writes through FastAPI. See [sync.md](sync.md) |

## Monorepo layout — Polyglot split (full detail in [repo-structure.md](repo-structure.md))
```
clientbridge/
├── Makefile · docker-compose.yml          # root orchestration + local infra
├── backend/        ── Python (uv) ──           FastAPI · SQLAlchemy · Alembic
├── frontend/       ── TypeScript (pnpm+turbo) ── apps/{web,mobile} · packages/{tokens,sync,api-client,config}
├── infra/          powersync sync-rules · Dockerfiles · seeds
└── .docs/          architecture · data-model · schema · sync · repo-structure · ports · code-style
    └── design/     theme-explorer (Pewter) + specs
```
Clean Python↔TS boundary; bridged only by a **generated `api-client`** (FastAPI OpenAPI → TS), the
**Pewter `tokens`** package (web Tailwind preset + RN theme), and the **`sync`** package (PowerSync client
schema + connector). Two toolchains (uv + pnpm), one root Makefile.

## Backend layout (classic layered — top-level by layer, files by domain)
```
backend/src/clientbridge/
├── main.py · worker.py    app factory + arq worker entrypoints
├── core/          config · db/session · ids (ULID + prefixes) · security/auth · deps · errors · pagination · scoping (business_id + soft-delete filter — scoped/scoped_page/scoped_count)
├── models/        SQLAlchemy models — one file per domain
├── schemas/       Pydantic request/response DTOs, by domain
├── services/      business logic + own queries (scoped via core/scoping), by domain (booking_service, invoice_service, tax_service …)
├── api/v1/        FastAPI routers/endpoints, by domain
├── sync/          PowerSync write path (/sync/upload), token + JWKS
├── integrations/  stripe · interac · twilio(SMS) · email · s3
└── tasks/         background jobs (arq)
```
Domains: `identity · crm · catalog · scheduling · billing · payments · messaging · documents · reviews · platform`.

## Conventions
- **Tables:** `snake_case`, **plural** nouns (`bookings`, `invoices`). Mapping tables: `parent_child` form when needed.
- **Columns:** `snake_case`. Timestamps: `created_at`, `updated_at` (`timestamptz`, default `now()`). Soft delete: `deleted_at timestamptz null` on user-deletable entities.
- **Primary keys:** prefixed ULID strings, generated in app — e.g. `bk_01J…`, `inv_01J…`, `cl_01J…`. Sortable, safe to expose, debuggable. (Prefix table in data-model.md.)
- **Foreign keys:** `<entity>_id` (e.g. `client_id`). Indexed. `business_id` on every business-scoped row, always indexed.
- **Money:** integer **minor units (cents)** + `currency char(3) default 'CAD'`. No floats.
- **Enums:** Postgres enum *or* `text` + `CHECK` (lean toward text+check for easy evolution).
- **Custom fields:** `custom_fields jsonb` on customizable entities + a `field_defs` table for definitions.
- **JSON:** `metadata jsonb` for extensibility; never for queried business data.

## Tenancy
`businesses` is the top entity — a provider's **business/location AND the billing entity** (multi-location via `parent_business_id`). Almost every row carries `business_id`.
`users` are global logins; `staff` link a user to a business with a `role` (owner/admin/staff/contractor) and also carry **pending invites** (`status=invited`). A member who gets paid is a **payee** (`is_payee`). *(No separate `accounts` table — kept lean.)*

## Auth
Owners/staff: **email + password + Google OAuth**. Clients **book without an account** (name/phone/email on the public page); a client may later be linked to a `user` if they self-serve. Sessions: JWT access + refresh (or server sessions — TBD in core/auth).

## Payments
- **Stripe Connect** — cards / tap-to-pay, payouts, refunds.
- **Interac e-Transfer** — request + **auto-match** by reference code (the differentiator).
- **EFT / PAD** — pre-authorized debit for recurring (subscriptions / recurring plans).
- Schema models methods/payments **provider-agnostically**; provider refs stored per row.
- **No platform-held funds / no general ledger (v1).** Stripe Connect custodies each provider's balance and **pays out to their linked bank on a schedule** (daily/weekly) we configure — the platform never transmits funds (avoids money-transmitter licensing). We **record** `payments` (fee/net/status) and **mirror** Stripe `payouts` via webhook. Balances come from Stripe; "GST/HST set aside" is a computed remittance figure (Σ tax on paid invoices), not segregated cash. Revisit a ledger only if we ever hold funds or ship in-app bookkeeping.

## Tax
GST/HST/PST/QST computed per **province** at the **line level**; the business stores its registration numbers (GST/HST, QST). Small-supplier (<$30k) mode hides tax until registered. See `tax_rates` + `billing`.

## v1 scope
Comprehensive: **core get-paid loop** (bookings · calendar · public booking · clients/CRM · services catalog · invoices · estimates · payments · tax) **+ Messaging/Inbox · Packages & Subscriptions · Team & multi-location · Reviews · Intake forms · Contracts/e-sign · Staff payout-splits · Recurring bookings**. *(All 36 tables / 10 domains — nothing deferred.)*
