# Clientbridge — Backend Build Plan

A phased roadmap from "models + sync + dev-auth" to a fully-functioning, production-ready backend.
Sequenced by dependency; every phase ends with green tests and leaves the backend more capable.

## Starting point (done)
- **Data:** 37 SQLAlchemy models → migrations; demo seed (Birchbark, 268 rows) as the test baseline.
- **core/:** config, async db/session, ids (prefixed ULID), security (argon2 + JWT), deps, errors.
- **Sync:** self-hosted PowerSync running (Postgres bucket storage); `infra/powersync/sync-rules.yaml` (3 role buckets + global); `/sync/token` (mints PS JWT, dev shortcut); `/sync/upload` (real write path — `WRITE_POLICY` role authz + client→PG type coercion + upsert/patch/soft-delete).
- **API:** `/auth/login` (passwordless **dev only**), `/health`, dev CORS.
- **CI:** ruff · mypy · pytest (+ Postgres service, migrate, seed) · schema-drift gate.
- **Built since (Phases 0–2 ✅):** `core/scoping` + `services/base` + the clients vertical; full auth
  (login/register, sessions, invites, reset/verify, OAuth, JWKS); the `command()` helper (idempotency +
  audit + atomic txn) and `/sync/upload` hardening. Still empty: `tasks/` and most domain routers.

## The 5 backend surfaces (the core architecture)
Every backend capability lives on exactly one surface. **Choosing the surface is the main design decision per feature.**

| # | Surface | What it is | Auth | Examples |
|---|---|---|---|---|
| 1 | **Sync read** | PowerSync streams each device its authorized rows | sync rules (buckets) | calendar, clients, invoices on-device |
| 2 | **Sync write** | `/sync/upload` applies simple CRUD queued on the device | `WRITE_POLICY` | edit a client, draft a note, tweak availability |
| 3 | **Command / RPC** | FastAPI `POST` for ops needing server logic, atomicity, or secrets → writes Postgres → **flows back via sync** | JWT + role | book a slot (capacity), issue invoice (numbering), take payment |
| 4 | **Webhook / Public** | inbound provider callbacks + unauthenticated public pages | signature / none | Stripe/Interac/Twilio webhooks; public booking; pay-invoice; submit-review |
| 5 | **Job** | arq background work on Redis | system | reminders, recurring generation, payout reconciliation |

**Decision rule** — where does a new operation go?
- Client can compute it locally and it's just data → **sync write (2)**.
- Needs a server-only invariant — uniqueness/numbering, capacity/conflict, money, secrets, cross-tenant → **command (3)**.
- A third party initiates it → **webhook (4)**.
- Time-based or async → **job (5)**.

> This is why **"create a booking" is a command (`POST /bookings`), not a raw sync write**: the capacity/conflict check must be atomic and server-authoritative. The resulting row then syncs back to every device for free. The same logic makes invoice numbering, payments, and broadcasts commands.

## Cross-cutting conventions (every phase obeys these)
- **Layering:** `api/v1` (thin routers + DTOs) → `services` (business logic + transactions; own their queries, scoped via `core/scoping` — `scoped`/`scoped_page`/`scoped_count` enforce `business_id` + soft-delete) → models. No logic in routers; tenant queries never hand-write a `business_id` filter.
- **DTOs:** Pydantic `schemas/` per domain; OpenAPI → `make gen-api` → `@clientbridge/api-client` (web/mobile import the typed client).
- **Auth deps:** `current_user`, `current_business`, `require_role(...)` in `core/deps`.
- **Errors:** typed `AppError` subclasses → consistent JSON; never leak internals.
- **Idempotency:** commands + webhooks take/enforce idempotency keys; webhooks dedupe via `webhook_events`.
- **Transactions:** one per command, committed at the service boundary; any failure rolls back.
- **Audit:** the command helper writes `audit_logs` (actor/action/entity) → powers the owner activity feed.
- **Tests:** every service/command has an integration test (httpx + seeded DB, `engine.dispose()` fixture); financial invariants asserted.
- **Server-authoritative:** the server is the source of truth; clients are optimistic caches that reconcile via sync.

## Phases

