# Clientbridge — Repository Structure

**Layout: Polyglot split + layer-first backend** (locked 2026-06-25). A clean Python ↔ TypeScript
boundary — each ecosystem idiomatic — joined by a root Makefile, a generated API contract, and shared
design tokens. The backend is **layer-first, domain-as-filename**: one file per domain inside each
layer directory (`services/booking_service.py`, `schemas/scheduling.py`), matching the `models/`
layout already in place and the sibling projects. Build sequencing lives in [backend-plan.md](backend-plan.md).

**Legend:** ✅ exists today · ＋Pn added in Phase _n_ of the backend plan.

## Whole system
```
clientbridge/
├── Makefile  docker-compose.yml  .env.example  README.md      ✅  root orchestration + infra
│
├── backend/                         ─────────── Python · uv · FastAPI ───────────
│   ├── pyproject.toml · ruff.toml · alembic.ini                ✅
│   ├── migrations/versions/         ✅ 20260624_…_initial.py  (one squashed migration)
│   ├── scripts/                     ✅ seed_demo · gen_sync_schema · export_openapi
│   ├── tests/                       ✅ test_smoke · test_sync_upload   ＋ per-domain tests
│   └── src/clientbridge/
│       ├── main.py                  ✅ app factory (routers · CORS · error handlers)
│       ├── worker.py                ＋P7  arq worker entrypoint
│       │
│       ├── core/                    ── cross-cutting, no domain logic ──
│       │   ├── config·db·ids·security·deps·errors.py           ✅
│       │   ├── pagination.py                                   ＋P0
│       │   ├── scoping.py           ＋P0  scoped/scoped_page/scoped_count — business_id + soft-delete
│       │   └── command.py           ＋P2  auth + idempotency + txn + audit wrapper
│       │
│       ├── models/                  ── SQLAlchemy · 1 file/domain ──  ✅ ALL 10 + base.py
│       │   └── identity crm catalog scheduling billing payments
│       │       messaging documents reviews platform
│       │
│       ├── schemas/                 ── Pydantic request/response DTOs · 1 file/domain ──
│       │   └── {crm,catalog,scheduling,billing,…}.py          ＋P0→
│       │
│       ├── services/                ── business logic · 1 file/domain (the brain) ──
│       │   ├── base.py · client_service.py                     ＋P0  (reference vertical)
│       │   ├── catalog_service.py · tax_service.py             ＋P3
│       │   ├── scheduling_service.py · booking_service.py      ＋P4
│       │   ├── invoice_service.py · estimate_service.py        ＋P5
│       │   ├── payment_service.py · payout_service.py          ＋P6
│       │   ├── messaging_service.py · notification_service.py  ＋P7
│       │   └── document_service.py · review_service.py         ＋P8
│       │
│       ├── api/
│       │   ├── router.py            ＋P0  (mounts all v1 routers)
│       │   └── v1/                  ── thin routers · 1 file/domain ──
│       │       ├── auth.py                                      ✅
│       │       ├── clients.py ＋P0 · onboarding.py · invites.py ＋P1
│       │       ├── catalog.py ＋P3 · bookings.py ＋P4
│       │       ├── invoices.py · estimates.py ＋P5 · payments.py ＋P6
│       │       ├── messaging.py ＋P7 · documents.py · reviews.py ＋P8
│       │       └── public.py        ＋P4  (UNAUTH: book · pay-invoice · submit-review)
│       │
│       ├── sync/                    ── PowerSync surfaces (read authz + write path) ──
│       │   ├── token.py · upload.py                            ✅
│       │   └── jwks.py              ＋P1  (RS256 public keys for prod)
│       │
│       ├── integrations/            ── 3rd-party adapters + inbound webhooks ──
│       │   ├── stripe.py · interac.py                          ＋P6
│       │   ├── twilio.py · email.py · s3.py                    ＋P7/P8
│       │   └── webhooks.py          ＋P6  (Stripe/Interac/Twilio → webhook_events)
│       │
│       └── tasks/                   ── arq jobs ──             ＋P7
│           └── reminders · recurring · payouts · consent_expiry · review_requests
│
├── frontend/                        ────────── TypeScript · pnpm + turbo ──────────
│   ├── package.json · turbo.json · tsconfig.base.json          ✅
│   ├── apps/
│   │   ├── web/      (Vite :8700)   ✅ App · Shell · DebugPanel · lib/{powersync,useClientState,api}
│   │   │                            ＋ routes/{today,calendar,clients,invoices,inbox,settings}
│   │   └── mobile/   (Expo :8707)   ✅ App · Home · DebugOverlay · lib/{powersync,useClientState}
│   │                                ＋ app/  (expo-router screens)
│   └── packages/
│       ├── sync/        ✅ schema(generated) · connector · debug   ⟵ calls backend /sync/*
│       ├── tokens/      ✅ Pewter:  pewter.css · tailwind-preset · theme
│       ├── api-client/  ✅ generated.ts (stub)   ⟵ filled by `make gen-api` from backend OpenAPI
│       └── config/      ✅ eslint · prettier (shared)
│
├── infra/
│   └── powersync/       ✅ powersync.yaml (service config) · sync-rules.yaml (read authz)
│
└── .docs/               ✅ architecture · data-model · schema · sync · authorization · repo-structure
                            ports · code-style · demo · backend-plan · design/
```

