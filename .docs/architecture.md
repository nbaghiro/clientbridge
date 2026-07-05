# Clientbridge — Architecture

The canonical description of **how the system is built**: stack, structure, the data model, sync, and
authorization. For *how we build it* (the gate, testing, conventions) see [engineering.md](engineering.md);
for *what's left* see [roadmap.md](roadmap.md); for design/IA see [design/](design/).

Clientbridge is a **local-first, all-in-one business OS** for solo and small service providers —
bookings, clients, catalog, invoicing, payments, messaging, forms, reviews, staff payout-splits — with
Canadian tax built in. All user-facing copy is centralized in one place. The customer-facing layer
(booking, pay, forms, contracts, reviews) is branded **Connect**.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | **Python 3.14** · uv · **FastAPI** · async **SQLAlchemy** · **Alembic** |
| Database | **PostgreSQL 16** (logical WAL for sync) |
| Jobs | **arq** on Redis |
| Web | **React + Vite + Tailwind** (provider/admin app) |
| Mobile | **React Native (Expo)** (provider/admin app) |
| Customer | **React + Vite** (Connect — public, PowerSync-free, embeddable) |
| Offline sync | **PowerSync** — on-device SQLite (web WASM/OPFS · Expo op-sqlite), WAL server-push, per-business Sync Rules; writes through FastAPI |
| Payments | **Stripe Connect** (Custom accounts, direct charges) + **Interac e-Transfer** + PAD/EFT |
| Repo | **Polyglot monorepo** — backend (uv) + frontend (pnpm + turbo), one root Makefile |

The toolchain pins Python **3.14** (via `.python-version`) while ruff/mypy target 3.12 for
type/lint-compatibility. The `pyproject` floor is `>=3.12`.

---

## The 5 surfaces

**Every capability is exactly one of five surfaces. Choosing the surface is the main design decision per
feature.** The rule: a **server-only invariant** — uniqueness/numbering, capacity/conflict, money,
secrets, cross-tenant — must be a **command**, never a sync-write.

| # | Surface | What it is | Auth | Examples |
|---|---|---|---|---|
| 1 | **Sync-read** | PowerSync streams each device its authorized rows into local SQLite | Sync Rules (buckets) | calendar, clients, invoices on-device |
| 2 | **Sync-write** | `POST /sync/upload` applies simple CRUD the device queued | `WRITE_POLICY` | edit a client, draft a note, tweak availability |
| 3 | **Command / RPC** | FastAPI `POST/PATCH/DELETE` under `/v1/*`, wrapped in `run_command` (atomic + audited + idempotent) → writes Postgres → flows back via sync | JWT + role | book a slot, issue an invoice, take a payment |
| 4 | **Webhook / public** | inbound provider callbacks + unauthenticated public pages | signature / token / slug | Stripe/Interac/SMS webhooks; book/pay/form/contract/review |
| 5 | **Job** | arq background work on Redis | system | reminders, reap-unpaid, broadcasts, overdue sweep |

**Decision rule** — where does a new operation go?
- Client can compute it locally and it's just data → **sync-write (2)**.
- Needs a server-only invariant (uniqueness/numbering, capacity/conflict, money, secrets, cross-tenant) → **command (3)**.
- A third party initiates it → **webhook (4)**.
- Time-based or async → **job (5)**.

This is why *"create a booking" is a command (`POST /v1/bookings`), not a raw sync-write*: the
capacity/conflict check must be atomic and server-authoritative. The resulting row then syncs back to
every device for free. The same logic makes invoice numbering, payments, and broadcasts commands.

---

## Monorepo layout

Clean Python↔TS boundary, crossed **only** by three generated bridges (see *The three bridges* below).
Two toolchains (uv + pnpm), one root Makefile.

