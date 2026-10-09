# Clientbridge — Architecture

The canonical description of **how the system is built**: stack, structure, the data model, sync, and
authorization. For *how we build it* (the gate, testing, conventions) see [engineering.md](engineering.md);
for *what's left* see the launch stories and the after-launch list in
[launch-readiness.md](launch-readiness.md); for design/IA see [design/](design/).

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
| Offline sync | **PowerSync** — on-device SQLite (web WASM on IndexedDB · Expo op-sqlite), WAL server-push, per-business Sync Rules; writes through FastAPI |
| Payments | **Stripe Connect** (Custom accounts, direct charges) + **Interac e-Transfer** + PAD/EFT |
| Repo | **Polyglot monorepo** — backend (uv) + frontend (pnpm + turbo), one root Makefile |

The toolchain pins Python **3.14** (via `.python-version`) while ruff/mypy target 3.12 for
type/lint-compatibility. The `pyproject` floor is `>=3.12`.

---

## The 5 surfaces

**Every capability is exactly one of five surfaces. Choosing the surface is the main design decision per
feature.** The rule: a **server-only invariant** — uniqueness/numbering, capacity/conflict, money,
secrets, cross-tenant — must be a **command**, never unvalidated replica CRUD.

| # | Surface | What it is | Auth | Examples |
|---|---|---|---|---|
| 1 | **Sync-read** | PowerSync streams each device its authorized rows into local SQLite | Sync Rules (buckets) | calendar, clients, invoices on-device |
| 2 | **Offline command** | Local-only durable intent → typed `/v1` command → authoritative replication | JWT + service role/tenant checks + expected revision | edit working hours |
| 3 | **Command / RPC** | FastAPI `POST/PATCH/DELETE` under `/v1/*`, wrapped in `run_command` (atomic + audited + idempotent) → writes Postgres → flows back via sync | JWT + role | book a slot, issue an invoice, take a payment |
| 4 | **Webhook / public** | inbound provider callbacks + unauthenticated public pages | signature / token / slug | Stripe/Interac/SMS webhooks; book/pay/form/contract/review |
| 5 | **Job** | arq background work on Redis | system | reminders, reap-unpaid, broadcasts, overdue sweep |