## How a feature flows through the backend layers
One domain, top to bottom — the template every domain follows:
```
HTTP →  api/v1/bookings.py        validate DTO · authn/authz                ← schemas/scheduling.py
     →  services/booking_service  business logic · capacity · txn · queries  ← core/command.py · core/scoping.py
     →  models/scheduling  →  Postgres  →  WAL  →  PowerSync  →  every device
```
Rules: no logic in routers; services own their queries but **always scope tenancy through
`core/scoping`** (`scoped`/`scoped_page`/`scoped_count`) — the one place that knows
`business_id` + soft-delete; one transaction per command.

## The 3 bridges (Python ↔ TypeScript — no shared runtime code)
1. **`/sync/*`** — `packages/sync` connector ⟷ backend `sync/` (the live offline-data path).
2. **OpenAPI → `api-client`** — `make gen-api` regenerates the typed TS client for command/RPC calls.
3. **`tokens`** — Pewter design tokens → web Tailwind preset + RN theme (single source).

The boundary is crossed *only* by these three; never by shared source.

## Conventions
- **Backend = layer-first, domain-as-filename.** Each layer dir holds one file per domain. The 10
  domains: `identity · crm · catalog · scheduling · billing · payments · messaging · documents ·
  reviews · platform`.
- **Migrations** live only in `backend/migrations/versions/` (timestamp-prefixed).
- **`core/scoping` (`scoped`/`scoped_page`/`scoped_count`) enforces `business_id` + soft-delete**; services own their queries but never query unscoped.
- **Surfaces:** every capability is one of the 5 (sync-read · sync-write · command/RPC · webhook/public · job) — see [backend-plan.md](backend-plan.md) and [authorization.md](authorization.md).
- **DTOs:** Pydantic in `schemas/`; OpenAPI → `make gen-api` → `@clientbridge/api-client`.
- **TS packages** namespaced `@clientbridge/{tokens,sync,api-client,config}`.
- **Env:** backend via `pydantic-settings` (`.env`); web via Vite env; mobile via `app.config.ts` + EAS.
- Secrets never committed; `.env.example` documents required keys.

## Root orchestration (Makefile)
```
make up / down           docker compose infra (postgres + powersync + redis + minio, 87xx)
make logs-sync           tail the PowerSync service
make install web-install uv sync · pnpm install
make dev-api / dev-web / dev-mobile     run each app (8701 / 8700 / 8707)
make migrate / revision name=…          alembic
make seed / verify                      load + integrity-check the demo business
make gen-api / gen-sync-schema          regenerate the TS api-client / PowerSync client schema
make lint / typecheck / format / test / check
```