### Phase 0 — Spine (service / schema layers + scoping + test harness) ✅ done
The plumbing every domain reuses. No user-facing feature, but unblocks all of them.
- `core/scoping.py` — `scoped(Model, business_id, soft_delete=…)` + `scoped_page`/`scoped_count`: the one place `business_id` scoping + soft-delete filter live; services own their queries.
- `services/base.py` + the **clients vertical** end-to-end (service → `api/v1/clients.py`: list/get/create/update) as the reference pattern.
- `schemas/` conventions; `core/pagination.py`; `core/deps` (`current_user/current_business/require_role`).
- `conftest.py`: seeded-business fixture + factory helpers + assertion helpers.
- **Exit:** clients vertical works over REST with tests; pattern documented for all later domains.

### Phase 1 — Auth, Identity, Onboarding ✅ done  *(test-first — see [testing.md](testing.md))*
Retire the dev shortcut; real multi-tenant identity. **Tests are the feedback loop**, so the test
*foundation* ships first (P1.0). Decisions locked 2026-06-25: **transactional-rollback isolation**,
**stateful `auth_sessions`** refresh tokens, **Google OAuth deferred to the last task**.
New **auth-infra tables** (server-only — NOT in the sync publication): `auth_sessions` (refresh
families) · one-time tokens (reset/verify) · `users.email_verified_at`.
- **P1.0 Test foundation:** transactional isolation + `app.dependency_overrides[get_session]`; factories; `FakeEmailSender`/`OAuthVerifier` adapter pattern; **auth-client fixtures** (`as_owner`/`as_staff`/`unauth`); `pytest-cov --cov-branch --cov-fail-under=90` gate.
- **P1.1 Auth schema:** migration for `auth_sessions` + one-time tokens + `email_verified_at`.
- **P1.2 Password + JWT:** register · login (argon2) · **access+refresh** with **rotation + reuse-detection** · logout (revoke family), under `/auth/*`.
- **P1.3 Onboarding:** `POST /onboarding` → business + owner `staff` + province `tax_rates` + settings, in one txn.
- **P1.4 Staff invites:** create (owner/admin only, status=`invited`) → email → accept (link `user`) → role assigned.
- **P1.5 Reset + verify:** forgot/reset password (no email-enumeration) + email verification — single-use, expiring tokens.
- **P1.6 Real sync identity:** `/sync/token` from the authenticated user (drop `dev_user_id`); **RS256 + JWKS** endpoint for prod PowerSync (HS256 stays for dev); wire app login.
- **OAuth (last):** Google sign-in via the `OAuthVerifier` adapter.
- **Exit:** real login on web/mobile; invited staff join; PowerSync authenticates via JWKS; every task clears the 4-part test matrix and CI coverage gate holds.

### Phase 2 — Command layer + write-path hardening ✅ done
Stand up surface #3 and tighten surface #2.
- `command()` helper: auth + idempotency key + transaction + audit-log, used by every POST action.
- Harden `/sync/upload` with per-table business rules (immutable fields, capacity/paid-state guards, ownership) the schema alone can't enforce.
- **Exit:** a documented command template; audit logging on every mutation.

### Phase 3 — Catalog & Tax engine (pricing core + a moat piece)
- Catalog services: items (service/product/class), packages, subscriptions, gift cards.
- **Tax engine** (`services/tax_service`, pure + golden-tested): per-province **GST/HST/PST/QST**, **line-level**, compound vs additive (QC QST-on-GST), small-supplier (<$30k) mode, registration numbers, inclusive vs exclusive pricing.
- **Exit:** (province, items, registration) → correct line + invoice tax; a golden case per province passes.