```
clientbridge/
├── Makefile · docker-compose.yml · .env.example        root orchestration + local infra
├── backend/            ── Python · uv · FastAPI ──
│   ├── migrations/versions/    Alembic (squashed initial + linear increments)
│   ├── scripts/                seed_demo · gen_sync_schema · export_openapi
│   ├── tests/                  integration suite + contract/ + e2e/
│   └── src/clientbridge/
│       ├── main.py             FastAPI app factory (ASGI entry)
│       ├── core/               command · scoping · deps · config · security · db · errors · ids · ratelimit
│       ├── models/             SQLAlchemy — one file per domain (+ auth, base)
│       ├── schemas/            Pydantic DTOs — per domain
│       ├── services/           business logic — the brain, ~40 files
│       ├── api/                router.py · v1/ (25 routers) · public.py · webhooks.py
│       ├── sync/               auth.py (token/JWKS) · upload.py (WRITE_POLICY)
│       ├── integrations/       notifications · oauth · payments · s3 (adapter interfaces)
│       └── tasks/              arq worker + cron jobs
├── frontend/           ── TypeScript · pnpm + turbo ──
│   ├── apps/
│   │   ├── web/        React + Vite · provider/admin · :8700
│   │   ├── mobile/     Expo RN · provider/admin · :8707
│   │   └── connect/    public customer app · PowerSync-free · :8709
│   └── packages/
│       ├── app-core/   shared view-model hooks + strings + icons
│       ├── sync/       PowerSync AppSchema + backend connector
│       ├── api-client/ generated OpenAPI types + session (refresh/sign-out)
│       ├── tokens/     Pewter design system → Tailwind preset + RN theme
│       └── config/     shared eslint/prettier + the no-inline-ui-string rule
├── infra/powersync/    powersync.yaml (service config) · sync-rules.yaml (read authz)
└── .docs/              architecture · engineering · roadmap · design/
```

---

## Backend — layer-first, domain-as-filename

Flow: **`api/v1` (thin router + DTO, never queries) → `services` (logic, owns the transaction) → `models`.**
Each layer directory holds one file per domain (`services/booking_service.py`, `schemas/scheduling.py`),
matching the `models/` layout. Ten domains: `identity · crm · catalog · scheduling · billing · payments ·
messaging · documents · reviews · platform`.

### The request flow
```
HTTP → api/v1/…  → schemas/ (DTO)  → services/ (logic + txn)  → core/scoping · command  → models/  → Postgres  → WAL  → PowerSync  → device
```
Routers are thin: they resolve dependencies, construct a `Service(db, principal, …)`, call one method with
the validated DTO (threading the `Idempotency-Key` header for mutations), and return a response schema.
**All querying and the transaction live in the service.** A raised `AppError` renders as `{error, message}`
with the subclass's HTTP status.

### The cross-cutting core (`core/`)
| File | Responsibility |
|---|---|
| `command.py` | **The command wrapper.** `run_command(db, principal, *, action, run, response_model, idempotency_key)` — replays a stored response for a repeated key, stages `Command.record(...)` audit rows, then commits mutation + audit + idempotency key as **one atomic unit** (rollback on any error). Money/uniqueness/cross-tenant mutations go through it. |
| `scoping.py` | **The one place the tenant filter lives.** `scoped(Model, business_id, soft_delete=…)` + `scoped_page`/`scoped_count`/`scoped_update`/`scoped_delete` + the `Page[T]` envelope. Services **never** hand-write a `business_id` filter. |
| `deps.py` | DI hub — DB session, adapter aliases (`EmailDep`, `GatewayDep`, `StorageDep`…), the auth chain (`current_principal` re-derives business/role from the DB every request, honoring `X-Business-Id`), and role gates (`assert_role` per-method, `require_role` per-router). |
| `config.py` | Pydantic-settings. **Fails closed in prod:** refuses to boot if the JWT secret is still the dev default or the Stripe webhook secret is empty when `env != dev`. |
| `security.py` | Argon2 password hashing · SHA-256 opaque-token hashing · HS256 access tokens · the PowerSync token (HS256 or RS256 + a JWKS endpoint for prod). |
| `ids.py` | Prefixed-ULID PKs (`bz_…`, `bk_…`) — time-sortable, so `scoped_page` orders `id DESC` for newest-first. |
| `errors.py` | `AppError` taxonomy → HTTP status (`NotFound` 404, `Conflict` 409, `CardDeclined` 402, `TooManyRequests` 429…). |
| `ratelimit.py` | In-process fixed-window limiter for the five public surfaces (30/60s each). |
| `db.py` | Async engine + `SessionLocal` + the `Base` metadata that `sync/upload.py` reflects over. |

