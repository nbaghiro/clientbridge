# Clientbridge — Architecture

The canonical description of **how the system is built**: stack, structure, the data model, sync, and
authorization. For _how we build it_ (the gate, testing, conventions) see [engineering.md](engineering.md);
for _what's left_ see the launch stories and the after-launch list in
[launch-readiness.md](launch-readiness.md); for design/IA see [design/](design/).

Clientbridge is a **local-first, all-in-one business OS** for solo and small service providers —
bookings, clients, catalog, invoicing, payments, messaging, forms, reviews, staff payout-splits — with
Canadian tax built in. All user-facing copy is centralized in one place. The customer-facing layer
(booking, pay, forms, contracts) is branded **Connect**.

---

## Stack

| Layer        | Choice                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend      | **Python 3.14** · uv · **FastAPI** · async **SQLAlchemy** · **Alembic**                                                                       |
| Database     | **PostgreSQL 16** (logical WAL for sync)                                                                                                      |
| Jobs         | **arq** on Redis                                                                                                                              |
| Web          | **React + Vite + Tailwind** (provider/admin app)                                                                                              |
| Mobile       | **React Native (Expo)** (provider/admin app)                                                                                                  |
| Customer     | **React + Vite** (Connect — public, PowerSync-free, embeddable)                                                                               |
| Offline sync | **PowerSync** — on-device SQLite (web WASM on IndexedDB · Expo op-sqlite), WAL server-push, per-business Sync Streams; writes through FastAPI |
| Payments     | **Stripe Connect** (Accounts v2 merchants, direct charges) + PAD/EFT                                                                          |
| Repo         | **Polyglot monorepo** — backend (uv) + frontend (pnpm + turbo), one root Makefile                                                             |

The toolchain pins Python **3.14** (via `.python-version`) while ruff targets 3.12 for
lint-compatibility and pyright checks against 3.14. The `pyproject` floor is `>=3.12`.

---

## The 5 surfaces

**Every capability is exactly one of five surfaces. Choosing the surface is the main design decision per
feature.** The rule: a **server-only invariant** — uniqueness/numbering, capacity/conflict, money,
secrets, cross-tenant — must be a **command**, never unvalidated replica CRUD.

| #   | Surface              | What it is                                                                                                                                  | Auth                                                          | Examples                                          |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| 1   | **Sync-read**        | PowerSync streams each device its authorized rows into local SQLite                                                                         | Sync Streams                                                  | calendar, clients, invoices on-device             |
| 2   | **Offline command**  | Local-only durable intent → typed `/v1` command → authoritative replication                                                                 | Auth session + service role/tenant checks + expected revision | edit working hours                                |
| 3   | **Command / RPC**    | FastAPI `POST/PATCH/DELETE` under `/v1/*`, wrapped in `run_command` (atomic + audited + idempotent) → writes Postgres → flows back via sync | Auth session + role                                           | book a slot, issue an invoice, take a payment     |
| 4   | **Webhook / public** | inbound provider callbacks + unauthenticated public pages                                                                                   | signature / token / slug                                      | Stripe/SMS/email webhooks; book/pay/form/contract |
| 5   | **Job**              | arq background work on Redis                                                                                                                | system                                                        | reminders, reap-unpaid, broadcasts, overdue sweep |

**Decision rule** — where does a new operation go?

- An edit must survive offline use → **offline command (2)** with explicit replay, conflict and recovery semantics.
- Needs a server-only invariant (uniqueness/numbering, capacity/conflict, money, secrets, cross-tenant) → **command (3)**.
- A third party initiates it → **webhook (4)**.
- Time-based or async → **job (5)**.

This is why _"create a booking" is a command (`POST /v1/bookings`), not an offline edit of the replica_: the
capacity/conflict check must be atomic and server-authoritative. The resulting row then syncs back to
every device for free. The same logic makes invoice numbering, payments, and broadcasts commands.

---

## Monorepo layout

Clean Python↔TS boundary, crossed **only** by generated bridges (see _The generated bridges_ below).
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
│       ├── models/             SQLAlchemy — one file per domain (+ base)
│       ├── schemas/            Pydantic DTOs — one file per concept
│       ├── services/           business logic — one file per concept (33)
│       ├── api/                router.py (mounts /v1) · one router file per concept · public.py · webhooks.py
│       ├── sync/               auth.py (token/JWKS)
│       ├── integrations/       identity · kratos · stripe · resend · twilio · expo · s3 (provider adapters)
│       └── tasks/              worker.py: the arq cron schedule
├── frontend/           ── TypeScript · pnpm + turbo ──
│   ├── apps/
│   │   ├── web/        React + Vite · provider/admin · :8700
│   │   ├── mobile/     Expo RN · provider/admin · :8707
│   │   ├── connect/    public customer app · PowerSync-free · :8709
│   │   └── site/       marketing site · static prerender · :8710
│   └── packages/
│       ├── app-core/   shared view-model hooks + strings + icons + UI prop contracts (ui.ts)
│       ├── ui/         shared components: src/web (DOM, web + Connect) · src/mobile (React Native)
│       ├── sync/       PowerSync AppSchema + backend connector
│       ├── api-client/ generated OpenAPI types + session (cookie/token) + auth flow client (Kratos)
│       ├── tokens/     Pewter design system → Tailwind theme + RN theme
│       └── config/     shared eslint/prettier, the copy lint rules and the e2e helpers (axe, focus, hover, en-XA)
├── infra/powersync/    powersync.yaml (local) · powersync.deployed.yaml (staging, production) · sync-rules.yaml (read authz)
├── infra/auth/         the auth service (Kratos): kratos.yml · identity schema · Google mapper · courier body
└── .docs/              architecture · engineering · launch-readiness · design/
```

---

## Backend — layer-first, one file per concept

Flow: **`api` (thin router, never queries) → `schemas` (DTOs) → `services` (logic, owns the transaction) →
`models`.** `models/` is grouped by domain, because tables cluster that way (twelve domains: `business · clients ·
catalog · scheduling · billing · payments · ledger · messaging · documents · reviews · platform ·
returning`). Every other
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
with the subclass's HTTP status, and a request that fails validation as `invalid_request` with a 422. The
`error` code is the contract: it is stable, and clients map it (with the status) to a catalog message. The
`message` is English text for logs and developers and is never rendered.

### The cross-cutting core (`core/`)

| File            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `command.py`    | **The command wrapper.** `run_command(db, principal, *, action, run, response_model, idempotency_key)` — replays a stored response for a repeated key, stages `Command.record(...)` audit rows, then commits mutation + audit + idempotency key as **one atomic unit** (rollback on any error). Money/uniqueness/cross-tenant mutations go through it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `scoping.py`    | **The one place the tenant filter lives.** `scoped(Model, business_id, soft_delete=…)` + `scoped_update`/`scoped_delete`. Services **never** hand-write a `business_id` filter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `deps.py`       | DI hub — DB session, adapter aliases (`EmailDep`, `GatewayDep`, `IdentityDep`…), the auth chain (`current_identity` asks the auth service who the session is, `current_user` links the local user, `current_principal` re-derives business/role from the DB every request, honoring `X-Business-Id`), and role gates (`assert_role`, `is_manager`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `config.py`     | Pydantic-settings and the origin lists: `app_origins()` (only `WEB_BASE_URL`; credentialed CORS and the cookie Origin check) and `CORS_ALLOW_ORIGINS` (Connect's `book.`, `pay.` and `shop.` hosts, without credentials, through `core/cors.py`), with `allowed_origin_regex()` adding every business page from `BUSINESS_PAGE_URL`. `ENV` is `dev`, `staging` or `prod`; `BASE_DOMAIN` (`clientbridge.ca`, `staging.clientbridge.ca`) derives every public URL that is not set: the API at `api.` with the auth service under `/auth`, the web app at `app.`, business pages at `<slug>.`, booking at `book.`, the shop at `shop.`, Pay at `pay.`. **Fails closed outside dev:** refuses to boot without `BASE_DOMAIN`, the database, Redis, storage, Stripe, Twilio, Resend and auth email hook settings, the PowerSync signing key, a separate admin URL or a nonzero `TRUSTED_PROXY_HOPS`, or with a set URL or session cookie name that disagrees with `BASE_DOMAIN`, a reserved base domain (`.invalid`, `.localhost`, `.test`…), Redis, storage or the auth service on `localhost`, or an `EMAIL_FROM` at another domain. A deploy also names the session cookie `__Host-cb_session` and reaches the auth service's public API at `AUTH_INTERNAL_URL` (its in-cluster Service over http; empty means `AUTH_PUBLIC_URL`). |
| `deployment.py` | What a deployed environment derives from `BASE_DOMAIN`, with no imports beyond the standard library so the Pulumi program reuses it: `public_urls` (the API settings), `auth_env` (the auth service's environment over `kratos.yml`), `powersync_env` (PowerSync's for `powersync.deployed.yaml`), the session cookie name and the secret variable names each service needs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `security.py`   | SHA-256 opaque-token hashing (invites) · the PowerSync token (HS256 or RS256 + a JWKS endpoint for prod).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ids.py`        | Prefixed-ULID PKs (`bz_…`, `bk_…`), time-sortable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `errors.py`     | `AppError` taxonomy → HTTP status (`NotFound` 404, `Conflict` 409, `CardDeclined` 402, `TooManyRequests` 429…).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ratelimit.py`  | In-process sliding-window limiters, one per worker process, for the six public groups (pay, form, contract, booking, which the shop and returning-client checks share, preferences and invite preview): 30 requests a minute from one address each, 1000 with `ENV=dev`. The address is the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right (2 behind Google's load balancer, 0 locally, where the socket peer is used), so a client cannot pick its own key; the contract signer IP comes from the same function. The desk discount PIN has its own limiter in `services/orders.py` (5 tries per 5 minutes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `logs.py`       | Logging, configured once at startup by the API lifespan and the worker's `on_startup`: INFO and above to stdout, plain text with `ENV=dev` and one JSON object per line otherwise (`time`, `level`, `severity`, `logger`, `message`, `exception` and any `extra` fields). `RequestLog` writes one line per request with the method, the route template (so public tokens stay out of the logs), the status and the duration, in place of uvicorn's access log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db.py`         | Async engine + `SessionLocal` + the `Base` model metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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
`stripe.py` (Stripe Connect + Terminal), `resend.py` (email, the SMTP transport for Mailpit in dev, and the Svix check on the delivery webhook), `twilio.py` (SMS), `expo.py` (push), `identity.py`
(the auth service's interface: `Identity`, `Credential`, `IdentityProvider`) with `kratos.py` (its Ory Kratos implementation and `get_identity_provider`), `s3.py` (S3; RustFS locally).

### Email design

Every email goes out as plain text and as HTML from one layout, `core/email_layout.py`: a table-based page with
inline styles (so Gmail, Outlook and Apple Mail keep it), light only like the site and the apps, with an
eyebrow, a heading, paragraphs, and optional code box, receipt table, button and footer. Each builder in
`services/notifications.py` returns a `Notice` (subject, the text that SMS and the plain email send, and the
`EmailView` the HTML shows), with all copy in `en_CA.po`. Clientbridge's own mail (sign-in codes, invites, trial
notices, alerts to a business's team) uses `platform_brand()`: the logo over the site's contour lines. Mail a
business sends its clients uses `business_brand()`: its brand colour and its logo when the upload is PNG, JPEG or
GIF (other formats show its name), and a "Sent with Clientbridge" line. The header and contour PNGs are bundled in `backend/src/clientbridge/email_assets/` and attached inline
with Content-ID references by both Resend and SMTP. Only images used by a message are attached; the fixed
art does not depend on the marketing site. Uploaded business logos still use the existing media URL.
`make preview-emails` renders ten representative demo emails into `.scratchpad/emails/`, embedding the
same image bytes as data URLs for browser previews. Mailpit shows the real MIME message in dev.
Use `make preview-emails ARGS="--list"` to list samples, or `ARGS="--email invoice"` to preview one.
To send a demo, explicitly choose a recipient, sample and transport:
`make preview-emails ARGS="--email invoice --send-to you@example.com --transport resend"`.
Resend needs `RESEND_API_KEY` and `EMAIL_FROM`; SMTP uses `SMTP_URL`. Sends carry a `[TEST]` subject,
synthetic data and nonfunctional `.test` action links, without changing business records. The gallery is
a browser approximation; inspect actual deliveries in target email clients before approving the design.
The waitlist confirmation is the one exception: the marketing site's server sends it, so `make gen-waitlist-email`
writes it to `apps/site/server/waitlist-email.json` with the images the site's build serves at `/email/`.

Payment settlement, refunds, booking creation, form sends, trial reminders and admin tests persist
notification intent before commit. The delivery worker claims work with a lease, sends after commit,
and fences completion against callbacks. Known connection failures retry; uncertain acceptance or an
expired in-flight lease becomes `ambiguous` and is not blindly resent. Admin email history distinguishes
provider acceptance from delivery. Other notification paths retain their existing status-marker flow.
SMS uses the business's unique `sms_number` for outbound identity and inbound routing; a retired number
cannot be reassigned to another business. Public abuse controls use Redis outside development.

Online stock holds are derived from existing order/invoice lines and live payments, excluding lines
already represented by sale movements. Item locks serialize competing checkouts. Cancelled intents
release holds; stock corrections or late payment after order expiry cause recorded, keyed refunds.
In-person negative-stock policy remains supported when it does not consume another checkout's hold.

### Jobs (`tasks/`)

`tasks/worker.py` is the schedule only: one-line arq cron wrappers that open a session and call a `run_*`
function in the concept's service. Every 15 minutes: booking reminders, reaping unpaid bookings and unpaid
shop orders, completing past visits and sending intake forms. Every minute: due deliveries and broadcasts (held during
quiet hours). Every 30 minutes: pruning used sync receipts; hourly: pruning unfinished uploads. Hourly at
:00, each acting only for businesses whose local time is the hour named: the overdue sweep (07:00), review
requests (08:00), pickup reminders (09:00) and trial reminders (09:00). Daily (UTC): entitlement expiry and
device pruning 03:30, ledger reconciliation 04:00 and plan seat sync 05:00. Jobs aren't tenant-scoped: each row resolves its own business (and through it the time
zone and `locale_for(...)` its text renders in), and each is idempotent via a status or timestamp marker.
The worker evaluates cron times in UTC (`timezone = UTC`) whatever the host's zone.

