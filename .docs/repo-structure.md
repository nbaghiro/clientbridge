# Clientbridge — Repository Structure

**Layout: Polyglot split** (locked 2026-06-24). A clean Python ↔ TypeScript boundary — each ecosystem
idiomatic — joined by a root Makefile, a generated API contract, and shared design tokens.

## At a glance
```
clientbridge/
├── Makefile            # root orchestration: make dev-api / migrate / gen-api / test …
├── docker-compose.yml      # local infra: postgres + powersync-service + minio (S3 dev)
├── .env.example
├── README.md
├── docs/                   # architecture · data-model · data-model-options · schema · sync · repo-structure
├── design/                 # theme-explorer (Pewter) + design specs
├── backend/                # ───── Python world (uv) ─────
├── frontend/               # ───── TypeScript world (pnpm + turbo) ─────
└── infra/                  # powersync config · Dockerfiles · seeds
```

## backend/ — Python · uv · FastAPI · SQLAlchemy · Alembic
```
backend/
├── pyproject.toml          # deps: fastapi, uvicorn, sqlalchemy, alembic, asyncpg, pydantic,
│                           #       pydantic-settings, pyjwt, stripe, arq, boto3, ulid
├── uv.lock · ruff.toml · alembic.ini · .env.example
├── migrations/
│   ├── env.py
│   └── versions/           # 0001_identity_crm_catalog.py · 0002_… (one per domain batch)
├── src/clientbridge/
│   ├── main.py             # create_app(): FastAPI, routers, middleware, exception handlers
│   ├── worker.py           # arq worker entrypoint (background jobs)
│   ├── core/
│   │   ├── config.py       # Settings (pydantic-settings)
│   │   ├── db.py           # async engine + session, declarative Base
│   │   ├── ids.py          # ULID generator + prefix map (bz_, cl_, inv_, …)
│   │   ├── security.py     # password hashing, JWT issue/verify, Google OAuth
│   │   ├── deps.py         # get_db · current_user · current_business · require_role
│   │   ├── errors.py · pagination.py
│   ├── models/             # SQLAlchemy ORM — one file per domain
│   │   ├── base.py         # mixins: ULID PK, created_at/updated_at, business_id, soft-delete
│   │   ├── identity.py     # businesses · users · memberships
│   │   ├── crm.py          # clients · subjects · consents · notes
│   │   ├── catalog.py      # items · packages · subscriptions · gift_cards
│   │   ├── scheduling.py   # sessions · bookings · availability · resources · schedules
│   │   ├── billing.py      # invoices · estimates · lines · tax_rates
│   │   ├── payments.py     # payments · payment_methods · payouts · payout_allocations
│   │   ├── messaging.py    # threads · messages · broadcasts
│   │   ├── documents.py    # forms · form_fields · form_responses · contracts · signatures
│   │   ├── reviews.py      # reviews · review_requests
│   │   └── platform.py     # files · audit_logs · webhook_events
│   ├── schemas/            # Pydantic request/response DTOs, by domain
│   ├── repositories/
│   │   ├── base.py         # BaseRepository — enforces business_id + soft-delete filtering
│   │   └── *.py            # per entity/domain
│   ├── services/           # business logic, by domain (booking_service, invoice_service, tax_service …)
│   ├── api/
│   │   ├── router.py       # mounts all v1 routers
│   │   └── v1/             # auth · identity · clients · catalog · scheduling · billing ·
│   │                       #   payments · messaging · documents · reviews · public(booking)
│   ├── sync/               # PowerSync integration
│   │   ├── upload.py       # POST /sync/upload  (write path: authorize + validate + apply)
│   │   ├── token.py        # GET /sync/token    (mint PowerSync JWT: business_ids, role)
│   │   └── jwks.py         # JWKS endpoint PowerSync trusts
│   ├── integrations/
│   │   ├── stripe.py · interac.py · twilio.py · email.py · s3.py
│   │   └── webhooks.py     # inbound Stripe/Interac/Twilio → webhook_events → handlers
│   └── tasks/              # arq jobs: reminders · recurring(invoices/schedules) · payouts ·
│                           #   consent-expiry · review-requests · reconciliation
└── tests/                  # conftest.py + {api,services,repositories}/
```
Tooling: **uv** (deps/venv), **ruff** (lint+format), **pytest**, **alembic**.