### Role gates
Live in one of two places by shape: a router where *every* endpoint is admin-only gates once
(`require_role("owner","admin")` via `AdminPrincipal`); a service whose methods *vary* in who may call them
(POS order-create is staff, void is admin) gates per-method via `assert_role(self.principal, …)`. Never a
hand-written `if principal.role not in (...)`.

### External services
Every external dependency is an **adapter interface (`typing.Protocol`) + a prod implementation + a `get_*()`
dependency** that tests override with a recording fake — so the boundary is covered without the network.
Four adapters in `integrations/`: `notifications.py` (Postmark email · Twilio SMS · Expo push), `payments.py`
(Stripe Connect + Terminal), `oauth.py` (Google), `s3.py` (S3/MinIO).

### Jobs (`tasks/`)
`worker.py` registers the arq cron: reminders + due broadcasts every 15m, reap-unpaid every 15m, overdue
sweep 07:00, review requests 08:00, daily maintenance 03:30. Jobs aren't tenant-scoped — each row resolves
its own business + locale; each is idempotent via a status/timestamp marker and opens its own session.

---

## The data model

**40 tables** — **38 across the 10 domains** + **2 server-only auth-infra** tables (`auth_sessions`,
`auth_tokens`). No general ledger (Stripe Connect custodies funds + pays out). The SQLAlchemy models in
`backend/src/clientbridge/models/` are the exact-DDL source of truth; the migrations in
`migrations/versions/` are the applied history.

### Conventions
- **PKs:** prefixed-ULID strings, minted in-app (`core/ids.new_id`) — sortable, safe to expose, debuggable.
- **Tenancy:** `business_id` (indexed) on every business-scoped row. `businesses` is the top entity
  (business/location **and** billing entity; multi-location via `parent_business_id`). `users` are global
  logins; `staff` link a user↔business with a `role`.
- **Money:** integer **cents** (`BigInteger`) + `currency char(3) default 'CAD'`. No floats.
- **Enums:** `text` + a named `CHECK` constraint (via `enum_check`) — easy to evolve by drop+recreate.
- **Timestamps:** `created_at`/`updated_at` (`timestamptz`, default `now()`); status + key lifecycle
  timestamps; `created_by` where used.
- **Soft-delete:** `deleted_at` on **`clients`** and **`bookings`** only; everything else hard-deletes or
  status-lapses.
- **No `relationship()`** on any model → the unit-of-work can't FK-order inserts, so services **flush the
  parent before its FK children** (the seed hand-orders inserts for the same reason). One FK cycle
  (`bookings → packages → payments → bookings`) is broken with `use_alter=True`.
- **JSONB** for lightweight config (brand, custom_fields, attributes, audience, answers, changes,
  requirements); **never** for queried business data.
- **Concurrency invariants live in SQL:** GiST exclusion constraints stop double-booking a staff member or
  a resource; partial-unique indexes enforce business rules (one active/paused subscription per client+item,
  one open review request per booking, one refund per payment, unique Interac reference codes).

### ID prefixes
`bz_`business `us_`user `st_`staff · `cl_`client `sj_`subject `nt_`note · `it_`item `pkg_`package
`sub_`subscription `gc_`gift_card · `ses_`session `bk_`booking `av_`availability `rs_`resource
`sch_`schedule · `inv_`invoice `est_`estimate `ord_`order `ln_`line · `pay_`payment `pm_`payment_method
`po_`payout `pal_`payout_allocation · `th_`thread `msg_`message `bro_`broadcast · `frm_`form `ff_`form_field
`fr_`form_response `con_`contract `sig_`signature · `rv_`review `rvr_`review_request · `fl_`file
`aud_`audit_log `wh_`webhook `dev_`device_token `idk_`idempotency_key

### Tables by domain