### Phase 4 — Scheduling & Booking + Public booking
- **Availability/slots** (`services/scheduling_service`): recurring availability + exceptions + resource capacity → bookable slots; conflict detection.
- **Recurring schedules:** RRULE expansion → `sessions` (window rolled forward by a job in Phase 7).
- **Booking command** (`POST /bookings`): atomic capacity/conflict check, deposit handling, lifecycle (pending→confirmed→completed/canceled/no_show), reschedule/cancel.
- **Public booking** (surface #4, unauth): list services, query slots, create booking + client (+ optional deposit intent).
- **Exit:** an online booking lands booking + session + client in Postgres → syncs to the owner's devices; double-booking is impossible.

### Phase 5 — Billing: Invoices & Estimates
- **Invoice service:** build from bookings/lines, **per-business numbering** (Postgres sequence), totals via the tax engine, balance = total − payments, status lifecycle, send (email).
- **Estimates** → accept → convert to invoice.
- **Public invoice** view + pay link (surface #4).
- **Exit:** invoice math satisfies the verifier invariants; estimate→invoice→paid flow works.

### Phase 6 — Payments: the money loop (the differentiator)
- **Stripe Connect:** account onboarding (account links); PaymentIntents (cards/tap-to-pay); refunds; **webhooks** (`payment_intent.succeeded/failed`, `payout.paid`) → `payments`/`payouts` + reconciliation; idempotent + signature-verified via `webhook_events`.
- **Interac e-Transfer:** request + **auto-match by reference code** (the wedge) — reconcile inbound notifications to invoices.
- **EFT/PAD** for recurring; payout **allocations** (staff splits, `payout_allocations`).
- **Remittance:** computed GST/HST "set aside" (Σ tax on paid invoices). No ledger/custody — Stripe holds funds (avoids FINTRAC MSB).
- **Exit:** Stripe test card → invoice paid → payout mirrored → staff split recorded; Interac auto-match demoable.

### Phase 7 — Jobs, Messaging, Notifications (server-initiated everything)
- **arq worker** on Redis: scheduled + retryable + idempotent job patterns.
- Jobs: booking **reminders**, **recurring** booking/invoice generation, **payout reconciliation**, **consent expiry**, **review requests**, schedule-window roll-forward.
- **Notifications:** transactional **email** + **Twilio SMS** (confirmations, reminders, receipts).
- **Messaging/Inbox:** threads/messages; inbound SMS webhook → thread; **broadcasts** (CASL: only to consented recipients).
- Proves **server-initiated push**: a job/webhook writes → WAL → client updates live (no client poll).
- **Exit:** a reminder job sends SMS and the booking change appears on the device instantly via sync.

### Phase 8 — Documents, Reviews, Files
- **Files:** S3/minio presigned upload/download; attach to entities.
- **Intake forms:** serve form, capture `form_responses`, validate.
- **Contracts / e-sign:** signature capture + audit trail + PDF.
- **Reviews:** post-completion review request (job) → public submission (surface #4) → rollup on `businesses`.
- **Exit:** a client signs a contract and submits a review from public links; files attach to records.

### Phase 9 — Compliance, Security, Observability, Prod-readiness
- **Postgres RLS** (defense-in-depth): per-request `SET LOCAL` business/user; `business_id` `WITH CHECK` on writes (belt-and-suspenders with `WRITE_POLICY`).
- **Compliance:** CASL consent enforcement; **Law 25 / PIPEDA** data export + deletion (right-to-be-forgotten) + retention; complete audit coverage.
- **Security:** rate limiting, brute-force/lockout, secrets management, RS256/JWKS in prod, dependency scanning.
- **Observability:** error tracking (Sentry/Rollbar), metrics, tracing, readiness/liveness, slow-query + index audit, sync-rule perf.
- **Deployment:** prod containers, migration gating, backups, PowerSync prod topology + monitoring.
- **Exit:** prod-readiness checklist green.

## Sequencing & dependencies
```
0 Spine ─┬─ 1 Auth/Onboarding ─── 2 Command layer ─┐
         │                                          ▼
         └────────────────── 3 Catalog & Tax ── 4 Booking ── 5 Billing ── 6 Payments
                                                      │
                                7 Jobs/Messaging ◄────┘ (reminders can start once 4 lands)
                                8 Documents/Reviews
                                9 Hardening (continuous; dedicated pass at the end)
```
0→1 are foundational. 2 sets the command pattern every domain uses. Then the data-dependency chain 3→4→5→6. 7's job/notification infra can begin as soon as bookings exist. Testing & observability are continuous; 9 is the final hardening pass.

## Open decisions (confirm as we reach them)
- **Auth tokens:** access+refresh **JWT** (recommended — stateless, matches PowerSync) vs server sessions.
- **Providers:** Twilio (SMS) + Postmark/SES (email)?
- **e-sign:** build in-house vs integrate.
- **Jobs:** **arq** (recommended — async-native, light) vs Celery.
- **Hosting target** (shapes Phase 9 specifics + PowerSync prod topology).
