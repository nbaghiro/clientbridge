# Clientbridge

**The bridge between you and your clients.**

Clientbridge is a bilingual (EN/FR) all-in-one business operating system for solo and small **service
providers** — booking, invoicing, payments (cards + Interac e-Transfer / EFT-PAD), sales tax,
clients/CRM, messaging, packages & subscriptions, contracts, POS, and light team tools. It is a
net-new product (not a fork) inspired by PocketSuite, built around a first-class configurable tax
engine, modern payment rails, consent-aware messaging, and data-subject rights (export / delete /
retention).

## Positioning

- **Horizontal from day one** — a vertical-pluggable core; the same engine serves beauty, wellness,
  cleaning, trades, tutoring, pet care, photography and more.
- **Depth where incumbents are shallow** — a first-class tax, payments, consent/compliance, and
  bilingual surface that big horizontal tools (Square, Vagaro, HoneyBook) treat as afterthoughts.
- **White space** — beauty/personal-care + multi-discipline wellness solos + cleaning, where Jane App
  (clinical health) and Jobber (home services) don't reach.

## Architecture

A **local-first**, polyglot monorepo. Every screen reads from an on-device SQLite replica (instant,
offline-capable); writes are always server-authoritative and flow back through the Postgres WAL. Full
detail in [`.docs/architecture.md`](.docs/architecture.md).

- **Backend** (`backend/`) — Python 3.14 · FastAPI · SQLAlchemy (async) · Postgres · Alembic · `arq`
  (Redis jobs) · `uv`. Layered **router → service → models**; tenancy always via `core.scoping`; money
  / uniqueness / cross-tenant writes go through `run_command` (atomic + audited + idempotent). Every
  capability is exactly one of **5 surfaces**: sync-read · sync-write (`/sync/upload`) · command (`POST
/v1`) · webhook/public · job. Payments are Stripe Connect (Custom accounts, direct charges + app fee).
- **Frontend** (`frontend/`) — pnpm + turbo. Web (React · Vite · Tailwind) and mobile (Expo RN) render
  **one shared view-model layer** (`@clientbridge/app-core` hooks); only rendering, navigation, and
  platform APIs differ. Design tokens are one source → a Tailwind preset (web) + an RN theme (mobile).
- **Sync** — a self-hosted **PowerSync** service replicates the Postgres WAL into an on-device SQLite
  replica, partitioned per business + role by [`infra/powersync/sync-rules.yaml`](infra/powersync/sync-rules.yaml).
  The client schema is **generated** from the SQLAlchemy models (drift-gated in CI).

## Repo structure

```
clientbridge/
├── Makefile · docker-compose.yml   root orchestration + local infra (87xx ports)
├── .github/workflows/ci.yml        CI: backend · contract · frontend · codegen-drift
├── .githooks/                      versioned git hooks (pre-commit = format-check + lint)
├── .docs/                          specs (architecture · data-model · sync · testing · ports · …)
├── backend/                        FastAPI app — src/clientbridge/{api,services,models,core,sync,tasks,integrations}
├── frontend/                       pnpm+turbo workspace
│   ├── apps/{web (Vite), mobile (Expo)}
│   └── packages/{app-core, tokens, sync, api-client, config}
└── infra/                          PowerSync sync-rules + config · seeds
```

| Frontend package           | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `@clientbridge/app-core`   | Shared view-models (form/list/status hooks), the only UI-agnostic layer |
| `@clientbridge/tokens`     | Design system → Tailwind preset + RN theme (**Pewter**)                 |
| `@clientbridge/sync`       | Generated PowerSync `AppSchema` + the backend connector                 |
| `@clientbridge/api-client` | Typed REST client generated from the backend OpenAPI                    |
| `@clientbridge/config`     | Shared ESLint + Prettier config                                         |

## Getting started

**Prerequisites:** Docker + Compose · [`uv`](https://docs.astral.sh/uv/) · Node 20+ & pnpm 9. Python
3.14 is pinned via [`backend/.python-version`](backend/.python-version) and provisioned by `uv`.

```sh
# one-time
make hooks                    # install the pre-commit hook
make install web-install      # backend (uv sync) + frontend (pnpm install) deps
make up                       # local infra: postgres · powersync · redis · minio (87xx ports)
make migrate seed             # apply schema + load the "Birchbark" demo business

# run (separate terminals)
make dev-api                  # FastAPI        → http://localhost:8701
make dev-web                  # web (Vite)     → http://localhost:8700
make dev-mobile               # mobile (Expo)  → http://localhost:8707
make worker                   # arq background jobs (reminders, sweeps, reconciliation)
```

Host ports use the **87xx** block so it runs alongside sibling projects — see
[`.docs/ports.md`](.docs/ports.md).

## Development

```sh
make check          # full local gate: ruff/mypy · eslint/tsc/prettier · pytest (90% branch) · web tests
make lint           # ruff + mypy (backend) · eslint + tsc (frontend)
make format         # ruff format · prettier --write
make gen-api        # regenerate the api-client from the backend OpenAPI (drift-gated)
make gen-sync-schema# regenerate the PowerSync client schema from the models (drift-gated)
make test-contract  # real StripeGateway vs stripe-mock (:8708)
make test-e2e       # Stripe test-mode flows (dormant until STRIPE_TEST_SECRET_KEY is set)
```

The **pre-commit hook** (`make hooks`) runs format-check + lint on every commit. **CI**
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push to `main` + PR, in four
jobs: **backend** (lint · type · migrate · seed · pytest 90% branch), **contract** (stripe-mock),
**frontend** (lint · type · prettier · tests), and **codegen-drift** (fails if the generated
api-client / PowerSync schema are stale). Conventions live in
[`.docs/code-style.md`](.docs/code-style.md) and [`.docs/testing.md`](.docs/testing.md).

## Docs

[`architecture`](.docs/architecture.md) · [`data-model`](.docs/data-model.md) ·
[`schema`](.docs/schema.md) · [`sync`](.docs/sync.md) · [`authorization`](.docs/authorization.md) ·
[`backend-plan`](.docs/backend-plan.md) · [`testing`](.docs/testing.md) ·
[`repo-structure`](.docs/repo-structure.md) · [`ports`](.docs/ports.md) ·
[`code-style`](.docs/code-style.md)

## Status

**Alpha, active development.** Backend (all domains across the 5 surfaces, Stripe Connect payments +
KYC, webhooks, and background jobs) and the web + mobile apps are substantially built on a shared
view-model layer, with a full integration test suite (**509 tests, 91% branch coverage**) and green
CI. External providers (Stripe, email/SMS/push) run through faked adapters and are not yet wired to
live services. Naming and theme (**Pewter**) are decided.

---

Built for independent service providers.