## frontend/ — TypeScript · pnpm + turbo
```
frontend/
├── package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
├── apps/
│   ├── web/                # React + Vite + Tailwind + shadcn
│   │   ├── vite.config.ts · tailwind.config.ts (imports @clientbridge/tokens preset) · index.html
│   │   └── src/
│   │       ├── main.tsx · App.tsx · router.tsx
│   │       ├── routes/         # today · calendar · clients · invoices · inbox · catalog · settings · public-booking
│   │       ├── components/ + components/ui/   # app components + shadcn primitives
│   │       ├── lib/            # powersync(web/WASM) · apiClient · auth · query(TanStack)
│   │       └── styles/
│   └── mobile/             # Expo React Native (expo-router)
│       ├── app.config.ts · eas.json · babel.config.js · metro.config.js
│       └── src/
│           ├── app/           # expo-router screens (today · calendar · clients · invoice · inbox)
│           ├── components/
│           ├── lib/           # powersync(@powersync/op-sqlite, SQLCipher) · apiClient · auth
│           └── theme/         # @clientbridge/tokens (RN theme object)
└── packages/
    ├── tokens/             # @clientbridge/tokens — Pewter → tailwind-preset.ts + RN theme
    ├── sync/               # @clientbridge/sync — PowerSync AppSchema (client SQLite) + connector factory
    ├── api-client/         # @clientbridge/api-client — GENERATED from OpenAPI (do not hand-edit)
    └── config/             # @clientbridge/config — shared tsconfig / eslint / prettier
```
Tooling: **pnpm + turbo**, **Vite** (web), **Expo/EAS** (mobile), **ESLint + Prettier** to your house
style (4-space, double quotes, semicolons, printWidth 100, no `any`, no `console`), **shadcn/ui** (web),
**@powersync/web** + **@powersync/op-sqlite** (clients).

## infra/
```
infra/
├── powersync/
│   ├── sync-rules.yaml     # bucket defs: business_core + business_financials (by business_id + role)
│   └── powersync.yaml      # service config (Postgres connection, JWKS URL)
├── docker/                 # Dockerfile.api · Dockerfile.worker
└── seeds/                  # tax_rates per province · demo data (Stillwater Massage)
```
`docker-compose.yml` (root) brings up **postgres** (wal_level=logical) + **powersync-service** + **minio**.

## The bridge — how the two worlds connect (no shared runtime code)
1. **API contract:** FastAPI emits OpenAPI → `make gen-api` runs codegen → writes
   `frontend/packages/api-client`. Web + mobile import a fully-typed client. (One-way, generated.)
2. **Design tokens:** `frontend/packages/tokens` (Pewter) → web Tailwind **preset** + RN **theme** — single source.
3. **Sync:** `frontend/packages/sync` holds the shared PowerSync **client SQLite schema** + **connector**
   (`uploadData → backend /sync/upload`, `fetchCredentials → /sync/token`). Backend `sync/` implements
   those endpoints + JWT; sync-rules live in `infra/powersync/`.
   - **`schema.ts` is GENERATED, not hand-written** — `make gen-sync-schema` runs
     `clientbridge.scripts.gen_sync_schema`, which reads the synced tables from `sync-rules.yaml` and the
     columns/types from the SQLAlchemy models, then emits the PowerSync `AppSchema` (Postgres types →
     SQLite `text`/`integer`/`real`; money = integer cents; json/arrays/timestamps = text). So the
     **models are the single source of truth** for both the server schema (via Alembic) and the client
     schema (via this generator) — no manual duplication. Client has **no migrations**: PowerSync
     reconciles local SQLite from the declared `AppSchema` automatically.
4. The boundary is crossed only by the **generated contract** + **JSON tokens** — never shared source.

## Root orchestration (Makefile)
```
make up                  # docker compose up: postgres + powersync + redis + minio (87xx)
make install web-install # uv sync · pnpm install
make dev-api             # FastAPI :8701   (run dev-web :8700 / dev-mobile :8707 in other shells)
make migrate             # cd backend && alembic upgrade head
make revision name=…     # alembic autogenerate
make gen-api             # backend openapi.json → frontend/packages/api-client (API DTOs)
make gen-sync-schema     # models + sync-rules → frontend/packages/sync/schema.ts (client DB schema)
make test                # backend pytest + frontend tests
make lint / typecheck / format
```

## Conventions
- **Migrations** live only in `backend/migrations/versions/`.
- **One file per domain** in each backend layer (`models/crm.py`, `services/booking_service.py`, …).
- **Repositories enforce `business_id`** via the base repo — services never query unscoped.
- TS packages namespaced `@clientbridge/{tokens,sync,api-client,config}`.
- Env: backend via `pydantic-settings` (`.env`); web via Vite env; mobile via `app.config.ts` + EAS secrets.
- Secrets never committed; `.env.example` documents required keys.