**identity (3)** — `businesses` (all Stripe-Connect/KYC mirror fields + Canadian tax fields + `slug` + brand
JSONB + `parent_business_id`), `users` (global login, `email` unique, `oauth`), `staff` (user↔business, `role`
owner/admin/staff/contractor, payout config `is_payee`/`default_rate`/`rate_type`, pending invites via
`status=invited` + hashed `invite_token`).

**crm (3)** — `clients` *(soft-del)* (`tags[]`, `status`, `lifetime_value_cents`, `custom_fields`,
`stripe_customer_id`), `subjects` (pet/vehicle/child/property, `attributes` JSONB), `notes` (polymorphic
`parent_type`/`parent_id`).

**catalog (4)** — `items` (**one table drives the whole catalog** via `kind` service/class/product/package/
subscription/gift — duration, capacity, deposit, recurrence, session_count, `stripe_price_id`), `packages`
(client's package: `sessions_total`/`sessions_used`, status), `subscriptions` (recurring: status, period,
`provider_ref`; partial-unique one active/paused per client+item), `gift_cards` (`code` unique per business,
`balance_cents`).

**scheduling (5)** — `sessions` (the calendar event: capacity-bearing block; appointment = capacity 1, class
= capacity N; `booked_count`, `recurrence_id`), `bookings` *(soft-del)* (client↔session; denormalized
`staff_id`; status pending→confirmed→completed/canceled/no_show; `source`; deposit; `reminded_at`),
`availability` (per-staff recurring weekday or date override, `is_available`), `resources` (rooms/equipment),
`schedules` (recurrence rule → expands to sessions/bookings).

**billing (4)** — `invoices` (per-business unique `number`, status lifecycle, cents rollup subtotal/tax/
total/balance, `pay_token`), `estimates` (accept/decline/convert → invoice), `orders` (POS/Terminal sale),
`lines` (**polymorphic** across invoice/estimate/order via `parent_type`; `item_id`/`booking_id`,
`tax_amount_cents`).

**payments (4)** — `payments` (money-in: `kind` payment/deposit/refund; unique `provider_ref` = one row per
Stripe object; one-refund-per-payment; Interac `reference_code`; `fee_cents`/`net_cents`), `payment_methods`
(saved card/PAD), `payouts` (Stripe payout mirror), `payout_allocations` (staff earnings: `source_type`
booking/invoice_line/class_session/tip/sale; basis rate/percent/fixed; unique per source+staff).

**messaging (3)** — `threads` (unique per business+client+channel), `messages` (direction in/out,
`broadcast_id`, `attachments`), `broadcasts` (audience JSONB + `scheduled_at`).

**documents (5)** — `forms`, `form_fields` (17 typed field types), `form_responses` (public-link token,
`answers` JSONB), `contracts` (template), `signatures` (public-link token; snapshots `signed_body` + captures
`ip`; links a signature image file).

**reviews (2)** — `reviews` (rating 1–5 CHECK; `sent_to_google`; rolls up to `businesses.avg_rating`),
`review_requests` (unique token; partial-unique one open request per booking).

**platform (5)** — `files` (S3 key), `audit_logs` (append-only activity feed), `webhook_events` (inbound
provider events; **not** business-scoped — routed during processing), `device_tokens` (Expo push),
`idempotency_keys` (unique per business+scope+key — backs `run_command` replay).

**auth-infra (2, server-only, excluded from sync)** — `auth_sessions` (refresh-token families; rotation
swaps the hash, replay revokes the family), `auth_tokens` (single-use reset/verify tokens).

> **Note on tax:** there is **no `tax_rates` table** (dropped). Rates are hardcoded per province in
> `services/tax_rates.py` and derived from `businesses.province`; the tax engine (`services/tax_service.py`)
> is pure and golden-tested. See *Tax* below.

### Polymorphic patterns
`lines.parent_type` (invoice/estimate/order) · `payments` nullable over invoice/booking/order + `kind`/
`method`/`reference_code` · `items.kind` = whole catalog · `sessions` = every slot · `staff` = staff +
invites · `payout_allocations.source_type` = any earning source · `notes`/`files`/`audit_logs` `parent_type`
generalize the rest.