`GET /health` is the liveness check and touches nothing; `GET /ready` (`services/health.py`) runs
`SELECT 1` with a two-second timeout and answers 503 when it fails
(`{"status": "unavailable", "failed": ["database"]}`). Redis is not part of readiness: only the public
rate limits and the worker use it, so an outage answers 503 on the rate-limited public routes and
restarts the worker without taking the API out of the load balancer.

---

## The data model

**44 tables** across the 12 domains; credentials and sessions live in the auth service's own database. Stripe Connect custodies funds and pays out; a double-entry ledger (`accounts` + `entries`)
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
  Each vocabulary is a `Literal` alias in its model file; the column's `Mapped[...]`, the `CHECK` and the
  API schemas all use that alias, so a value is added in one place.
- **API shapes:** schemas that copy a table subclass `core/mirrors.Mirror` and name the model they mirror.
  `mirror_errors()` (run by `test_integrity`) checks that every field named after a column carries the
  column's type or a narrower one: a subset of its vocabulary, a dropped `None`, a structured model for
  a JSON column, or an optional wrapper for partial input. Fields computed from the ledger under a
  column's name (an invoice's `status`) are listed in `derived`.
- **Timestamps:** `created_at`/`updated_at` (`timestamptz`, default `now()`); status + key lifecycle
  timestamps; `created_by` where used.
- **Soft-delete:** `deleted_at` on **`clients`**, **`subjects`** and **`bookings`** only; everything else hard-deletes or
  status-lapses.
- **No `relationship()`** on any model → the unit-of-work can't FK-order inserts, so services **flush the
  parent before its FK children** (the seed hand-orders inserts for the same reason). One FK cycle
  (`bookings → packages → payments → bookings`) is broken with `use_alter=True`.
- **JSONB** for lightweight config (brand, custom_fields, attributes, audience, answers, changes,
  requirements); **never** for queried business data.
- **Concurrency invariants live in SQL:** a GiST exclusion constraint stops double-booking a staff
  member; partial-unique indexes enforce business rules (one active/paused subscription per client+item,
  one invitation per booking enforced by the service).

### ID prefixes

Prefixes predate the table renames and are kept so existing ids stay valid; the table each one lands in is
shown after it.
`bz_`businesses `us_`users `st_`staff · `cl_`clients `sj_`subjects `nt_`notes `cns_`consents · `it_`items `pkg_`packages
`sub_`subscriptions `gc_`gift_cards `stk_`inventory · `ses_`slots `bk_`bookings `bka_`addons `av_`hours
`sch_`recurrences · `inv_`invoices `est_`estimates `ord_`orders `ln_`lines · `pay_`payments
`pm_`payment_methods `psl_`payment_setup_links `acc_`accounts `ent_`entries `jrn_`journal · `th_`threads `msg_`messages `bro_`broadcasts
· `frm_`forms `ff_`fields `fr_`responses `con_`contracts `sig_`signatures · `rrq_`review requests (preserved historical invitation IDs remain unchanged)
· `fl_`files `aud_`audits `wh_`webhooks `dvt_`devices `idk_`commands `sur_`sync_receipts · `rtc_`returning_challenges

### Tables by domain

**business (3)** — `businesses` (all Stripe-Connect/KYC mirror fields + Canadian tax fields + `slug` + brand
JSONB + `subject`, what a booking names besides the client: pet, student, property, site or vehicle, NULL when the
business books only the client), `users` (one per auth identity via unique `identity_id`; `email` copied from the auth service, `last_seen_at`), `staff` (user↔business, `role`
owner/admin/staff/contractor, payout config `payee`/`rate_type` with the rate in `rate_bps` (percent) or
`rate_cents` (fixed or hourly), one membership per user per business, pending invites via
`status=invited` + hashed `invite_token`).