**Decision rule** — where does a new operation go?
- An edit must survive offline use → **offline command (2)** with explicit replay, conflict and recovery semantics.
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
│   ├── migrations/versions/    Alembic (one baseline + linear increments)
│   ├── scripts/                seed_demo · gen_sync_schema · export_openapi
│   ├── tests/                  integration suite + contract/ + e2e/
│   └── src/clientbridge/
│       ├── main.py             FastAPI app factory (ASGI entry)
│       ├── core/               command · scoping · deps · config · security · db · errors · ids · ratelimit
│       ├── models/             SQLAlchemy — one file per domain (+ auth, base)
│       ├── schemas/            Pydantic DTOs — one file per concept
│       ├── services/           business logic — one file per concept (28)
│       ├── api/                router.py (mounts /v1) · one router file per concept · public.py · webhooks.py
│       ├── sync/               auth.py (token/JWKS)
│       ├── integrations/       stripe · postmark · twilio · expo · google · s3 (provider adapters)
│       └── tasks/              worker.py: the arq cron schedule
├── frontend/           ── TypeScript · pnpm + turbo ──
│   ├── apps/
│   │   ├── web/        React + Vite · provider/admin · :8700
│   │   ├── mobile/     Expo RN · provider/admin · :8707
│   │   ├── connect/    public customer app · PowerSync-free · :8709
│   │   ├── site/       marketing site · static prerender · :8710
│   │   └── playground/ shared component playground · web + phones · :8712 (not deployed)
│   └── packages/
│       ├── app-core/   shared view-model hooks + strings + icons + UI prop contracts (ui.ts)
│       ├── ui/         shared components: src/web (DOM, web + Connect) · src/mobile (React Native)
│       ├── sync/       PowerSync AppSchema + backend connector
│       ├── api-client/ generated OpenAPI types + session (refresh/sign-out)
│       ├── tokens/     Pewter design system → Tailwind theme + RN theme
│       └── config/     shared eslint/prettier + the no-inline-ui-string rule
├── infra/powersync/    powersync.yaml (service config) · sync-rules.yaml (read authz)
└── .docs/              architecture · engineering · launch-readiness · design/
```

---

## Backend — layer-first, one file per concept

Flow: **`api` (thin router, never queries) → `schemas` (DTOs) → `services` (logic, owns the transaction) →
`models`.** `models/` is grouped by domain, because tables cluster that way (eleven domains: `business · clients ·
catalog · scheduling · billing · payments · ledger · messaging · documents · reviews · platform`). Every other
layer holds one file per concept, with the same plain plural name in each layer and no suffix:
`api/bookings.py` → `schemas/bookings.py` → `services/bookings.py`, including its job bodies (`run_reminders`). A
concept with no API or DTOs simply has no file in that layer (`services/lines.py`). Closely related
concepts share one umbrella file: `entitlements` holds packages, subscriptions and gift cards (prepaid
things sold through their own checkout and held as a liability), and `bookings` holds working hours,
open slots and recurring series. Their tables stay separate.

### The request flow
```
HTTP → api/…  → schemas/ (DTO)  → services/ (logic + txn)  → core/scoping · command  → models/  → Postgres  → WAL  → PowerSync  → device
```
Routers are thin: they resolve dependencies, construct a `Service(db, principal, …)`, call one method with
the validated DTO (threading the `Idempotency-Key` header for mutations), and return a response schema.
**All querying and the transaction live in the service.** A raised `AppError` renders as `{error, message}`
with the subclass's HTTP status.

### The cross-cutting core (`core/`)
| File | Responsibility |
|---|---|
| `command.py` | **The command wrapper.** `run_command(db, principal, *, action, run, response_model, idempotency_key)` — replays a stored response for a repeated key, stages `Command.record(...)` audit rows, then commits mutation + audit + idempotency key as **one atomic unit** (rollback on any error). Money/uniqueness/cross-tenant mutations go through it. |
| `scoping.py` | **The one place the tenant filter lives.** `scoped(Model, business_id, soft_delete=…)` + `scoped_update`/`scoped_delete`. Services **never** hand-write a `business_id` filter. |
| `deps.py` | DI hub — DB session, adapter aliases (`EmailDep`, `GatewayDep`, `StorageDep`…), the auth chain (`current_principal` re-derives business/role from the DB every request, honoring `X-Business-Id`), and role gates (`assert_role`, `is_manager`). |
| `config.py` | Pydantic-settings. **Fails closed in prod:** refuses to boot if the JWT secret is still the dev default or the Stripe webhook secret is empty when `env != dev`. |
| `security.py` | Argon2 password hashing · SHA-256 opaque-token hashing · HS256 access tokens · the PowerSync token (HS256 or RS256 + a JWKS endpoint for prod). |
| `ids.py` | Prefixed-ULID PKs (`bz_…`, `bk_…`), time-sortable. |
| `errors.py` | `AppError` taxonomy → HTTP status (`NotFound` 404, `Conflict` 409, `CardDeclined` 402, `TooManyRequests` 429…). |
| `ratelimit.py` | In-process fixed-window limiter for the five public surfaces (30/60s each). |
| `db.py` | Async engine + `SessionLocal` + the `Base` model metadata. |

### Role gates
A gate lives in the service method that does the work, via `assert_role(self.principal, …)`, because the
same services also run from jobs and public flows. Services whose every method is owner/admin (reports,
the dashboard) gate once in their constructor; others gate per method (POS order-create is staff, void is
admin). `is_manager(role)` covers the one place that holds a bare role string (service authorization). Never a
hand-written role tuple check.

### External services
Every external dependency is an **adapter interface (`typing.Protocol`) + a prod implementation + a `get_*()`
dependency** that tests override with a recording fake — so the boundary is covered without the network.
Six adapters in `integrations/`, one per provider so they read apart from our own services:
`stripe.py` (Stripe Connect + Terminal), `postmark.py` (email), `twilio.py` (SMS), `expo.py` (push), `google.py`
(Google sign-in), `s3.py` (S3; RustFS locally).

### Jobs (`tasks/`)
`tasks/worker.py` is the schedule only: one-line arq cron wrappers that open a session and call a `run_*`
function in the concept's service. Reminders and due broadcasts every 15m, reap-unpaid every 15m,
entitlement expiry and device pruning 03:30, ledger reconciliation 04:00, overdue sweep 07:00, review
requests 08:00. Jobs aren't tenant-scoped: each row resolves its own business and locale, and each is
idempotent via a status or timestamp marker.

---

## The data model

**41 tables**: **39 across the 11 domains** plus **2 server-only auth-infra** tables (`sessions`,
`tokens`). Stripe Connect custodies funds and pays out; a double-entry ledger (`accounts` + `entries`)
records every money movement and is the only place money balances are stored. The SQLAlchemy models in
`backend/src/clientbridge/models/` are the exact-DDL source of truth; the migrations in
`migrations/versions/` start from one baseline (squashed before launch) with increments after it.

### Conventions
- **PKs:** prefixed-ULID strings, minted in-app (`core/ids.new_id`) — sortable, safe to expose, debuggable.
- **Tenancy:** `business_id` (indexed) on every business-scoped row. `businesses` is the top entity
  (business/location **and** billing entity). `users` are global
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
Prefixes predate the table renames and are kept so existing ids stay valid; the table each one lands in is
shown after it.
`bz_`businesses `us_`users `st_`staff · `cl_`clients `sj_`subjects `nt_`notes · `it_`items `pkg_`packages
`sub_`subscriptions `gc_`gift_cards `stk_`inventory · `ses_`slots `bk_`bookings `bka_`addons `av_`hours
`rs_`resources `sch_`recurrences · `inv_`invoices `est_`estimates `ord_`orders `ln_`lines · `pay_`payments
`pm_`payment_methods `acc_`accounts `ent_`entries `jrn_`journal · `th_`threads `msg_`messages `bro_`broadcasts
· `frm_`forms `ff_`fields `fr_`responses `con_`contracts `sig_`signatures · `rv_`reviews (requests merged in from the old `review_requests` keep `rvr_`)
· `fl_`files `aud_`audits `wh_`webhooks `dvt_`devices `idk_`commands `ase_`sessions `atk_`tokens

### Tables by domain

**business (3)** — `businesses` (all Stripe-Connect/KYC mirror fields + Canadian tax fields + `slug` + brand
JSONB), `users` (global login, `email` unique, `oauth`), `staff` (user↔business, `role`
owner/admin/staff/contractor, payout config `payee`/`rate_type` with the rate in `rate_bps` (percent) or
`rate_cents` (fixed or hourly), one membership per user per business, pending invites via
`status=invited` + hashed `invite_token`).

**clients (3)** — `clients` *(soft-del)* (`tags[]`, `status`, `custom_fields`, `stripe_customer_id`), `subjects` (pet/vehicle/child/property, `attributes` JSONB), `notes` (polymorphic
`parent_type`/`parent_id` over client/subject/booking, `created_by`).

**catalog (5)** — `items` (**one table drives the whole catalog** via `kind` service/class/product/package/
subscription/gift — duration, capacity, deposit, recurrence, session_count, `stripe_price_id`), `packages`
(client's package: `sessions_total` and status; sessions used is the count of its consumption journals), `subscriptions` (recurring: status, period,
`provider_ref`; partial-unique one active/paused per client+item), `gift_cards` (`code` unique per business,
`initial_cents`; the spendable balance is the card's own ledger account, and an active card with nothing
left reads as redeemed), `inventory` (one signed stock movement per row, `reason` sale/refund/restock, keyed
by line and reason; `items.stock_on_hand` is the running total).

**scheduling (6)** — `slots` (the calendar event: capacity-bearing block; appointment = capacity 1, class
= capacity N; seats taken are counted from its live bookings; `recurrence_id`), `bookings` *(soft-del)* (client↔slot via `slot_id`; denormalized
`staff_id`; status pending→confirmed→completed/canceled/no_show, or waitlisted on a full class until a seat is given; `source`; deposit terms (the deposit's
state is derived from the ledger, and a deposit is due when `deposit_amount_cents > 0`); `reminded_at`),
`hours` (per-staff working hours: `basis` recurring weekday or one-off date, `available`; `basis`
exception is time off for one member, or a closure for everyone when `staff_id` is null, with
`starts_at`/`ends_at` and a `reason`, written only through `/v1/time-off`), `resources`
(`category` room/station/equipment, `capacity`, and `active`, which keeps existing bookings but offers it for no new ones), `recurrences` (recurrence rule with `frequency` day/week/month, the same words
items use, and `monthly_by` date or weekday → expands to slots/bookings; dates can be skipped or shifted
when booking, and `PATCH /v1/recurrences/{id}` moves one, the following or all upcoming visits while
`/cancel` ends the series and refunds paid deposits), `addons` (products a client added to a visit when booking; they join
the visit's invoice).

**billing (4)** — `invoices` (per-business unique `number`, stored status draft/sent/void, document totals
subtotal/tax/total fixed at issue, `pay_token`, `overdue_notified_at`; what is owed is the invoice's
receivable in the ledger, and partial/paid/refunded/overdue and the paid time are read from it, through
`ledger.invoice_status_expr()` on the server and `invoiceStatusSql` on the device), `estimates`
(accept/decline/convert → invoice; a sent estimate past `valid_until` reads as expired), `orders`
(POS/Terminal sale; stored status open/void, paid/refunded read from the ledger the same way),
`lines` (three nullable foreign keys `estimate_id`/`invoice_id`/`order_id` with a CHECK that exactly one
is set; `item_id`/`booking_id`, `tax_amount_cents`).

**payments (2)** — `payments` (payment attempts and Stripe objects: `kind` payment/deposit/refund; status;
unique `provider_ref` = one row per Stripe object; one-refund-per-payment; Interac `reference_code`; a
refund always has `parent_payment_id`, and a payment targets at most one invoice or one order),
`payment_methods` (saved card/PAD, `method` card/bank_eft/interac, the same spelling as `payments.method`;
`preferred` marks the card charged off-session).

**ledger (2)** — `accounts` (one per owner × category × code × currency: owners are a business, client, staff
member, the platform, a gift card or a package; categories are cash (`stripe`/`bank`/`cash`), `receivable`,
liabilities (`tax` per GST/HST/PST/QST code, `gift_card`, `deposit`, `deferred`, `payable` per
pending/approved stage), income (`revenue`, `fee_revenue`) and expenses (`processing_fee`, `platform_fee`,
`staff_cost`); a cached `balance_cents`), `entries` (append-only legs grouped by `journal_id`; signed
`amount_cents`, debit positive; `event` = what happened; `source_*` = what caused it; `subject_*` = the entity it
belongs to; `ref` + `leg` unique = idempotency; the account's owner is copied on for sync slicing).

**messaging (3)** — `threads` (unique per business+client+channel; the last message time and the unread
count, inbound messages not yet `read`, are read from `messages`), `messages` (direction in/out,
`broadcast_id`, `attachments`), `broadcasts` (audience JSONB + `scheduled_at`).

**documents (5)** — `forms`, `fields` (`input` is one of 17 field types), `responses` (public-link token,
`answers` JSONB), `contracts` (template), `signatures` (public-link token; snapshots `signed_body` + captures
`ip`; links a signature image file).

**reviews (1)** — `reviews` (one row per review from request to moderation: status
requested → opened → submitted → published/hidden; `channel` and the unique public-link `token` when a
request was sent, `requested_at`/`submitted_at`; `rating` 1–5 and `body` stay null until submitted, with a
CHECK that a submitted review has a rating; partial-unique one open request per booking; `sent_to_google`;
the apps compute the published average from the synced rows). A review submitted on the public page is
published straight away unless its rating is at or below the business's `review_hold_at`, in which case it
waits as `submitted` until the owner publishes or hides it.

**platform (5)** — `files` (S3 key, `purpose` logo/image/photo/signature/attachment), `audits` (append-only
activity feed; server-only), `webhooks` (inbound provider events, `event` = the provider's event name;
**not** business-scoped — routed during processing; server-only), `devices` (Expo push tokens), `commands`
(unique per business+scope+key — backs `run_command` replay; server-only).

**auth-infra (2, server-only, excluded from sync)** — `sessions` (refresh-token families; rotation
swaps the hash, replay revokes the family), `tokens` (single-use reset/verify tokens).

> **Note on tax:** there is **no `tax_rates` table** (dropped). Rates are hardcoded per province in
> `services/tax.py` and derived from `businesses.province`; the tax engine (also `services/tax.py`)
> is pure and golden-tested. See *Tax* below.

### Polymorphic patterns
`lines` one FK per document (estimate/invoice/order, exactly one set) · `payments` nullable over invoice/booking/order + `kind`/
`method`/`reference_code` · `items.kind` = whole catalog · `slots` = every calendar block · `staff` = staff +
invites · `entries.subject_type`/`source_type` = any money event on any entity · `notes`/`files`/`responses`/
`signatures` `parent_type` and `audits.entity_type` generalize the rest. `kind` is used only on `items`,
`payments` and `subjects`; other discriminators carry a name that says what they mean (`hours.basis`,
`fields.input`, `payment_methods.method`, `entries.event`, `webhooks.event`, `accounts.category`,
`resources.category`, `files.purpose`).

> **Why this shape:** the model is a pragmatic "mostly-lean" blend chosen over an option-by-option review —
> maximally consolidated (shared `lines`/`payments` across documents, one `items(kind)`, one `slots` for 1:1 + group)
> but split where lifecycles genuinely differ (packages vs subscriptions vs gift cards; forms vs contracts).
> A deliberately lean schema, with clarity kept exactly where money and lifecycles live.

---

## Sync (PowerSync)

**Engine: PowerSync**, self-hosted next to Postgres. Topology = **PowerSync reads the Postgres WAL
directly**; **writes always go through FastAPI** (server-authoritative). Chosen because it's the only engine
that delivers, for this stack, *all of*: real offline SQLite on **both** web (WASM) and Expo RN
(op-sqlite), WAL-driven server-initiated push, and per-business partial replication — with no Node and
minimal bespoke code. (ElectricSQL rejected: no offline SQLite on RN today. DIY rejected for v1: months of
build + permanent maintenance.)

```
 Expo (op-sqlite) ─┐                            ┌── logical replication (WAL) ──┐
 Web (WASM)        ─┤── WebSocket (read sync) ─► PowerSync Service ◄────────────┤ Postgres (source of truth)
       ▲ reads local SQLite (offline-first)      (Sync Rules bucket by           │
       │                                           business_id + role, from JWT)  │
       └── local-only hours outbox ─► FastAPI /v1/hours/{staff}/week─┘ writes