> **Why this shape:** the model is a pragmatic "mostly-lean" blend chosen over an option-by-option review —
> maximally consolidated (polymorphic `lines`/`payments`, one `items(kind)`, one `sessions` for 1:1 + group)
> but split where lifecycles genuinely differ (packages vs subscriptions vs gift cards; forms vs contracts).
> A deliberately lean schema, with clarity kept exactly where money and lifecycles live.

---

## Sync (PowerSync)

**Engine: PowerSync**, self-hosted next to Postgres. Topology = **PowerSync reads the Postgres WAL
directly**; **writes always go through FastAPI** (server-authoritative). Chosen because it's the only engine
that delivers, for this stack, *all of*: real offline SQLite on **both** web (WASM/OPFS) and Expo RN
(op-sqlite), WAL-driven server-initiated push, and per-business partial replication — with no Node and
minimal bespoke code. (ElectricSQL rejected: no offline SQLite on RN today. DIY rejected for v1: months of
build + permanent maintenance.)

```
 Expo (op-sqlite) ─┐                            ┌── logical replication (WAL) ──┐
 Web (WASM/OPFS)   ─┤── WebSocket (read sync) ─► PowerSync Service ◄────────────┤ Postgres (source of truth)
       ▲ reads local SQLite (offline-first)      (Sync Rules bucket by           │
       │                                           business_id + role, from JWT)  │
       └── local writes → uploadData() ─► FastAPI /sync/upload ─(authz+validate)─┘ writes
```

- **Reads** are governed by **Sync Rules** + JWT claims; FastAPI is *not* in the read loop. The on-device
  SQLite already holds only the rows this user may see, so the client never filters for *security* — it just
  queries its local DB. Reactive `useQuery(sql)` re-runs on any sync push or local write.
- **Writes** go local-SQLite (optimistic) → upload queue → `POST /sync/upload` → authz/validate → Postgres.
- **Server-initiated push:** *any* write that hits Postgres — a Stripe/Interac webhook, a cron job, another
  staff member's action — flows back out via the WAL automatically, sub-second, to the relevant devices.
- **Conflicts** are server-authoritative: benign concurrent field edits are last-write-wins by `updated_at`;
  the backend rejects/transforms invariant violations (no double-booking, no paying a paid invoice). Money
  creation is backend/webhook-only, so it never originates as an offline client write.

### `/sync/token` + JWKS (`sync/auth.py`)
Exchanges the app JWT for a short-lived PowerSync token; serves the RS256 JWKS at `/sync/keys`. In dev an
unauthenticated call mints a token for `dev_user_id` (HS256); prod requires a valid JWT (RS256 +
`POWERSYNC_USE_RS256=true`, `powersync.yaml` `jwks_uri` → `/sync/keys`).

### The write path — `WRITE_POLICY` (`sync/upload.py`)
The server-authoritative write choke point. `WRITE_POLICY` is an allowlist mapping **table → (min_tier,
own_only)**. Only low-risk, client-owned tables are sync-writable:
- **team-writable** (any active staff): `clients` · `subjects` · `notes` · `messages`, and (own-only)
  `availability`.
- **admin-writable** (owner/admin): `items` · `resources` · `forms` · `form_fields` · `contracts`.
- **not sync-writable** (server-only invariant): everything money/capacity/secret/uniqueness — `payments`,
  `payouts`, `gift_cards`, `subscriptions`, `packages`, `sessions`/`bookings`/`schedules`, `invoices`/
  `estimates`/`orders`/`lines`, `threads`, `broadcasts`, `businesses`, `staff`, `reviews`, files, audit/
  webhook logs → each replaced by a `/v1` command.

Per op: resolve the actor's active `staff` rows → look up policy (unknown table → 403) → block cross-tenant
`business_id` change → role + ownership authz → strip `SYSTEM_FIELDS` + per-table `COMMAND_ONLY_FIELDS`
(e.g. `clients.stripe_customer_id`/`lifetime_value_cents`) → apply (PUT = `on_conflict` upsert, PATCH =
partial, DELETE = soft-delete where the column exists), coercing SQLite types back to Postgres. The whole
batch commits as one transaction; any auth failure rolls it all back.