**clients (4)** — `clients` _(soft-del)_ (`tags[]`, `status`, `custom_fields`, `stripe_customer_id`), `subjects` _(soft-del)_ (no kind of their own: the business's `subject` says what they are, and
`attributes` JSONB holds that kind's details, validated per kind in `schemas/subjects.py` with unknown keys kept), `notes` (polymorphic
`parent_type`/`parent_id` over client/subject/booking, `created_by`), `consents` (one row per change to a
client's marketing consent on a channel, with its `source`; the newest row holds, and an SMS STOP from the
client can only be lifted by the client's own START).

**catalog (5)** — `items` (**one table drives the whole catalog** via `kind` service/class/product/package/
subscription/gift — duration, capacity, deposit, recurrence, session_count, `stripe_price_id`, and
`staff_ids` for who offers a service or class), `packages`
(client's package: `sessions_total` and status, and `subject_id` when it belongs to one of the client's
subjects, so it covers only that subject's visits, refused with 422 `package_other_subject`; null shares it;
sessions used is the count of its consumption journals), `subscriptions` (recurring: status, period,
`provider_ref`; partial-unique one active/paused per client+item), `gift_cards` (`code` unique per business,
`initial_cents`; the spendable balance is the card's own ledger account, and an active card with nothing
left reads as redeemed), `inventory` (one signed stock movement per row, `reason` sale/refund/restock, keyed
by line and reason; `items.stock_on_hand` is the running total).

**scheduling (6)** — `slots` (the calendar event: capacity-bearing block; appointment = capacity 1, class
= capacity N; seats taken are counted from its live bookings; `recurrence_id`), `bookings` _(soft-del)_ (client↔slot via `slot_id`; denormalized
`staff_id`; status pending→confirmed→completed/canceled/no_show, or waitlisted on a full class (a seat freed before the session starts goes to the earliest sign-up waiting, and the overnight job closes what is left once the class ends); `source`; deposit terms (the deposit's
state is derived from the ledger, and a deposit is due when `deposit_amount_cents > 0`); `reminded_at`;
`departed_at`, set once by `POST /v1/bookings/{id}/depart` ("On my way", which texts the client), and
`checked_in_at`, the client arriving or, for a property, site or vehicle business, the member arriving),
`hours` (per-staff working hours: `basis` recurring weekday or one-off date, `available`; `basis`
exception is time off for one member, or a closure for everyone when `staff_id` is null, with
`starts_at`/`ends_at` and a `reason`, written only through `/v1/time-off`), `recurrences` (recurrence rule with `frequency` day/week/month, the same words
items use, and `monthly_by` date or weekday → expands to slots/bookings; dates can be skipped or shifted
when booking, and `PATCH /v1/recurrences/{id}` moves one, the following or all upcoming visits while
`/cancel` ends the series and refunds paid deposits; a recurrence with no client is a class schedule, see Programs), `addons` (products added to a visit, by the client when booking or
by staff through `POST /v1/bookings/{id}/addons`; they join the visit's invoice, and a product's `duration_min` lengthens
a one-to-one visit by its minutes times the quantity).

**billing (4)** — `invoices` (per-business unique `number`, stored status draft/sent/void, document totals
subtotal/tax/total fixed at issue, `pay_token`, `overdue_notified_at`; what is owed is the invoice's
receivable in the ledger, and partial/paid/refunded/overdue and the paid time are read from it, through
`ledger.invoice_status_expr()` on the server and `invoiceStatusSql` on the device), `estimates`
(accept/decline/convert → invoice; a sent estimate past `valid_until` reads as expired; an accepted,
unconverted estimate can be booked, its chosen product lines joining the visit as `addons` at the quoted
unit price, through `estimate_id` on `POST /v1/bookings`, owner or admin only; the booking keeps
`bookings.estimate_id`, and while a live (not canceled, not deleted) booking holds the estimate a second
one is refused with 409 `estimate_booked`, and converting it to an invoice with 409 `estimate_on_visit`, since
its products are billed on the visit), `orders`
(POS/Terminal sale; stored status open/void, paid/refunded read from the ledger the same way),
`lines` (three nullable foreign keys `estimate_id`/`invoice_id`/`order_id` with a CHECK that exactly one
is set; `item_id`/`booking_id`, `tax_amount_cents`).

**payments (3)** — `payments` (payment attempts and Stripe objects: `kind` payment/deposit/refund; status;
unique `provider_ref` = one row per Stripe object; a payment can have several refunds, one row per Stripe
refund, each with `parent_payment_id`; a payment targets at most one invoice or one order),
`payment_methods` (saved card/PAD, `method` card/bank_eft, the same spelling as `payments.method`;
`preferred` marks the card charged off-session), `payment_setup_links` (a hashed, expiring link a client
opens on `pay.D/setup` to authorize a bank account (PAD), with its SetupIntent and mandate).

**ledger (2)** — `accounts` (one per owner × category × code × currency: owners are a business, client, staff
member, the platform, a gift card or a package; categories are cash (`stripe`/`bank`/`cash`), `receivable`,
liabilities (`tax` per GST/HST/PST/QST code, `gift_card`, `deposit`, `deferred`, `payable` per
pending/approved stage), income (`revenue`, `fee_revenue`) and expenses (`processing_fee`, `platform_fee`,
`staff_cost`); a cached `balance_cents` that only the trigger on `entries` writes), `entries` (append-only legs grouped by `journal_id`; signed
`amount_cents`, debit positive; `event` = what happened; `source_*` = what caused it; `subject_*` = the entity it
belongs to; `ref` + `leg` unique = idempotency; the account's owner is copied on for sync slicing).

**messaging (4)** — `threads` (unique per business+client+channel; the last message time and the unread
count, inbound messages not yet `read`, are read from `messages`), `messages` (direction in/out,
`broadcast_id`, `attachments`), `broadcasts` (audience JSONB + `scheduled_at`), and server-only `deliveries` (immutable typed payload, stable key, current transport state and fenced worker claim).

**documents (5)** — `forms`, `fields` (`input` is one of 17 field types), `responses` (public-link token,
`answers`, immutable issued `definition`, and optional submitted `signature` JSONB; a treatment note is a
response with no token, written by staff on a booking with a form sent by hand, with its author in
`signature`; it is final, never syncs, and each read is audited as `treatment.read`), `contracts` (template), `signatures` (public-link token; snapshots `signed_body` + captures
`ip`; links a signature image file).

**reviews (3)** — `review_requests` preserves invitation history. `google_business_connections`
stores an encrypted refresh token and one selected Google location per business; `google_business_operations`
stores encrypted, owner-authored reply intent and bounded execution state. Both Google tables are server-only.
Google review content is fetched online and is not a SQL/PowerSync replica. OAuth handoff state is short-lived
in Redis; KMS encryption binds credentials and drafts to their business and record identity.

Owners/admins connect, select a location, read reviews and explicitly publish/edit/delete their public replies.
Reply operations persist before Google writes and reconcile uncertain outcomes by reading back. Disconnect
clears local credentials, cancels operations and stops new invitations. Google replies and reviews remain on Google.

Invitations resolve the linked location's Google review URL and enqueue delivery transactionally. A business-scoped
lock serializes manual and automatic requests. A client gets at most one request in 30 days; the morning job skips
archived clients and businesses with `review_requests_enabled` turned off. Email/text opt-outs remain enforced.
Invitation history is not evidence of delivery or a review. No internal feedback collection, moderation or
reviewer-to-client matching exists. See the [setup and pilot runbook](executions/google-business-reviews/runbook.md).

**platform (6)** — `files` (S3 key, `purpose` logo/image/photo/signature/attachment), `audits` (activity
feed, written only by the app; server-only), `webhooks` (inbound provider events, `event` = the provider's event name;
**not** business-scoped — routed during processing; a Stripe event's `payload` is cleared once it is
processed and kept on a failed row; server-only), `devices` (Expo push tokens), `commands`
(unique per business+scope+key — backs `run_command` replay; server-only), `sync_receipts` (one per
user+device+operation for the hours outbox: payload hash and result, so a replayed upload returns the
original answer; server-only).

**returning (1)**: `returning_challenges` (a returning client's emailed code on the public pages: hashed
destination, code and session, attempts and expiry; server-only).

> **Note on tax:** there is **no `tax_rates` table** (dropped). Rates are effective-dated rows per province in
> `services/tax.py` and derived from `businesses.province`; the tax engine (also `services/tax.py`)
> is pure and golden-tested. See _Tax_ below.

### Polymorphic patterns

`lines` one FK per document (estimate/invoice/order, exactly one set) · `payments` nullable over invoice/booking/order + `kind`/
`method` · `items.kind` = whole catalog · `slots` = every calendar block · `staff` = staff +
invites · `entries.subject_type`/`source_type` = any money event on any entity · `notes`/`files`/`responses`/
`signatures` `parent_type` and `audits.entity_type` generalize the rest. `kind` is used only on `items`
and `payments`; other discriminators carry a name that says what they mean (`hours.basis`,
`fields.input`, `payment_methods.method`, `entries.event`, `webhooks.event`, `accounts.category`,
`files.purpose`).

> **Why this shape:** the model is a pragmatic "mostly-lean" blend chosen over an option-by-option review —
> maximally consolidated (shared `lines`/`payments` across documents, one `items(kind)`, one `slots` for 1:1 + group)
> but split where lifecycles genuinely differ (packages vs subscriptions vs gift cards; forms vs contracts).
> A deliberately lean schema, with clarity kept exactly where money and lifecycles live.

---

## Sync (PowerSync)

**Engine: PowerSync**, self-hosted next to Postgres. Topology = **PowerSync reads the Postgres WAL
directly**; **writes always go through FastAPI** (server-authoritative). Chosen because it's the only engine
that delivers, for this stack, _all of_: real offline SQLite on **both** web (WASM) and Expo RN
(op-sqlite), WAL-driven server-initiated push, and per-business partial replication — with no Node and
minimal bespoke code. (ElectricSQL rejected: no offline SQLite on RN today. DIY rejected for v1: months of
build + permanent maintenance.)

```
 Expo (op-sqlite) ─┐                            ┌── logical replication (WAL) ──┐
 Web (WASM)        ─┤── WebSocket (read sync) ─► PowerSync Service ◄────────────┤ Postgres (source of truth)
       ▲ reads local SQLite (offline-first)      (Sync Streams keyed by           │
       │                                           business_id + role, from token) │
       └── local-only hours outbox ─► FastAPI /v1/hours/{staff}/week─┘ writes
```

- **Reads** are governed by **Sync Streams** + the PowerSync token's `sub`; FastAPI is _not_ in the read loop. The on-device
  SQLite already holds only the rows this user may see, so the client never filters for _security_ — it just
  queries its local DB. Reactive `useQuery(sql)` re-runs on any sync push or local write.
- **Hours writes** persist proposals separately from canonical rows in a local-only outbox. The typed week command validates authorization, seven weekdays and the expected revision atomically with its replay receipt. Other writes use their existing online commands.
- **Server-initiated push:** _any_ write that hits Postgres — a Stripe webhook, a cron job, another
  staff member's action — flows back out via the WAL automatically, sub-second, to the relevant devices.
- **Hours conflicts** reject stale revisions and preserve the proposal for explicit review. The editor offers apply-again against a fresh revision or discard. Money creation remains backend/webhook-only.
- **History window.** Messages, slots and bookings sync for the past 12 months and the next 24, by UTC month. The replica controller subscribes the three history streams with those months before it connects, so the first sync includes them. The controller refreshes this window every minute while active, including after a suspended timer resumes. Calendar reads subscribe to their requested months and wait for all three streams before treating an empty result as available. Confirmed month coverage is stored locally with a conservative 23-hour lifetime; unavailable offline dates are shown explicitly. A month that leaves the window is unsubscribed and its rows leave the device when the 24-hour TTL ends. Older history is read from the API while online: `GET /v1/bookings/visits` (a client's older visits, plus the count and date of completed ones) and `GET /v1/threads/{id}/messages`. Money tables (invoices, payments, accounts, entries) sync in full, so balances and invoice status stay correct offline. Streams cannot use the current time, so each windowed row needs its own timestamp; bookings carry `starts_at`, a copy of the slot start that `move_slot` keeps in step.
- **Device query planning.** PowerSync stores each table as JSON behind a view and indexes JSON expressions. Replica indexes are the model indexes without a leading `business_id`, because a device reads one business at a time. The controller runs `PRAGMA optimize=0x10002` after the first sync, because without statistics SQLite prefers the `business_id` index. SQLite ignores a replica index on the right side of a LEFT JOIN, so a one-to-many join goes through the parent's id (`slotBookingsJoin`).

### Database roles and replication

`scripts/db_access.py` creates five roles (the fifth, `auth`, owns the `auth` database) and is run by `make up` and `make migrate`. `clientbridge_migrator` owns the application database and its schema and runs Alembic and the demo seed (`MIGRATION_DATABASE_URL`). `clientbridge_api` has data access without DDL (`DATABASE_URL`). `powersync_source` has `REPLICATION` and `SELECT` on synced tables only. `powersync_storage_owner` owns the `powersync_storage` database. The `powersync` publication lists exactly the synced tables, generated from the stream config, so users, receipts, commands, audits and webhooks never reach the replication service. The auth service has its own `auth` database and role. `make replication-health` fails when PowerSync is not ready, its slot is inactive, retained WAL exceeds 1 GiB or replay lag exceeds 60 seconds.

### Attachments

`POST /v1/files` creates a pending row and a presigned upload URL. After the upload, `POST /v1/files/{id}/complete` (or the public form's `/upload/{file_id}/complete`) checks the object's size in storage and sets `uploaded_at`. A missing object returns 409 `upload_missing`, and a different size returns 422. Readers ignore rows without `uploaded_at`: public media, item images, the logo, form answers and the replica queries. `prune_pending_files` removes pending rows older than 24 hours together with their objects. File metadata syncs, but bytes do not; an image that cannot load falls back to its initial.

### Device storage

Replicas are named per API, PowerSync URL and user, and refuse a database that belongs to another account. When the API says the session is gone, the shell removes the replica from the screen and shows sign-in; the data and pending work stay on the device for the same account, and sign-out clears them. Web caches only build assets and the app shell for offline launches, never API responses. It asks the browser to keep its storage persistent and shows nothing when the browser declines. Offline session restoration requires a server verification within the past seven days; checks also run each minute and on foregrounding. Missing, expired or future verification timestamps require reconnection without deleting pending work. This is a local app access policy, not protection against someone modifying browser storage. A full device shows its own sync problem. Neither platform encrypts the database at the application level: browser storage does not protect against a script running on the same origin, mobile relies on the platform's file protection, the session token is in SecureStore on mobile, and on web the session is an HttpOnly cookie (`localStorage` keeps the user id and last successful verification time).

### `/sync/token` + JWKS (`sync/auth.py`)

Exchanges an auth session (cookie or `X-Session-Token`) for a short-lived PowerSync token whose `sub` is `users.id`; serves the RS256 JWKS at `/sync/keys`. Development uses HS256 with the static key in `infra/powersync/powersync.yaml`. Staging and production use RS256 (`POWERSYNC_USE_RS256=true`, `POWERSYNC_KID`, `POWERSYNC_PRIVATE_KEY_PEM`) and read `infra/powersync/powersync.deployed.yaml`, whose `jwks_uri` is the API's `/sync/keys` over the cluster network and which accepts no static key. PowerSync's `!env` substitution has no defaults and cannot switch the `client_auth` block, so the two environments need two files; `test_sync_signing` keeps their shared lines equal.

### The hours write path

`POST /v1/hours/{staff_id}/week` is the single recurring-week mutation. Owners/admins may edit any active member in their business; other members may edit only themselves. Each operation includes a device/operation identity, business, creation time, expected revision and all seven weekdays. The service serializes replacement, keeps row IDs stable, increments `staff.hours_revision`, and commits the replay receipt with the write. The same identity and payload replay the original result; changed payloads or stale revisions fail. Existing split-day schedules are rejected for explicit review, never flattened silently.

### The client (`packages/sync`)

`schema.ts` is generated from explicit sync projections. The connector exchanges live session credentials at `/sync/token`; PowerSync downloads canonical data. `hours_outbox` and device preferences are local-only tables. The outbox coalesces unattempted changes, freezes attempted payloads, backs off transient failures, and blocks only successors of a rejected staff-week. Accepted proposals are displayed as awaiting updated data, separately from unsent or rejected work. They remain pending until their revision is observed in the replica. If the target disappears, an authenticated read checks access; only a definitive 403/404 retires the accepted proposal. Rejected work and dependent unsent edits can be discarded with confirmation from either platform’s sync banner, even when the original staff editor is inaccessible. Transient failures keep retrying without an attention-required classification. The developer overlay reports queue counts, oldest pending timestamp and the last measured server-acknowledgement-to-replica delay; the latter is retained in local device preferences. Pausing authentication cancels uploads without deleting intent; explicit discard clears the account-scoped replica.

Direct writes to synchronized tables are programming errors. There is no generic CRUD endpoint or old-client fallback. Receipts, commands, webhooks and audits remain server-only.

---

## Identity (the auth service)

The auth service is self-hosted Ory Kratos. It is named `auth` wherever it runs (the compose service,
workload, database and role, `AUTH_*` settings, `infra/auth/`); Kratos is named only in the backend
adapter (`integrations/kratos.py`), the api-client's flow client (`identity.ts`) and files in Kratos's
format, so another provider replaces those and keeps the rest. The API depends on `IdentityProvider`
(`integrations/identity.py`), and its contract speaks of a second factor, never of Kratos's assurance
levels. The auth hooks in app-core still read Kratos's flow shapes (nodes and message ids); moving them
behind a provider-neutral contract is _Auth provider independence_ under After launch in launch-readiness.

The auth service (`infra/auth/`, public :8713, admin :8714) owns credentials, sessions, email
verification, recovery, Google sign-in, second factors (TOTP, backup codes, WebAuthn on web) and the
settings flow. The apps drive its self-service flows directly with their own screens (app-core
`useAuthForm`, `useRecoveryForm`, `useVerificationForm`, `useSecuritySettings`): web uses browser
flows and an HttpOnly session cookie; mobile uses native flows and keeps
the session token in SecureStore. The auth service makes and checks every emailed code, but its courier hands each
message to `POST /webhooks/auth-email` (shared `AUTH_EMAIL_HOOK_SECRET`, shaped by
`infra/auth/courier.jsonnet`), which words it in `notifications.py` and sends it through `EmailSender`;
a non-2xx reply makes it retry.

- **API edge** — `current_identity` sends the session to `/sessions/whoami` (30 s in-process cache;
  `/v1/me`, onboarding and invite accept read it fresh, so a just-verified email or a step-up counts at
  once; `/v1/me` also provisions from that fresh read, so a relink lands on the first retry). It extends sessions nearing expiry, best effort, and refuses any session signed in more than
  `SESSION_MAX_AGE_DAYS` (90) ago, ending it in the auth service too so the next sign-in starts fresh. No session is 401 `unauthenticated`; a missing second factor is
  401 `second_factor_required` (the apps step up instead of signing out); the auth service unreachable is 503, never a
  sign-out.
- **Origins** — only the staff web app (`WEB_BASE_URL`) gets credentialed CORS, and cookie-authenticated
  writes must carry its `Origin` (`core/cors.py`, `app_origins()`). The cookie also rides along on
  same-site requests from `book.`, `pay.`, `shop.` and business pages, which get CORS without credentials.
- **Provisioning** — the first authenticated request creates the `users` row for the identity
  (`AuthService.provision`), and later ones copy email/name changes and a throttled `last_seen_at`.
- **Required verification** — signing in does not need a verified email; opening a business and
  accepting an invite do. An invite joins only an identity that has verified the invited address.
- **Replica binding** — the apps send `X-Expected-User` from the replica; a different signed-in user
  is 401 `session_changed`, so one account's sync never writes into another's replica.
- **Removal** — removing a staff member ends that membership only; the next request for that business
  is 403, and the person stays signed in for any other business.
- **Relinking** — if an identity is deleted in the auth service and the person signs up again with the same,
  verified email, the existing `users` row moves to the new identity; otherwise the email stays 409.
  The apps treat that 409 as a held session (app-core `checkSession`): the verify screen with a
  sign-out, never the sign-in screen, which would find the live session and loop.
- **Invite tokens** — the emailed link carries the token once; the web app keeps it in session
  storage (never in a URL again) through sign-up, verification and Google, and the page sends
  `Referrer-Policy: no-referrer`. The preview is a rate-limited `POST`.
- **Password changes** — changing or resetting a password revokes every other session of that
  identity (the `revoke_active_sessions` hook on settings and recovery in `kratos.yml`).
- **Deployed** — the auth service's public API is routed under the API host at `api.<base>/auth`,
  with the Gateway stripping the prefix, so its session cookie is the host-only
  `__Host-cb_session` (Secure, path `/`, SameSite Lax) and no other host of the domain, staging
  included, can read or overwrite it. The web app on `app.<base>` calls it with credentials, which a
  same-site request carries; mobile sends its session token and never the cookie. Kratos runs
  `serve --watch-courier` without `--dev`, and every deployed value comes from
  `core/deployment.auth_env` over `kratos.yml`: the base URL `https://api.<base>/auth/`, CORS and
  return URLs on `app.<base>` (plus `clientbridge://auth/callback` for mobile), the WebAuthn RP ID
  `app.<base>`, the UI URLs and the courier hook to the API over the cluster network. Google's
  callback is `https://api.<base>/auth/self-service/methods/oidc/callback/google`. The API calls
  `/sessions/whoami` at `AUTH_INTERNAL_URL` and the admin API at `AUTH_ADMIN_URL`, both inside the
  cluster. `scripts.verify_kratos` runs the pinned Kratos with that environment and the Kratos contract
  against it.
- **Not built in** — Kratos OSS has no login lockout; production rate-limits the auth service's
  `/auth/self-service/*` paths at the proxy (CLI-5). The admin API must stay on the private network.

## Authorization & visibility

Reads and writes are authorized by **different** mechanisms. The sync stream reads the WAL and _bypasses_
Postgres RLS, so read policy lives in the **Sync Streams**, not the DB. Writes are authorized in FastAPI.

### User tiers & provider roles

| Tier               | Modeled as                                  | Scope                                       |
| ------------------ | ------------------------------------------- | ------------------------------------------- |
| **Provider team**  | `staff.role` on a `users` row               | their business(es), role-scoped             |
| **Client**         | `clients.user_id` (optional, future portal) | only their own relationship with a business |
| **Platform admin** | Clientbridge-internal                       | cross-tenant (out of this model)            |

Provider roles (`staff.role`): **owner** (everything incl. billing/ownership) · **admin** (all except
billing/ownership) · **staff** (own work only, no financials) · **contractor** (own work + own earnings;
currently same perms as staff).

### Visibility — the employee model (default)

| Data                                                           | owner / admin       | staff       |
| -------------------------------------------------------------- | ------------------- | ----------- |
| Own calendar (slots/bookings/hours)                            | ✅ all members      | ✅ own only |
| Shared client book (clients, catalog, forms, contracts, files) | ✅                  | ✅          |
| Own earnings (their own `payable` account + entries)           | ✅ all              | ✅ own      |
| Financials (invoices, payments, the ledger, others' pay)       | ✅                  | ❌          |
| Inbox: one-to-one messages                                     | ✅                  | ✅          |
| Broadcasts and reviews                                         | ✅                  | ❌          |
| Settings / billing / staff management                          | owner (+ admin ops) | ❌          |

### Enforcement — the sync streams (`infra/powersync/sync-rules.yaml`)

Four auto-subscribed streams and three history streams implement the read model (owner-sees-workers'-activity is carried by
`bookings.staff_id` and the ledger's `owner_type`/`owner_id`; the `audits` trail is server-only):

- **`business_shared`** (every active member): the catalog and entitlements, the client book, forms,
  fields, contracts, files and threads.
- **`staff_limited`** (staff and contractors): the business row without its tax numbers and billing
  email, and the team without pay rates or payee flags. Owner/admin read both from `business_full` with
  more columns, so a row never reaches one device with two different column sets. No bucket syncs
  `invite_token` or the Stripe verification fields. Both streams also carry `users.id` and
  `users.name`, and nothing else from `users`, for every user with a staff row in the business,
  including removed members, since a member's name lives only on their account and past visits still
  show it.
- **`staff_self`** (per staff, sliced by `staff_id`) — a member's **own** addons, hours and recurrences,
  plus their own staff `accounts` and `entries` (earnings).
- **`business_full`** (owner/admin only) — **all** members' addons, hours and recurrences, all financials
  (including the whole ledger), review requests, broadcasts, form responses that have a client link
  (treatment notes have none and stay on the server) and signatures.
- **`history_shared`**, **`history_self`**, **`history_full`**: messages for every member, a member's own
  slots and bookings, and every member's slots and bookings for owner/admin, each limited to the months
  the device subscribes (see the history window above).

`business_shared` also carries `subjects` (pets, students or properties, as the business's `subject` says),
`notes` and closures (hours rows with no `staff_id`), so every member's calendar can name the subject and
the day the business is shut;
`recurrences` follow their member like slots do.

Device read scope: staff = `business_shared` + `staff_limited` + `staff_self` + `history_shared` +
`history_self` · owner/admin = `business_shared` + `staff_self` + `business_full` + all three history
streams. `tests/fixtures/sync_projections.json` is the reviewed column list per stream, and
`test_sync_projections` fails when a stream adds a column or sends pay, tax or billing columns to staff.
Writes
are authorized separately by typed services. Postgres RLS is an optional future
defense-in-depth for the API, not the sync filter.

---

## Domain models

### Public media

Business logos and catalog item images are `files` rows (`parent_type` business/item, `purpose` logo/image)
uploaded by an owner or admin. `GET /media/{file_id}` serves only those two kinds, by redirecting to a
short-lived presigned S3 URL, so they have stable links for the public pages and the apps. Only files whose
upload was completed are served. Every other
file stays behind auth. The brand stores `logo_file_id`; `public_brand` turns it into the media URL.

Job photos are `files` rows on a booking (`parent_type` booking, `purpose` photo, image types only). The
member on the booking or a manager can add one, and `GET /v1/files/{id}/link` returns a presigned download
URL to the same people. The booking detail on web and mobile lists them, and the subject's card on the
client record shows the latest photos from its visits.

People photos are `files` rows on a client or a user (`parent_type` client/user, `purpose` photo, image
types only), scoped to one business like every file. Any member can set a client's photo; a member sets
their own, and an owner or admin sets anyone's on the team. Completing an upload deletes the photo it
replaces, so each person has one, and `DELETE /v1/files/photos/{parent_type}/{parent_id}` clears it. The
rows sync with the other files, and `usePeoplePhotos` turns them into presigned links for every avatar. A
client photo is never public. A user's photo is served from `/media/{file_id}`, and appears as
`photo_url` on `PublicStaff`, only while that member is active, bookable online and on the profile's
`public_staff_ids`.

### Payments — Stripe Connect custody

Each business has one Accounts v2 connected account; clients have Customers inside that account.
Direct charges, refunds, memberships, Terminal and payouts use Stripe, while our ledger records their
financial effects. Available/pending balances and payout status come from Stripe; recovery and
transaction-level reconciliation repair recognized missing outcomes and flag unexplained differences.

See [Payments and Stripe](payments.md) for account ownership, product flows, fees, onboarding, payout
schedules, webhook recovery, setup and QA.

### Platform billing

Clientbridge plan subscriptions live on the platform account and use the business's Accounts v2
account as their billing customer. They are separate from client memberships and do not post to the
merchant ledger. See [Platform billing](payments.md#platform-billing) for trials, plans, seats, tax,
Checkout, the Billing Portal and access rules.

### Ledger: double-entry, append-only (`services/ledger.py`)

Every money movement is a **journal**: two or more `entries` legs that sum to zero per currency. A
deferred constraint trigger rejects an unbalanced journal at commit and another trigger rejects any UPDATE
or DELETE, so corrections are always reversing journals (`ledger.reverse`). `ledger.post` is the only
writer: it is idempotent on `ref` (a Stripe object id or a natural key such as `invoice:{id}`), creates
accounts on first use and locks the affected account rows in id order. An `AFTER INSERT` trigger on
`entries` keeps each account's cached `balance_cents`, and a trigger on `accounts` rejects any other write
to it.

The ledger stays in Postgres rather than a dedicated ledger engine: the database already enforces balanced,
append-only, idempotent journals, and the post shares one transaction with the payment status, the audit
row, the idempotency row and the stock movement, which a separate engine could not join. Stripe custodies
the funds, so the ledger is the book of record, not the authority on whether money moves.

What posts, and where:

| Event                                   | Hook                                                                                                                     | Legs                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Invoice issued / voided                 | `billing.send_invoice` / `void_invoice`                                                                                  | client receivable + / revenue − / tax(code) − ; void reverses                                                                      |
| Payment settled                         | `payments._settle_payment` (Stripe webhook), `record_invoice_payment` (by hand), recurring `invoice.payment_succeeded`   | cash + / what it paid for −: invoice receivable, order revenue + tax, booking deposit, package deferred + tax, gift card liability |
| Fees                                    | same, from the charge's balance transaction (`gateway.get_payment_fees`)                                                 | processing fee + / platform fee + / Stripe − ; platform Stripe + / fee revenue −                                                   |
| Refund (full or partial)                | `refund_payment`, `refund.created` / `refund.updated` (one refund row per Stripe refund)                                 | cash − / the original credit legs unwound pro rata (a credit note; fees stay with Stripe and the platform)                         |
| Refund failed after it succeeded        | `refund.updated` failed (`ledger.reverse_refund`)                                                                        | the refund journal reversed                                                                                                        |
| Dispute opened / won                    | `charge.dispute.created`, `.updated` or `.funds_withdrawn` (an escalated inquiry) / `.closed` won or `.funds_reinstated` | Stripe − / payer receivable + (+ dispute fee); won reverses, with the fee returned from the reinstating balance transaction        |
| Dispute lost                            | `charge.dispute.closed` lost (`ledger.lose_dispute`)                                                                     | receivable cleared and the sale unwound pro rata like a refund (a write-off); the document reads refunded                          |
| Stripe payout                           | `payout.created` (or `.paid`, if created was missed) / `payout.failed` or `payout.canceled`                              | bank + / Stripe − ; failed or canceled reverses                                                                                    |
| Gift card redeemed                      | `entitlements.redeem_gift_card`                                                                                          | gift card liability + / revenue −                                                                                                  |
| Package session used                    | `entitlements.consume_session`                                                                                           | deferred + / revenue − (the last session takes the remainder)                                                                      |
| Gift card or package expired            | `entitlements.run_expiry_sweeps` (`ledger.post_breakage`)                                                                | gift card liability or deferred + / revenue − (breakage on the unused balance)                                                     |
| Tax return filed                        | `POST /v1/payments/remittances` (`remittances`)                                                                          | tax(code) + per code owed for the period / bank − ; the period is in the journal's `meta`                                          |
| Deposit forfeited                       | no-show in `bookings` (or settlement after it)                                                                           | deposit + / revenue − ; a refund un-forfeits first                                                                                 |
| Deposit applied                         | invoice sent with the booking on a line, or the deposit settling after that (`bookings.apply_deposit`)                   | deposit + / client receivable − ; a void or a refund of the deposit reverses it                                                    |
| Staff earning accrued / approved / paid | `earnings` (invoice fully paid, `/v1/earnings/approve`, `/v1/earnings/pay`)                                              | staff cost + / payable(pending) − ; pending → approved ; approved → bank                                                           |

An earning accrues once per booking and member: a paid document's booking lines are grouped by the line's
`staff_id`, or the booking's member and its crew in even shares when the line names none or names the lead, and
each group earns at that member's rate under
the ref `earning:<booking>:<staff>:<n>`, where `n` counts that member's earlier journals on the booking. A journal
is found by its subject and the member's payable leg, so one posted under an older ref still counts.

Derived from the ledger rather than stored: an invoice's and order's balance and amount paid, gift card
balances, package deferred revenue, client lifetime value, staff earnings and their status, tax payable per code, today's revenue, and Stripe
payout journal amounts. Current payout status is read from Stripe (see [payouts](payments.md#payouts-and-schedules)). A booking's `deposit_status` (none/pending/collected/applied/forfeited/refunded) is a lifecycle column set
as the ledger books the deposit, because staff replicas do not sync the business ledger; the amount stays
in the ledger. Reports (income, GST/HST/PST/QST, T4A) and the dashboard read entries and account balances.
`ledger.run_reconcile_ledger` reconciles each connected account's ledger Stripe balance against Stripe's nightly
and records any drift in `audits`.

### Tax

GST/HST/PST/QST computed per **province** at the **line level** (QST at exact 9.975%, half-up rounding).
The business stores registration numbers; small-supplier mode (`tax_registered=false`) collects nothing.
The engine (`services/tax.py`) is pure and golden-tested; rates are rows of (province, code, rate,
valid_from) in the same file (no table), and a supply is taxed at the rows in force on its date in the
business time zone. Devices read the same rows from the generated `app-core/src/taxRates.ts` (`make
gen-taxes`), so offline previews price tax without the network, and `taxes.cases.json` holds backend
results that the device engine must reproduce. Once a document is issued its tax is fixed: settlement,
receipts and the pay and receipt pages read each line's stored `tax_amount_cents` and split it by code at
the rates in force on the issue date (`tax.issued_tax`), never from current settings; a package's tax is
backed out of the amount paid when its price has changed since the sale. A subscription item's Stripe
Price carries the item's tax class and is checked against the current tax-inclusive amount and interval
each time a subscription starts; when they differ a new Price replaces the cached one for new
subscriptions, and active subscriptions keep the Price they started on. Each item carries a tax class (`standard` charges every component,
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
- **Online shop:** products marked `sell_online` are listed at `shop.D/<slug>` on Connect, and staff share that link and its QR code from Products. An order is paid by
  card, has `source = online`, and moves through `pickup_status` (unfulfilled, ready, picked up) from Sales.
- **Booking add-ons:** products the owner offers at booking (`items.addon`, with `addon_for` naming the
  services each goes with) and the client chose on the booking page are stored in `addons` and become lines
  on the invoice created from the booking (`POST /v1/invoices/from-booking/{id}`), each carrying the booking
  and the member, so they count toward that member's earning; only the deposit is charged at booking time.
  An add-on's `duration_min` is the time it adds to the visit: the visit's length is the service plus each
  add-on's minutes times its quantity, stored in `slots.ends_at` when it is booked, since the overlap
  constraint reads it. Connect asks for extras before the time and passes their minutes as `extra_min` to
  the slots and days reads, so it offers only times that fit. A client's move keeps the stored length.
  Staff add an add-on through the same resize check a move uses, refused with 409 `visit_no_room` when the
  time after the visit is taken, and removing one shortens the visit by its minutes. An add-on row keeps no
  minutes of its own, so a removal reads the product's current `duration_min` and never shortens the visit
  below the service's length. A class seat keeps the
  class's length.
- **Crew:** a one-to-one visit can have helpers besides its lead. `POST /v1/bookings/{id}/crew`, by a manager or
  the visit's lead, locks the helper, checks their calendar the way a booking is checked (and that they offer
  the service), and writes an `hours` exception for the visit's window with the job as its `reason` and
  `booking:<id>` as its `note`, so availability, sync and the helper's calendar already treat it as time off.
  The blocks follow the visit: a staff move or resize, an add-on, a client's move and a series change re-time
  them (refused, or skipped in a series, when a helper can't follow, with 409 `crew_busy`), a cancel deletes
  them, a reassigned lead leaves them, and completion keeps them. A member who leaves comes off the crews still
  ahead, and a block can't be removed as time off (409 `crew_block`). Helpers join only before the visit
  starts (409 `visit_started`), and can still be taken off afterwards. `GET /v1/bookings/{id}/crew` gives the
  job to its crew and to managers, since a helper's device syncs only their own bookings. Pay splits at the
  ledger, not on the documents: a booking line done by the lead is shared evenly among the lead and the
  helpers (`lines.worker_shares`), so each earns their share at their own rate and a tip follows the same
  shares, on an invoice or a desk sale alike.
- **Programs:** staff lay out a class's sessions ahead of any booking with `POST /v1/programs`: a class, its
  instructor, a first start, weekdays and a count or end date. Every session is checked the way a booking is
  (closures, time off and crew blocks, the instructor's hours, other visits, `items.staff_ids`) under the
  staff lock, and one busy day refuses the whole schedule with 409 `schedule_conflict`. The sessions are
  empty `slots` tagged with a `recurrences` row that has no client; such a schedule keeps its sessions when
  bookings come and go, and the client series commands refuse it with 409 `class_schedule`. A class with
  `items.session_count` is a program: it is never booked one day at a time (409 `program_enrol`), and
  `POST /v1/programs/{id}/enrolments` (staff) or a Connect booking of its first day books every session
  still ahead or none, refusing a full day with 409 `program_full`. The first booking carries the price and
  the deposit and the rest are at no charge, so the invoice from that booking, its receipt and the
  instructor's earning cover the program once, while each day still gets its own reminder and check-in. An
  enrolment is derived, never stored: the client's (and subject's) live bookings on the schedule.
  Cancelling it (`/enrolments/cancel`, or any day's manage link before the first day's cutoff) cancels every
  day ahead and refunds a paid deposit, and an online deposit left unpaid releases every day with it. An
  enrolment waiting for approval is approved or declined as a whole; a later day can be canceled on its own, but the priced first day
  only with the whole enrolment (409 `program_first_day`). A schedule is canceled only once no one
  holds a day still ahead (409 `program_enrolled`), so canceling it never takes a seat or money from anyone. Program days
  have no waitlist: online waitlists refuse them and a freed seat promotes no one. A class seat is held once
  per subject, or per client when there is none, so siblings can each take a seat in one session.
- **Receipts** list every line with its tax, and walk-in sales can take an email or phone for the receipt.
  Sales by item is a report with a CSV like the others.

### Online booking and manage links

The rules the public booking page follows (lead time, how far ahead, the start-time step, approval for new
clients) and the cancellation policy live in `businesses.booking_policy`, read and written through
`/v1/online-booking`; members are hidden from the page with `staff.bookable_online`. A service or class
can name the members who offer it in `items.staff_ids`, where an empty list means everyone. The catalog
accepts only active members of the business there, and a member removed later stays listed while readers
skip them. `PublicService.staff_ids` lists the online members who offer it, "any" chooses only among them,
and every new booking, move to another member, series change and reassignment on removal checks the list,
refusing with 422 `service_not_offered` (`not_offered` in a move check). A visit that stays with its member
can still be moved or resized after that member stops offering the service. Every booking gets a
`manage_token`, and the confirmation and reminder carry `book.D/m/<token>` on Connect, where the client can move
or cancel within the cut-offs (`/manage/{token}`). The server enforces the cut-offs and the move limit and
refunds a paid deposit on an allowed cancel. A booked visit whose deposit is still pending can be paid
from the same page (`POST /manage/{token}/deposit`): it opens the deposit PaymentIntent the booking page
uses, replays a live attempt, cancels a failed or older one first, and refuses with 409 when the business
can't take cards (`card_payments_unavailable`), nothing is due (`deposit_not_due`) or an earlier attempt is
already going through (`deposit_in_progress`). The webhook settles it as any deposit. A confirmation for a
staff-made booking with a pending deposit carries the link with a line asking for it, when the business
takes cards.

### Messaging

All businesses share one platform SMS number today. An inbound text goes to the business that most
recently texted that phone (`messaging.route_inbound_sms`, through `scoped()`); with no sender or a tie it
is recorded as unmatched rather than guessed, and STOP or START applies only to the business it was routed
to. A text number per business is launch work (CLI-45). The SMS webhook checks `X-Twilio-Signature`, and
production refuses to boot without `TWILIO_AUTH_TOKEN`. Phones are stored as E.164 (`core/phones.py` and
app-core `normalizePhone` share one rule). Only the client's own START lifts an SMS STOP. Broadcast email
carries the business's mailing address and a contact method, and a broadcast without them is refused.
Broadcasts are sent by the job one recipient at a time, claimed with `SKIP LOCKED` and saved before and after
each send, so delivery is at most once, and they wait during quiet hours (21:00 to 09:00 local). An inbound
text or Connect message pushes to the business's active staff devices.

### Auth

Owners and staff sign in through the auth service (see _Identity_): email and password, Google, and second
factors, with the session in an HttpOnly cookie on web and a session token in SecureStore on mobile. The
API holds no passwords, sessions or reset tokens; the only token it signs is the short-lived PowerSync JWT.
Clients **book without an account** (name, phone and email on the public page); a returning client proves
the mailbox with an emailed code (`returning_challenges`), and a future portal would link a client to a login
via `clients.user_id`.

---

## Frontend architecture — share the view-model

**All product logic lives in `@clientbridge/app-core`; each app is a thin rendering + platform-binding
layer.** Only four things differ per platform:

| Seam              | web                                                                                      | mobile                               |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| **SQLite driver** | `@powersync/web` (wa-sqlite on IndexedDB; no cross-origin isolation, so Stripe.js loads) | `@powersync/op-sqlite` (native)      |
| **Session**       | HttpOnly session cookie (`localStorage` keeps only the signed-in user id)                | Session token in expo-secure-store   |
| **Config source** | `import.meta.env` (Vite)                                                                 | `Constants.expoConfig.extra`         |
| **Rendering**     | DOM + Tailwind                                                                           | RN + StyleSheet from the token theme |

Everything else — SQL, mutations, validation, status→`Intent` decisions, copy, icon geometry — is shared.

### `app-core` (the view-model layer, no JSX)

- **Reads** = a `useX()` hook wrapping `useQuery` over a SQL constant against the local replica.
- **Writes** = plain functions taking `(api: ApiLike, …)` (money/uniqueness attach an idempotency key). Hours proposals use the durable local-only outbox; form and contract edits use their typed online commands.
- **Forms** = `useXForm` hooks on the `useAsyncAction` busy/error primitive.
- Each domain exports a status→`Intent` mapper (the platform maps `Intent` → its own tokens).
- **`strings.ts`** is the typed accessor generated from the catalog, `locales/en-CA.json` (ICU messages
  keyed by concept, a group per concept): the single home of UI copy. **`format.ts`** and **`datetime.ts`**
  are the one formatter for money, numbers, percentages, lists, dates, times and ranges; **`locale.ts`**
  holds `activeLocale()` and the pseudo-locale switch (see _Locale and time zones_).
  **`icons.ts`** is icon geometry as data (rendered `<svg>` on web, `react-native-svg` on mobile).
- **Layout:** one file per concept in `domain/` (`today`, `hours`, `earnings`, `gettingPaid`, `auth`…),
  named the same as its strings group, web page and mobile screen; the shared plumbing sits flat at the
  root (`api`, `hooks`, `format`, `datetime`, `zones`, `ui`, `debug`). `packages/config/scripts/check-structure.mjs`
  in `pnpm lint` fails when a concept's names drift apart or a package export is used only in its own
  file, and knip fails on unused files, dependencies and exports. Related things share one concept:
  `entitlements` holds packages, memberships and gift cards, and `business` holds the profile and
  onboarding. A page named by its nav label maps to its concept (Invoices → billing, Inbox → messaging,
  Team → staff, Schedule → bookings, Gift cards → entitlements, Onboarding → business).
- **Two entrypoints:** `index.ts` (full) and **`public.ts`** — the PowerSync-free lean subpath the Connect
  app imports.
- **Runtime URLs:** web and Connect load `/config.js` before their bundle. The web image serves it with
  `window.__CLIENTBRIDGE_CONFIG__ = { baseDomain, stripePublishableKey }`, and `runtimeConfig()`
  (`runtime.ts`) derives the API (`api.`) and the auth service (`api.<base>/auth`), PowerSync (`sync.`) and
  Connect's four URLs from it: the business page template (`https://{slug}.<base>`), `book.`, `shop.` and
  `pay.`, so one image serves staging and production. `runtime.ts` also builds every Connect link from them
  (`businessPageUrl`, `bookingPageUrl`, `shopPageUrl`) and tells Connect which site an origin serves
  (`connectSite`). The dev servers ship an empty
  `public/config.js`, and each app's `config.ts` then falls back to its `VITE_*` values.
- **One checkout.** Every sale (deposit, gift card, package, subscription) runs through `useCheckout`
  (saved card or new card, one idempotency key per attempt), and saving a card through
  `useAddPaymentMethod`. Only chargeable saved methods are offered (`checkoutMethods`): cards, and bank
  accounts with an active mandate. Bank (PAD) entry happens in a browser: on the web app, or on Connect
  `pay.D/setup` through a link that mobile sends.

### Locale and time zones

- **One entry point per side.** The frontend reads its locale only through `activeLocale()` (app-core
  `locale.ts`) and the backend only through `locale_for(business=, client=, user=)` (`core/locale.py`). Both
  return `en-CA` (`en_CA`) today; choosing a locale per business, user, client or visitor later changes these
  two functions, not their call sites. There is no locale column and no language setting.
- **Catalogs.** The apps, Connect and the embed script read `app-core/locales/en-CA.json`, the site reads
  `apps/site/locales/en-CA.json`, and backend email, SMS, push, CSV headers and tax names read
  `backend/src/clientbridge/locales/en_CA.po`. The generated `en-XA` (`en_XA`) pseudo-locale is a
  development and test tool switched on by `VITE_PSEUDO_LOCALE`, `EXPO_PUBLIC_PSEUDO_LOCALE` or the
  backend's `PSEUDO_LOCALE`; it is never offered to users.
- **Business time zone.** Every date and time on staff surfaces and Connect is shown in the business's
  time zone, one of the Canadian zones in `SUPPORTED_ZONES` (`core/zones.py`, validated on save): staff
  screens read it with `useBusinessZone()` from `BusinessZoneContext`, Connect from the `timezone` field
  every public payload carries, and Connect names the zone when the visitor's clock reads differently.
  Grouping by day uses the same zone, never the device's. The backend formats email and SMS times with
  `format_day_and_time` in the business zone.
- **One source of zone data.** The backend's pinned `tzdata` package is the only zone data any surface
  uses. `core/zones.py` is its one reader (the structure check fails on `ZoneInfo(`, `available_timezones`
  or `AT TIME ZONE` elsewhere) and computes each supported zone's offsets from 2000 to 2060.
  `make gen-zones` writes them into app-core `zones.ts` (with `zones.cases.json`, the parity cases the
  app-core tests check `wallTime` and `zonedDate` against), and `GET /v1/zones` serves the same table with
  its tzdata version. App-core `datetime.ts` takes every offset from that table and asks `Intl` only to
  word a wall clock, always in UTC, so browser, Node and Hermes zone data never decide a time. Web and
  Connect deploy with the backend and so bundle the same release; the mobile app keeps a newer table from
  `/v1/zones` in `device_prefs` (`useServerZones`), and its Intl polyfill loads no zone data. Zone names
  ("Pacific Time") come from the catalog. A visitor's own zone outside the table is read through `Intl`
  only to decide whether Connect shows the zone note.
- **Errors.** Clients choose a message from the response's `error` code and HTTP status
  (`failureMessage`, `failedCode`, `failedStatus` in app-core `api.ts`); the `message` text is never shown.

### Navigation

Both apps show the same five destinations from `domain/navigation.ts`: Today, Schedule, Clients, Payments
and Inbox, plus Setup. Web renders them as a sidebar and mobile as a tab bar with a create button, with
Inbox and Setup as icons in the header. Payments is one page with tabs (Invoices, Sales, Gift cards,
Refunds, Staff pay, Tax returns, Payouts, Reports); staff see only Sales, because every other action is owner
or admin on the backend. Inbox has Messages, Reviews, Broadcasts, Forms and Contracts; staff see only
Messages. Setup has Get set up, Business, Services & products, Team & hours, Getting paid, Plan (owner only),
Sales tax, Online booking, Reminders and Sign-in & security, on both platforms; staff see only Team & hours
and Sign-in & security, and can edit only their own hours. The visibility rules (`visiblePaymentsTabs`, `setupSectionsFor`,
`editableStaff`, `canVoidSale`) live in app-core so both apps gate the same way.

### Shared components

A screen composes shared components and never re-implements a list, a detail view, a modal, a checkout or
a card form. The prop contracts are types in `app-core/src/ui.ts`, and each platform implements them once,
side by side in one package: `@clientbridge/ui/src/web/` (DOM and Tailwind, used by web and Connect, imports
only `app-core/public`) and `@clientbridge/ui/src/mobile/` (React Native), with the same file name for the
same component. Every app imports `@clientbridge/ui`; the package's `react-native` export condition resolves
mobile (Metro and the mobile tsconfig's `customConditions`) to the native entry, and everything else to the web
entry. ESLint keeps React Native out of `src/web` and the DOM out of `src/mobile`, and the structure check
requires a twin on the other platform for every component file. It also fails on a
hand-styled control in app code (a raw `<button>`, `<input>`, `<select>` or `<textarea>` with a `className`, or a
`Pressable` or `TextInput` with local styles) outside a short allowlist of layout-specific files. Each platform
still renders idiomatically, so this is two implementations in one place, not a cross-platform UI framework.
The web and Connect e2e suites check the components as the apps compose them: axe, a visible focus indicator
at every keyboard stop, readable text on hover and the `en-XA` pass, with the shared helpers in
`packages/config/e2e`.
Component copy lives in `strings.ui`, glyphs in `app-core/icons.ts` (`Icon` draws them on both platforms), and
colours only in `@clientbridge/tokens` (`INTENT_COLORS`, `tint`/`tintHex` for data colours, `ON_DATA` and
`SHADOW`).

Props follow one vocabulary, so a caller can guess a prop without opening the file:

| Prop                                                           | Meaning                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `variant`                                                      | the visual form of one component (`Button` primary or outline, `Empty` inline or card, `ItemTile` tile or card) |
| `layout`                                                       | how a set of items is arranged (`Choice` chips, segmented, cards or tiles; `KeyValueList` inline or stack)      |
| `size`, `density`                                              | physical scale (`sm` to `xl`), and spacing or how much is shown (`compact`, `regular`, `full`)                  |
| `intent`                                                       | a status colour from `INTENT_COLORS` (`accent`, `success`, `warning`, `danger`, `neutral`)                      |
| `tone`                                                         | the text colour of a figure or a message (`Money`, `Stat`, `Notice`)                                            |
| `label`                                                        | the accessible name; required when the component shows no text of its own                                       |
| `value`, `defaultValue`, `onChange`                            | controlled when `value` is passed, otherwise the component keeps its own state (`useControllable`)              |
| `onPress`, `selected`, `pressed`, `disabled`, `busy`           | activation and state, the same words on both platforms                                                          |
| `children`, `leading`, `trailing`, `actions`, `footer`, `icon` | slots for composition, used instead of boolean flags                                                            |
| `className` (web), `style` (mobile)                            | an escape hatch for spacing and width, merged last                                                              |
| `ref`                                                          | on focusable controls (`Button`, `IconButton`, `SearchField`, `Checkbox`, `ListRow`), as a React 19 prop        |

| Component                                                           | What it is                                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ActionMenu`                                                        | a menu of actions with glyphs: a popover with arrow-key focus on web, a bottom sheet on mobile                          |
| `ActivityTimeline`                                                  | what happened to a record, newest last, with optional glyphs, quotes and amounts                                        |
| `Avatar`                                                            | a person's or pet's initials on the accent tint or their own colour                                                     |
| `Badge`, `StatusPill`                                               | a pill or a count, and a status pill, coloured from `INTENT_COLORS`                                                     |
| `BarChart`                                                          | one series of bars over time, with partial and out-of-period bars                                                       |
| `BrandMark`                                                         | the small mark beside a saved card or bank account                                                                      |
| `Button`, `IconButton`                                              | primary, outline, quiet, danger and link buttons with a glyph and a busy state; an icon-only button with a count or dot |
| `CalendarEventCard`                                                 | a visit on the calendar: status fill, service swatch, flags and drag states                                             |
| `ChargeSheet`, `CardForm`, `PaymentMethodForm`                      | the checkout and card or bank entry; the Stripe account comes from `setStripeAccount`                                   |
| `Checkbox`, `Checklist`                                             | a checkbox with a mixed state; a list of steps with done, attention and an action                                       |
| `Choice`                                                            | chips, a segmented control, option cards or tiles, for one or several values                                            |
| `ContractDocument`, `SignaturePad`                                  | a contract laid out as the printed page with its signature block; a pad that records strokes                            |
| `ConversationRow`, `MessageBubble`                                  | a conversation in the inbox list; one message or a system line in a thread                                              |
| `CopyField`                                                         | a link, snippet or reference to hand out, with a copy action that confirms in place                                     |
| `DateStrip`, `TimeSlotPicker`                                       | a week of dates with busy dots and closed days; open times grouped by part of the day                                   |
| `DetailView`, `DetailSection`                                       | a right-side panel on web, a bottom sheet on mobile, with sections and an action row                                    |
| `DocTotals`, `PrintedDocument`, `PayCode`                           | a document's money summary; an invoice, estimate or receipt as the client gets it; a scannable code for a pay link      |
| `DurationBar`                                                       | how a booking blocks time with its buffers                                                                              |
| `Empty`, `Loading`, `Skeleton`, `SyncBanner`                        | empty and failed states with next steps, loading text, placeholders while data loads, and offline or sync status        |
| `Field`, `TextField`, `Select`, `Toggle`, `SearchField`, `TagInput` | labelled controls with hint and error; search with a clear button and result keys; tags with suggestions                |
| `FormQuestion`                                                      | one form question, shared by the builder preview and the client's form                                                  |
| `Icon`, `GoogleIcon`, `Logo`, `Lockup`                              | glyphs from `app-core/icons.ts`, Google's mark, and the logo with and without the wordmark                              |
| `ImagePicker`, `ItemImage`, `ItemTile`                              | an item's photo with change and remove; its picture or initial; a tile or card to tap in a register or shop             |
| `KeyValueList`                                                      | labelled facts, inline or stacked in columns                                                                            |
| `LineItem`                                                          | one line of a sale with quantity, discount, tag and remove                                                              |
| `ListPage`, `ListRow`, `OccurrenceList`                             | a list page with segments, search and rows; one row with a glyph or leading slot; the dates of a series with clashes    |
| `Meter`, `ProgressSteps`                                            | how much of something is used; where a flow is                                                                          |
| `Modal`, `confirm()` / `ConfirmHost`                                | a dialog (bottom sheet on mobile); a yes/no question, the system alert on mobile                                        |
| `Money`, `Stat`, `Stars`, `Stepper`                                 | amounts, a labelled figure, a rating to show or pick, and a quantity control                                            |
| `Notice`                                                            | a danger, success or info line, or a filled box                                                                         |
| `PageHeader`, `Panel`, `Tabs`                                       | a page title with actions and tabs; a card with a title; an underline or pill tab row                                   |
| `SwatchPicker`, `WeeklyHoursEditor`                                 | a colour picker; one person's regular week with open days and times                                                     |

`DocEditor` (the invoice and estimate editor) lives in each app because it reads the replica. Connect has
`PublicFrame`, `PublicStatus` and `PublicDone` in `apps/connect/src/components` for its page chrome.

Item images and the business logo are `files` rows served through the public `/media/{file_id}` endpoint
(see _Public media_). Each app builds the URL with `mediaUrl(apiBase, fileId)`.

### Connect — the customer app (PowerSync-free, embeddable)

The public surfaces (book/pay/form/contract + a per-business landing) live in their own lean Vite app
(`apps/connect`, :8709) that imports **only** `@clientbridge/app-core/public` — no PowerSync, no api-client.
Each `public*` domain is a `createPublicXClient(baseUrl)` factory doing plain `fetch` against token/slug-
authed endpoints (the URL is the only credential). `apps/connect/public/embed.js` is the host-side iframe
loader: custom elements (`<connect-booking|shop|pay|form|contract>`) that mount the widget from its own
host, with a `postMessage` resize and success protocol. `make gen-strings` builds it from `src/embedLoader.ts` with the `embed.*` catalog messages
inlined, so the host page loads neither React nor the catalog. The lean-bundle boundary is **enforced by lint**: `no-restricted-imports` bans `@powersync/*`
from Connect and `app-core/public`.

Connect reads which site it is from its origin (`connectSite`) and mounts only that site's routes, so each
page has one address:

| Site       | Pages                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| `<slug>.D` | The business's public page: about, services, team, hours and contact                    |
| `book.D`   | `/<slug>` booking, `/m/<token>` visit, `/form/<token>`, `/contract/<token>`, `/prefs/<token>` |
| `shop.D`   | `/<slug>` and `/<slug>/checkout`, `/order/<token>`                                      |
| `pay.D`    | `/i/<token>` invoice, `/e/<token>` estimate, `/r/<token>` receipt, `/setup` bank account |

Links between sites are absolute, built from the runtime URLs, and the business navigation on every page
links back to the business page. In development every `*.localhost` name reaches the Vite server on its own
port (`book.localhost:8709`, `birchbark.localhost:8709`), so the same routing runs locally and in e2e.

The slug is the business page's subdomain: 3 to 40 lowercase letters, digits or dashes, starting and ending
with a letter or digit, and not one of the reserved names in `services/business.py` (environment hosts,
mail records, Connect's root paths, anything containing `clientbridge`). `assert_public_slug` checks it at
onboarding and when an owner or admin changes it in Business settings, and the unique index answers a
taken slug with 409 `slug_taken`. A change is audited (`business.slug`) and updates the Stripe account's
business website; links already shared stop working.

### Marketing site (`apps/site`)

The public website is its own app in the same workspace, built with the same stack (Vite, React 19,
Tailwind 4, TypeScript strict) and deployed apart from the web app, on its own subdomain. It is a static
build: `scripts/prerender.ts` renders every route in `src/routes.tsx` to its own HTML file, so pages need no
JavaScript beyond a few inline lines that close the phone menu after a tap, and the only shipped asset besides
HTML is one CSS file and the fonts. It shares the Pewter theme
through `@clientbridge/tokens` and the logo through `@clientbridge/ui`, so the site and the apps cannot drift
apart visually.

- **Copy and data:** all copy lives in the site catalog, `locales/en-CA.json`, read through its generated
  `src/strings.ts` and formatted with the app-core formatter; `src/content/` keeps structural data (icons,
  photo names, routes) keyed by id. The demo figures in the laptop and phone mocks come from one
  `content/demo.ts`.
- **Links out:** `VITE_SITE_URL`, `VITE_APP_URL` and `VITE_BOOK_URL` set where the site, the web app and
  Connect live (production: the main domain, `app.` and `book.`). "Sign in" and "Start free" go to the web
  app, "See the demo business" to Birchbark's public booking page. The pages ship no JavaScript beyond the
  phone menu's few inline lines, so these are fixed at build time and `/config.js` does not reach them.
- **Waitlist build:** before the app is deployed, `VITE_WAITLIST=1` builds a site with no link to the app
  or the demo: every call to action goes to `/waitlist`, whose form posts to `server/` (a small Node server
  that also serves the build). It adds the address to a Resend segment and answers with the thanks or retry
  page, with a hidden spam field and a per-address limit. `render.yaml` on the `site-waitlist` branch deploys
  it to Render; that branch is `main` plus its Render config.
- **Contact form:** `/contact` posts to the same server, which emails the message to `CONTACT_TO` through
  Resend with the sender as reply-to. The full deploy serves the site from static files, so it needs an API
  route for the form before the site moves there.
- **Images:** `scripts/images.ts` encodes the stock photos to AVIF, WebP and JPEG at three widths with sharp;
  pages render them with `<picture>`, `srcset` and fixed dimensions. Fonts are self-hosted (no third-party
  requests).
- **Search and sharing:** per-page title, description and canonical URL; Open Graph and Twitter tags with a
  share image drawn per page at build time (satori and resvg); `sitemap.xml`, a web manifest,
  and Organization and SoftwareApplication structured data on the home page. The build ships no
  `robots.txt`: the web server answers it per environment and allows indexing only in production.

## The generated bridges (Python ↔ TS — generate, don't share)

No source is shared between the ecosystems. Everything that must agree is **generated** from a single
source, with a **CI drift gate** that fails if the committed output diverges.

| Bridge            | Source of truth                       | Generated into                             | Command                |
| ----------------- | ------------------------------------- | ------------------------------------------ | ---------------------- |
| **Sync schema**   | SQLAlchemy models + `sync-rules.yaml` | `packages/sync/src/schema.ts`              | `make gen-sync-schema` |
| **API client**    | FastAPI OpenAPI                       | `packages/api-client/src/generated.ts`     | `make gen-api`         |
| **Design tokens** | `.docs/design/app-explorer.html`      | `packages/tokens/src/themes.{ts,css}`      | `make gen-themes`      |
| **Zones**         | `tzdata` through `core/zones.py`      | app-core `zones.ts`, `zones.cases.json`    | `make gen-zones`       |
| **Tax rates**     | `services/tax.py`                     | app-core `taxRates.ts`, `taxes.cases.json` | `make gen-taxes`       |

The copy catalogs are generated the same way within each side (`make gen-strings`, `make gen-messages`), and `make codegen-check` covers all seven.

`api-client`'s `session.ts` sends the session cookie (web) or session token (mobile), signs out only when
the API answers 401 so a network failure does not wipe the replica, asks for a step-up on `second_factor_required`,
and injects the session-store seam.
`tokens` feeds both platforms from one source: web via CSS variables + a Tailwind v4 @theme (tailwind.css), mobile via
materialized JS values (`@clientbridge/tokens/native`).