```

- **Reads** are governed by **Sync Rules** + JWT claims; FastAPI is *not* in the read loop. The on-device
  SQLite already holds only the rows this user may see, so the client never filters for *security* — it just
  queries its local DB. Reactive `useQuery(sql)` re-runs on any sync push or local write.
- **Hours writes** persist proposals separately from canonical rows in a local-only outbox. The typed week command validates authorization, seven weekdays and the expected revision atomically with its replay receipt. Other writes use their existing online commands.
- **Server-initiated push:** *any* write that hits Postgres — a Stripe/Interac webhook, a cron job, another
  staff member's action — flows back out via the WAL automatically, sub-second, to the relevant devices.
- **Hours conflicts** reject stale revisions and preserve the proposal for explicit review. The editor offers apply-again against a fresh revision or discard. Money creation remains backend/webhook-only.

### `/sync/token` + JWKS (`sync/auth.py`)
Exchanges an authenticated app JWT for a short-lived PowerSync token in every environment; serves the RS256 JWKS at `/sync/keys`. Development uses HS256. Production uses RS256 with `POWERSYNC_USE_RS256=true` and `powersync.yaml` `jwks_uri` pointing to `/sync/keys`.

### The hours write path
`POST /v1/hours/{staff_id}/week` is the single recurring-week mutation. Owners/admins may edit any active member in their business; other members may edit only themselves. Each operation includes a device/operation identity, business, creation time, expected revision and all seven weekdays. The service serializes replacement, keeps row IDs stable, increments `staff.hours_revision`, and commits the replay receipt with the write. The same identity and payload replay the original result; changed payloads or stale revisions fail. Existing split-day schedules are rejected for explicit review, never flattened silently.

### The client (`packages/sync`)
`schema.ts` is generated from explicit sync projections. The connector exchanges live session credentials at `/sync/token`; PowerSync downloads canonical data. `hours_outbox` and device preferences are local-only tables. The outbox coalesces unattempted changes, freezes attempted payloads, backs off transient failures, and blocks only successors of a rejected staff-week. Accepted proposals remain pending until their revision is observed in the replica. Pausing authentication cancels uploads without deleting intent; explicit discard clears the account-scoped replica.

Direct writes to synchronized tables are programming errors. There is no generic CRUD endpoint or old-client fallback. Receipts, sessions, commands, webhooks and audits remain server-only.

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
| Own calendar (slots/bookings/hours) | ✅ all members | ✅ own only |
| Shared client book (clients, catalog, forms, contracts, files) | ✅ | ✅ |
| Own earnings (their own `payable` account + entries) | ✅ all | ✅ own |
| Financials (invoices, payments, the ledger, others' pay) | ✅ | ❌ |
| Inbox: one-to-one messages | ✅ | ✅ |
| Broadcasts and reviews | ✅ | ❌ |
| Settings / billing / staff management | owner (+ admin ops) | ❌ |

### Enforcement — the sync buckets (`infra/powersync/sync-rules.yaml`)
Four buckets implement the read model (owner-sees-workers'-activity is carried by
`bookings.staff_id` and the ledger's `owner_type`/`owner_id`; the `audits` trail is server-only):
- **`business_shared`** (every active member): the catalog and entitlements, the client book, forms,
  fields, contracts, files, threads and messages.
- **`staff_limited`** (staff and contractors): the business row without its tax numbers and billing
  email, and the team without pay rates or payee flags. Owner/admin read both from `business_full` with
  more columns, so a row never reaches one device with two different column sets. No bucket syncs
  `invite_token` or the Stripe verification fields.
- **`staff_self`** (per staff, sliced by `staff_id`) — a member's **own** slots/bookings/addons/
  hours, plus their own staff `accounts` and `entries` (earnings).
- **`business_full`** (owner/admin only) — **all** members' work + all financials (including the whole
  ledger) + reviews.

`business_shared` also carries pets (`subjects`), `notes`, `resources` and closures (hours rows with no
`staff_id`), so every member's calendar can name the pet, the room and the day the business is shut;
`recurrences` follow their member like slots do. Tables no app reads yet (responses, signatures,
broadcasts) are not synced; each comes back with its story.

Device read scope: staff = `business_shared` + `staff_limited` + `staff_self` · owner/admin =
`business_shared` + `staff_self` + `business_full`. Writes
are authorized separately by typed services. Postgres RLS is an optional future
defense-in-depth for the API, not the sync filter.

---

## Domain models

### Public media
Business logos and catalog item images are `files` rows (`parent_type` business/item, `purpose` logo/image)
uploaded by an owner or admin. `GET /media/{file_id}` serves only those two kinds, by redirecting to a
short-lived presigned S3 URL, so they have stable links for the public pages and the apps. Every other
file stays behind auth. The brand stores `logo_file_id`; `public_brand` turns it into the media URL.

### Payments — Stripe Connect custody
- **Stripe Connect** (Custom accounts, direct charges + application fee, Stripe's automatic payouts) for
  cards, Tap-to-Pay/Terminal, saved cards, deposits, refunds, subscriptions, and the KYC mirror via
  `account.updated`.
- **Interac e-Transfer**: request + **auto-match by reference code** (the wedge).
- **PAD/EFT**: pre-authorized debit for recurring.
- **No platform-held funds.** Stripe Connect custodies each provider's balance and pays it out to their
  linked bank on Stripe's schedule; the platform never transmits funds (avoids money-transmitter licensing).
  `payments` records each attempt and Stripe object; the ledger records what each one did to the money.
- The Stripe API version is pinned (`STRIPE_API_VERSION` in `integrations/stripe.py`), and the Connect
  webhook endpoint must be created with that same version, because the handlers parse its payload shapes.
  Dashboard refunds arrive as `refund.created`/`refund.updated`, and a recurring invoice's PaymentIntent
  is looked up through its invoice payments.
- Retry-safe `open_*` builders (card/booking-deposit/entitlement/terminal/interac) are Stripe-idempotency-
  keyed + `provider_ref`-deduped, shared by the authed services and the public surfaces. A payment can be
  refunded in part, more than once, up to what is left; a gift card or package purchase, and a forfeited
  deposit, are refunded only in full (and not once the card is partly redeemed or a session is used).

### Ledger: double-entry, append-only (`services/ledger.py`)
Every money movement is a **journal**: two or more `entries` legs that sum to zero per currency. A
deferred constraint trigger rejects an unbalanced journal at commit and another trigger rejects any UPDATE
or DELETE, so corrections are always reversing journals (`ledger.reverse`). `ledger.post` is the only
writer: it is idempotent on `ref` (a Stripe object id or a natural key such as `invoice:{id}`), creates
accounts on first use, locks the affected account rows in id order, and updates their cached balances.

What posts, and where:

| Event | Hook | Legs |
|---|---|---|
| Invoice issued / voided | `billing.send_invoice` / `void_invoice` | client receivable + / revenue − / tax(code) − ; void reverses |
| Payment settled | `payments._settle_payment` (Stripe webhook), `match_interac`, recurring `invoice.payment_succeeded` | cash + / what it paid for −: invoice receivable, order revenue + tax, booking deposit, package deferred + tax, gift card liability |
| Fees | same, from the charge's balance transaction (`gateway.get_payment_fees`) | processing fee + / platform fee + / Stripe − ; platform Stripe + / fee revenue − |
| Refund (full or partial) | `refund_payment`, `charge.refunded` (one refund row per Stripe refund) | cash − / the original credit legs unwound pro rata (a credit note; fees stay with Stripe and the platform) |
| Dispute opened / won | `charge.dispute.created` / `.closed` | Stripe − / payer receivable + (+ dispute fee); won reverses |
| Stripe payout paid / failed | `payout.paid` / `payout.failed` | bank + / Stripe − ; failed reverses |
| Gift card redeemed | `entitlements.redeem_gift_card` | gift card liability + / revenue − |
| Package session used | `entitlements.consume_session` | deferred + / revenue − (the last session takes the remainder) |
| Gift card or package expired | `entitlements.run_expiry_sweeps` (`ledger.post_breakage`) | gift card liability or deferred + / revenue − (breakage on the unused balance) |
| Tax return filed | `POST /v1/payments/remittances` (`remittances`) | tax(code) + per code owed for the period / bank − ; the period is in the journal's `meta` |
| Deposit forfeited | no-show in `bookings` (or settlement after it) | deposit + / revenue − ; a refund un-forfeits first |
| Deposit applied | invoice sent with the booking on a line, or the deposit settling after that (`bookings.apply_deposit`) | deposit + / client receivable − ; a void or a refund of the deposit reverses it |
| Staff earning accrued / approved / paid | `earnings` (invoice fully paid, `/v1/earnings/approve`, `/v1/earnings/pay`) | staff cost + / payable(pending) − ; pending → approved ; approved → bank |

Derived from the ledger rather than stored: an invoice's and order's balance and amount paid, gift card
balances, package deferred revenue, client lifetime value, staff earnings and their status, tax payable per code, today's revenue, and Stripe
payouts. A booking's `deposit_status` (none/pending/collected/applied/forfeited/refunded) is a lifecycle column set
as the ledger books the deposit, because staff replicas do not sync the business ledger; the amount stays
in the ledger. Reports (income, GST/HST/PST/QST, T4A) and the dashboard read entries and account balances.
`ledger.run_reconcile_ledger` reconciles each connected account's ledger Stripe balance against Stripe's nightly
and records any drift in `audits`.

### Tax
GST/HST/PST/QST computed per **province** at the **line level** (QST at exact 9.975%, half-up rounding).
The business stores registration numbers; small-supplier mode (`tax_registered=false`) collects nothing.
The engine (`services/tax.py`) is pure and golden-tested; rates are hardcoded per province in the same
file (no table). Each item carries a tax class (`standard` charges every component,
`federal_only` only the GST or HST, `exempt` nothing), copied onto each line when it is created, so a later
change to the item does not alter issued documents. Which services carry PST in BC, Saskatchewan and
Manitoba still needs an accountant's confirmation before defaults are set.

### Selling products
Products are catalog items of kind `product` and sell through the same order, line, tax and ledger path as
services: point-of-sale orders (Tap to Pay on mobile, card on web through `POST /v1/orders/{id}/pay`),
invoice lines, the online shop and booking add-ons. Only services and classes can be booked online; gift
cards, packages and subscriptions are refused as plain lines and sell through their own checkout so the
entitlement and its liability are created.
- **Stock** is optional per product (`track_stock`, `stock_on_hand`, `low_stock_at`). Every change is a row
  in `inventory` (sale, refund, restock) keyed by line and reason, so a repeated webhook can't move
  stock twice; `stock_on_hand` is the cached total. Selling below zero is allowed at the till; the online
  shop refuses an order larger than the stock.
- **Retail commission:** a paid sale accrues an earning for its staff member at `staff.retail_rate_bps` on the
  product lines before tax, using the same earning journals as bookings.
- **Online shop:** products marked `sell_online` are listed at `/shop/<slug>` on Connect. An order is paid by
  card, has `source = online`, and moves through `pickup_status` (unfulfilled, ready, picked up) from Sales.
- **Booking add-ons:** products the owner offers at booking (`items.addon`, with `addon_for` naming the
  services each goes with) and the client chose on the booking page are stored in `addons` and become lines
  on the invoice created from the booking (`POST /v1/invoices/from-booking/{id}`); only the deposit is
  charged at booking time.
- **Receipts** list every line with its tax, and walk-in sales can take an email or phone for the receipt.
  Sales by item is a report with a CSV like the others.

### Online booking and manage links
The rules the public booking page follows (lead time, how far ahead, the start-time step, approval for new
clients) and the cancellation policy live in `businesses.booking_policy`, read and written through
`/v1/online-booking`; members are hidden from the page with `staff.bookable_online`. Every booking gets a
`manage_token`, and the confirmation and reminder carry `/m/<token>` on Connect, where the client can move
or cancel within the cut-offs (`/manage/{token}`). The server enforces the cut-offs and the move limit and
refunds a paid deposit on an allowed cancel.

### Auth
Owners/staff: **email + password (Argon2) + Google OAuth**. Sessions are **JWT access + stateful refresh**
(`sessions` families — rotation swaps the token hash; reuse of a rotated token revokes the whole
family). Reset/verify use single-use, expiring `tokens`. Clients **book without an account** (name/
phone/email on the public page); a future portal links a client to a login via `clients.user_id`.

---

## Frontend architecture — share the view-model

**All product logic lives in `@clientbridge/app-core`; each app is a thin rendering + platform-binding
layer.** Only four things differ per platform:

| Seam | web | mobile |
|---|---|---|
| **SQLite driver** | `@powersync/web` (wa-sqlite on IndexedDB; no cross-origin isolation, so Stripe.js loads) | `@powersync/op-sqlite` (native) |
| **Token store** | localStorage (sync) + Web-Locks refresh | expo-secure-store (async), single-instance |
| **Config source** | `import.meta.env` (Vite) | `Constants.expoConfig.extra` |
| **Rendering** | DOM + Tailwind | RN + StyleSheet from the token theme |

Everything else — SQL, mutations, validation, status→`Intent` decisions, copy, icon geometry — is shared.

### `app-core` (the view-model layer, no JSX)
- **Reads** = a `useX()` hook wrapping `useQuery` over a SQL constant against the local replica.
- **Writes** = plain functions taking `(api: ApiLike, …)` (money/uniqueness attach an idempotency key). Hours proposals use the durable local-only outbox; form and contract edits use their typed online commands.
- **Forms** = `useXForm` hooks on the `useAsyncAction` busy/error primitive.
- Each domain exports a status→`Intent` mapper (the platform maps `Intent` → its own tokens).
- **`strings.ts`** is the copy catalog (one object, a group per concept) — the single home of UI copy.
  **`icons.ts`** is icon geometry as data (rendered `<svg>` on web, `react-native-svg` on mobile).
- **Layout:** one file per concept in `domain/` (`today`, `hours`, `earnings`, `gettingPaid`, `auth`…),
  named the same as its strings group, web page and mobile screen; the shared plumbing sits flat at the
  root (`api`, `hooks`, `format`, `datetime`, `ui`, `debug`). `packages/config/scripts/check-structure.mjs`
  in `pnpm lint` fails when a concept's names drift apart or a package export is used only in its own
  file, and knip fails on unused files, dependencies and exports. Related things share one concept:
  `entitlements` holds packages, memberships and gift cards, and `business` holds the profile and
  onboarding. A page named by its nav label maps to its concept (Invoices → billing, Inbox → messaging,
  Team → staff, Schedule → bookings, Gift cards → entitlements, Onboarding → business).
- **Two entrypoints:** `index.ts` (full) and **`public.ts`** — the PowerSync-free lean subpath the Connect
  app imports.
- **One checkout.** Every sale (deposit, gift card, package, subscription) runs through `useCheckout`
  (saved card or new card, one idempotency key per attempt), and saving a card through
  `useAddPaymentMethod`. Only chargeable saved methods are offered (`checkoutMethods`): cards, and bank
  accounts with an active mandate. Bank (PAD) entry is web only for now.

### Navigation
Both apps show the same five destinations from `domain/navigation.ts`: Today, Schedule, Clients, Payments
and Inbox, plus Setup. Web renders them as a sidebar and mobile as a tab bar with a create button, with
Inbox and Setup as icons in the header. Payments is one page with tabs (Invoices, Sales, Gift cards, Staff
pay, Reports); staff see only Sales, because every invoice, gift card, earning and report action is owner or
admin on the backend. Inbox has Messages and Reviews (Reviews for owners and admins). Setup has Business,
Services & products, Team & hours, Getting paid and Online booking (web only); staff see only Team & hours
and can edit only their own hours. The visibility rules (`visiblePaymentsTabs`, `setupSectionsFor`,
`editableStaff`, `canVoidSale`) live in app-core so both apps gate the same way.

### Shared components
A screen composes shared components and never re-implements a list, a detail view, a modal, a checkout or
a card form. The prop contracts are types in `app-core/src/ui.ts`, and each platform implements them once,
side by side in one package: `@clientbridge/ui/src/web/` (DOM and Tailwind, used by web and Connect, imports
only `app-core/public`) and `@clientbridge/ui/src/mobile/` (React Native), with the same file name for the
same component. Every app imports `@clientbridge/ui`; the package's `react-native` export condition resolves
mobile (Metro and the mobile tsconfig's `customConditions`) to the native entry, and everything else to the web
entry. ESLint keeps React Native out of `src/web` and the DOM out of `src/mobile`, and the structure check
requires a twin on the other platform and a playground story for every component file. It also fails on a
hand-styled control in app code (a raw `<button>`, `<input>`, `<select>` or `<textarea>` with a `className`, or a
`Pressable` or `TextInput` with local styles) outside a short allowlist of layout-specific files. Each platform
still renders idiomatically, so this is two implementations in one place, not a cross-platform UI framework.
Component copy lives in `strings.ui`, glyphs in `app-core/icons.ts` (`Icon` draws them on both platforms), and
colours only in `@clientbridge/tokens` (`INTENT_COLORS`, `tint`/`tintHex` for data colours, `ON_DATA` and
`SHADOW`).

Props follow one vocabulary, so a caller can guess a prop without opening the file:

| Prop | Meaning |
|---|---|
| `variant` | the visual form of one component (`Button` primary or outline, `Empty` inline or card, `ItemTile` tile or card) |
| `layout` | how a set of items is arranged (`Choice` chips, segmented, cards or tiles; `KeyValueList` inline or stack) |
| `size`, `density` | physical scale (`sm` to `xl`), and spacing or how much is shown (`compact`, `regular`, `full`) |
| `intent` | a status colour from `INTENT_COLORS` (`accent`, `success`, `warning`, `danger`, `neutral`) |
| `tone` | the text colour of a figure or a message (`Money`, `Stat`, `Notice`) |
| `label` | the accessible name; required when the component shows no text of its own |
| `value`, `defaultValue`, `onChange` | controlled when `value` is passed, otherwise the component keeps its own state (`useControllable`) |
| `onPress`, `selected`, `pressed`, `disabled`, `busy` | activation and state, the same words on both platforms |
| `children`, `leading`, `trailing`, `actions`, `footer`, `icon` | slots for composition, used instead of boolean flags |
| `className` (web), `style` (mobile) | an escape hatch for spacing and width, merged last |
| `ref` | on focusable controls (`Button`, `IconButton`, `SearchField`, `Checkbox`, `ListRow`), as a React 19 prop |

| Component | What it is |
|---|---|
| `ActionMenu` | a menu of actions with glyphs: a popover with arrow-key focus on web, a bottom sheet on mobile |
| `ActivityTimeline` | what happened to a record, newest last, with optional glyphs, quotes and amounts |
| `Avatar` | a person's or pet's initials on the accent tint or their own colour |
| `Badge`, `StatusPill` | a pill or a count, and a status pill, coloured from `INTENT_COLORS` |
| `BarChart` | one series of bars over time, with partial and out-of-period bars |
| `BrandMark` | the small mark beside a saved card or bank account |
| `Button`, `IconButton` | primary, outline, quiet, danger and link buttons with a glyph and a busy state; an icon-only button with a count or dot |
| `CalendarEventCard` | a visit on the calendar: status fill, service swatch, flags and drag states |
| `ChargeSheet`, `CardForm`, `PaymentMethodForm` | the checkout and card or bank entry; the Stripe account comes from `setStripeAccount` |
| `Checkbox`, `Checklist` | a checkbox with a mixed state; a list of steps with done, attention and an action |
| `Choice` | chips, a segmented control, option cards or tiles, for one or several values |
| `ContractDocument`, `SignaturePad` | a contract laid out as the printed page with its signature block; a pad that records strokes |
| `ConversationRow`, `MessageBubble` | a conversation in the inbox list; one message or a system line in a thread |
| `CopyField` | a link, snippet or reference to hand out, with a copy action that confirms in place |
| `DateStrip`, `TimeSlotPicker` | a week of dates with busy dots and closed days; open times grouped by part of the day |
| `DetailView`, `DetailSection` | a right-side panel on web, a bottom sheet on mobile, with sections and an action row |
| `DocTotals`, `PrintedDocument`, `PayCode` | a document's money summary; an invoice, estimate or receipt as the client gets it; a scannable code for a pay link |
| `DurationBar` | how a booking blocks time with its buffers |
| `Empty`, `Loading`, `Skeleton`, `SyncBanner` | empty and failed states with next steps, loading text, placeholders while data loads, and offline or sync status |
| `Field`, `TextField`, `Select`, `Toggle`, `SearchField`, `TagInput` | labelled controls with hint and error; search with a clear button and result keys; tags with suggestions |
| `FormQuestion` | one form question, shared by the builder preview and the client's form |
| `Icon`, `GoogleIcon`, `Logo`, `Lockup` | glyphs from `app-core/icons.ts`, Google's mark, and the logo with and without the wordmark |
| `ImagePicker`, `ItemImage`, `ItemTile` | an item's photo with change and remove; its picture or initial; a tile or card to tap in a register or shop |
| `KeyValueList` | labelled facts, inline or stacked in columns |
| `LineItem` | one line of a sale with quantity, discount, tag and remove |
| `ListPage`, `ListRow`, `OccurrenceList` | a list page with segments, search and rows; one row with a glyph or leading slot; the dates of a series with clashes |
| `Meter`, `ProgressSteps`, `RatingDistribution` | how much of something is used; where a flow is; how ratings spread |
| `Modal`, `confirm()` / `ConfirmHost` | a dialog (bottom sheet on mobile); a yes/no question, the system alert on mobile |
| `Money`, `Stat`, `Stars`, `Stepper` | amounts, a labelled figure, a rating to show or pick, and a quantity control |
| `Notice` | a danger, success or info line, or a filled box |
| `PageHeader`, `Panel`, `Tabs` | a page title with actions and tabs; a card with a title; an underline or pill tab row |
| `SwatchPicker`, `WeeklyHoursEditor` | a colour picker; one person's regular week with open days and times |

### The playground
`apps/playground` (`make dev-playground`, http://localhost:8712) renders every shared component from the real
package: the web component directly, and the mobile component through react-native-web inside an iPhone and an
Android frame side by side. There is one page per component file, built from
`apps/playground/src/stories/<Name>.tsx`; a story is typed against the component's contract and builds slot
content from a small kit, so web and mobile show the same examples. Each page has a live props panel for the
main props, a copyable import and example, a theme picker over the real themes (phone frames reload with the
theme's native tokens), and links of the form `#/<Name>/<example>?platform=web|mobile&device=iphone|android&theme=<key>`.
`#/frame/<Name>?device=iphone` is what a phone frame loads, useful for debugging one screen. The playground is a
development tool: it is built by `make build` and tested by `make test-playground` (every page on web and both
phones, failing on any console error) but never deployed. Native-only behaviour (gestures, haptics, keyboard
avoidance, Stripe's native card field, the system alert) is not previewed.

`DocEditor` (the invoice and estimate editor) lives in each app because it reads the replica. Connect has
`PublicFrame`, `PublicStatus` and `PublicDone` in `apps/connect/src/components` for its page chrome.

Item images and the business logo are `files` rows served through the public `/media/{file_id}` endpoint
(see *Public media*). Each app builds the URL with `mediaUrl(apiBase, fileId)`.

### Connect — the customer app (PowerSync-free, embeddable)
The public surfaces (book/pay/form/contract/review + a per-business landing) live in their own lean Vite app
(`apps/connect`, :8709) that imports **only** `@clientbridge/app-core/public` — no PowerSync, no api-client.
Each `public*` domain is a `createPublicXClient(baseUrl)` factory doing plain `fetch` against token/slug-
authed endpoints (the URL is the only credential). `apps/connect/public/embed.js` is the host-side iframe
loader — custom elements (`<connect-booking|pay|…>`) that mount the widget with a `postMessage` resize +
success protocol. The lean-bundle boundary is **enforced by lint**: `no-restricted-imports` bans `@powersync/*`
from Connect and `app-core/public`.

### Marketing site (`apps/site`)
The public website is its own app in the same workspace, built with the same stack (Vite, React 19,
Tailwind 4, TypeScript strict) and deployed apart from the web app, on its own subdomain. It is a static
build: `scripts/prerender.ts` renders every route in `src/routes.tsx` to its own HTML file, so pages need no
JavaScript, and the only shipped asset besides HTML is one CSS file and the fonts. It shares the Pewter theme
through `@clientbridge/tokens` and the logo through `@clientbridge/ui`, so the site and the apps cannot drift
apart visually.

- **Copy and data:** all copy lives in `src/content/` (typed modules), the marketing equivalent of
  `strings.ts`. The demo figures in the laptop and phone mocks come from one `content/demo.ts`.
- **Links out:** `VITE_SITE_URL`, `VITE_APP_URL` and `VITE_BOOK_URL` set where the site, the web app and
  Connect live (production: the main domain, `app.` and `book.`). "Sign in" and "Start free" go to the web
  app, "See the demo business" to Birchbark's public booking page.
- **Images:** `scripts/images.ts` encodes the stock photos to AVIF, WebP and JPEG at three widths with sharp;
  pages render them with `<picture>`, `srcset` and fixed dimensions. Fonts are self-hosted (no third-party
  requests).
- **Search and sharing:** per-page title, description and canonical URL; Open Graph and Twitter tags with a
  share image drawn per page at build time (satori and resvg); `sitemap.xml`, `robots.txt`, a web manifest,
  and Organization and SoftwareApplication structured data on the home page.

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
`tokens` feeds both platforms from one source: web via CSS variables + a Tailwind v4 @theme (tailwind.css), mobile via
materialized JS values (`@clientbridge/tokens/native`).