### The client (`packages/sync`)
`schema.ts` is the **generated** `AppSchema` (the synced tables, from models + sync-rules). `connector.ts`
is the `PowerSyncBackendConnector`: `fetchCredentials()` → `GET /sync/token`, `uploadData()` drains the
local CRUD queue → `POST /sync/upload`. Server-only tables (`auth_*`) are absent from sync-rules, so they
never reach the client schema.

---

## Authorization & visibility

Reads and writes are authorized by **different** mechanisms. The sync stream reads the WAL and *bypasses*
Postgres RLS, so read policy lives in the **Sync Rules**, not the DB. Writes are authorized in FastAPI.

### User tiers & provider roles
| Tier | Modeled as | Scope |
|---|---|---|
| **Provider team** | `staff.role` on a `users` row | their business(es), role-scoped |
| **Client** | `clients.user_id` (optional, future portal) | only their own relationship with a business |
| **Platform admin** | Clientbridge-internal | cross-tenant (out of this model) |

Provider roles (`staff.role`): **owner** (everything incl. billing/ownership) · **admin** (all except
billing/ownership) · **staff** (own work only, no financials) · **contractor** (own work + own earnings;
currently same perms as staff).

### Visibility — the employee model (default)
| Data | owner / admin | staff |
|---|---|---|
| Own calendar (sessions/bookings/availability) | ✅ all members | ✅ own only |
| Shared client book (clients, subjects, docs, catalog) | ✅ | ✅ |
| Own earnings (`payout_allocations` where member = me) | ✅ all | ✅ own |
| Financials (invoices, payments, payouts, others' pay) | ✅ | ❌ |
| Inbox / broadcasts / reviews / activity log | ✅ | ❌ |
| Settings / billing / staff management | owner (+ admin ops) | ❌ |

### Enforcement — the sync buckets (`infra/powersync/sync-rules.yaml`)
Three buckets implement the read model (owner-sees-workers'-activity is carried by three columns —
`bookings.staff_id`, `payout_allocations.staff_id`, `audit_logs.actor_user_id` — no new entities):
- **`business_shared`** (every active member) — reference data + the shared client book + client docs.
- **`staff_self`** (per staff, sliced by `staff_id`) — a member's **own** sessions/bookings/availability/
  schedules/payout_allocations.
- **`business_full`** (owner/admin only) — **all** members' work + all financials + inbox + `audit_logs`.

Device read scope: staff = `business_shared` + `staff_self` · owner/admin = those + `business_full`. Writes
are authorized separately in `/sync/upload` (`WRITE_POLICY`). Postgres RLS is an optional future
defense-in-depth for the API, not the sync filter.

---

## Domain models

### Payments — Stripe Connect custody, no ledger
- **Stripe Connect** (Custom accounts, direct charges + application fee) — cards, Tap-to-Pay/Terminal,
  saved cards, deposits, refunds, subscriptions, KYC mirror via `account.updated`.
- **Interac e-Transfer** — request + **auto-match by reference code** (the wedge).
- **PAD/EFT** — pre-authorized debit for recurring.
- **No platform-held funds / no general ledger.** Stripe Connect custodies each provider's balance and pays
  out to their linked bank on a schedule; the platform never transmits funds (avoids money-transmitter
  licensing). We **record** `payments` (fee/net/status) and **mirror** Stripe `payouts` via webhook.
  "GST/HST set aside" is a computed remittance figure (tax on collected invoices), not segregated cash.
- Retry-safe `open_*` builders (card/booking-deposit/entitlement/terminal/interac) are Stripe-idempotency-
  keyed + `provider_ref`-deduped, shared by the authed services and the public surfaces. Refunds guard
  over-refund (block a partly-redeemed gift card / a package with sessions used) and reverse the payout
  allocation + entitlement.

### Tax
GST/HST/PST/QST computed per **province** at the **line level** (QST at exact 9.975%, half-up rounding).
The business stores registration numbers; small-supplier mode (`is_tax_registered=false`) collects nothing.
The engine (`services/tax_service.py`) is pure and golden-tested; rates are hardcoded per province in
`services/tax_rates.py` (no table).

### Auth
Owners/staff: **email + password (Argon2) + Google OAuth**. Sessions are **JWT access + stateful refresh**
(`auth_sessions` families — rotation swaps the token hash; reuse of a rotated token revokes the whole
family). Reset/verify use single-use, expiring `auth_tokens`. Clients **book without an account** (name/
phone/email on the public page); a future portal links a client to a login via `clients.user_id`.

---

## Frontend architecture — share the view-model

**All product logic lives in `@clientbridge/app-core`; each app is a thin rendering + platform-binding
layer.** Only four things differ per platform:

| Seam | web | mobile |
|---|---|---|
| **SQLite driver** | `@powersync/web` (OPFS + wa-sqlite, COOP/COEP) | `@powersync/op-sqlite` (native) |
| **Token store** | localStorage (sync) + Web-Locks refresh | expo-secure-store (async), single-instance |
| **Config source** | `import.meta.env` (Vite) | `Constants.expoConfig.extra` |
| **Rendering** | DOM + Tailwind | RN + StyleSheet from the token theme |

Everything else — SQL, mutations, validation, status→`Intent` decisions, copy, icon geometry — is shared.

### `app-core` (the view-model layer, no JSX)
- **Reads** = a `useX()` hook wrapping `useQuery` over a SQL constant against the local replica.
- **Writes** = plain functions taking `(api: ApiLike, …)` (money/uniqueness attach an idempotency key). A
  few invariant-free admin tables write **directly** to local SQLite (availability/form-builder/contract-
  draft), uploaded via `/sync/upload`.
- **Forms** = `useXForm` hooks on the `useAsyncAction` busy/error primitive.
- Each domain exports a status→`Intent` mapper (the platform maps `Intent` → its own tokens).
- **`strings.ts`** is the copy catalog (one object, ~35 domain groups) — the single home of UI copy.
  **`icons.ts`** is icon geometry as data (rendered `<svg>` on web, `react-native-svg` on mobile).
- **Two entrypoints:** `index.ts` (full) and **`public.ts`** — the PowerSync-free lean subpath the Connect
  app imports.

### Connect — the customer app (PowerSync-free, embeddable)
The public surfaces (book/pay/form/contract/review + a per-business landing) live in their own lean Vite app
(`apps/connect`, :8709) that imports **only** `@clientbridge/app-core/public` — no PowerSync, no api-client.
Each `public*` domain is a `createPublicXClient(baseUrl)` factory doing plain `fetch` against token/slug-
authed endpoints (the URL is the only credential). `apps/connect/public/embed.js` is the host-side iframe
loader — custom elements (`<connect-booking|pay|…>`) that mount the widget with a `postMessage` resize +
success protocol. The lean-bundle boundary is **enforced by lint**: `no-restricted-imports` bans `@powersync/*`
from Connect and `app-core/public`.

---

## The three bridges (Python ↔ TS — generate, don't share)

No source is shared between the ecosystems. Everything that must agree is **generated** from a single
source, with a **CI drift gate** that fails if the committed output diverges.

| Bridge | Source of truth | Generated into | Command |
|---|---|---|---|
| **Sync schema** | SQLAlchemy models + `sync-rules.yaml` | `packages/sync/src/schema.ts` | `make gen-sync-schema` |
| **API client** | FastAPI OpenAPI | `packages/api-client/src/generated.ts` | `make gen-api` |
| **Design tokens** | `.docs/design/app-explorer.html` | `packages/tokens/src/themes.{ts,css}` | `make gen-themes` |

`api-client`'s `session.ts` owns transparent token refresh (single-flight, retries once on 401, refreshes
only on a definitive 401/403 so a network blip doesn't wipe the replica) and injects the token-store seam.
`tokens` feeds both platforms from one source: web via CSS variables + a Tailwind preset, mobile via
materialized JS values.

> A browsable visual companion to this document lives at [codebase-atlas.html](codebase-atlas.html).
