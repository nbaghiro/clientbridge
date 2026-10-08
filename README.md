# Clientbridge

**The bridge between you and your clients.**

Clientbridge is an all-in-one business operating system for solo and small **service
providers** — booking, invoicing, payments (cards + Interac e-Transfer / EFT-PAD), sales tax,
clients/CRM, messaging, packages & subscriptions, contracts, POS, and light team tools. It is a
net-new product, built around a first-class configurable tax engine and modern payment rails.

## Positioning

- **Horizontal from day one** — a vertical-pluggable core; the same engine serves beauty, wellness,
  cleaning, trades, tutoring, pet care, photography and more.
- **Depth where incumbents are shallow** — a first-class tax, payments, and compliance
  surface that big horizontal tools (Square, Vagaro, HoneyBook) treat as afterthoughts.
- **White space** — beauty/personal-care + multi-discipline wellness solos + cleaning, where Jane App
  (clinical health) and Jobber (home services) don't reach.

For realistic local demo accounts and reusable demo checks, see the [demo guide](.docs/executions/demo-data/README.md).

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
  platform APIs differ. Design tokens are one source → a Tailwind theme (web) + an RN theme (mobile).
- **Marketing site** (`frontend/apps/site`): the same Vite, React and Tailwind stack, built to static
  HTML per page and deployed apart from the web app. It shares the theme and logo with the apps.
- **Sync** — a self-hosted **PowerSync** service replicates the Postgres WAL into an on-device SQLite
  replica, partitioned per business + role by [`infra/powersync/sync-rules.yaml`](infra/powersync/sync-rules.yaml).
  The client schema is **generated** from the SQLAlchemy models (drift-gated in CI).

## Repo structure

```
clientbridge/
├── Makefile · docker-compose.yml   root orchestration + local infra (87xx ports)
├── .github/workflows/ci.yml        CI: backend · contract · frontend · site · codegen-drift
├── .githooks/                      versioned git hooks (pre-commit = format-check + lint)
├── .docs/                          main docs · design/ · reviews/ · explorations/ · executions/
├── backend/                        FastAPI app — src/clientbridge/{api,services,models,core,sync,tasks,integrations}
├── frontend/                       pnpm+turbo workspace
│   ├── apps/{web (Vite), mobile (Expo), connect (Vite), site (Vite, static)}
│   └── packages/{app-core, tokens, ui, sync, api-client, config}
└── infra/                          PowerSync sync-rules + config · seeds
```

| Frontend package           | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `@clientbridge/app-core`   | Shared view-models (form/list/status hooks), the only UI-agnostic layer |
| `@clientbridge/tokens`     | Design system → Tailwind theme + RN theme (**Pewter**)                 |
| `@clientbridge/ui`         | Shared components: `src/web` (web, Connect, site logo) and `src/mobile` (Expo) |
| `@clientbridge/sync`       | Generated PowerSync `AppSchema` + the backend connector                 |
| `@clientbridge/api-client` | Typed REST client generated from the backend OpenAPI                    |
| `@clientbridge/config`     | Shared ESLint + Prettier config                                         |

See the [documentation index](.docs/README.md) for core references, reviews and execution progress.

## Getting started

**Prerequisites:** Docker + Compose · [`uv`](https://docs.astral.sh/uv/) · Node 24+ & pnpm 9. Python
3.14 is pinned via [`backend/.python-version`](backend/.python-version) and provisioned by `uv`.

```sh
# one-time
make hooks                    # install the pre-commit hook
make install                  # backend (uv sync) + frontend (pnpm install) deps
make up                       # local infra: postgres · powersync · redis · s3 (RustFS) (87xx ports)
make migrate                  # apply the development schema; use the demo guide for seeded accounts

# run (separate terminals)
make dev-api                  # FastAPI        → http://localhost:8701
make dev-web                  # web (Vite)     → http://localhost:8700
make dev-mobile               # mobile (Expo)  → http://localhost:8707
make dev-site                 # marketing site → http://localhost:8710
make worker                   # arq background jobs (reminders, sweeps, reconciliation)
```

Host ports use the **87xx** block so it runs alongside sibling projects — see
[`.docs/engineering.md`](.docs/engineering.md#ports--the-87xx-block).

## Development

```sh
make check          # full local gate: ruff/mypy · eslint/tsc/prettier · pytest (90% branch) · web tests
make lint           # ruff + mypy (backend) · eslint + tsc (frontend)
make format         # ruff format · prettier --write
make gen-api        # regenerate the api-client from the backend OpenAPI (drift-gated)
make gen-sync-schema# regenerate the PowerSync client schema from the models (drift-gated)
make test-contract  # real StripeGateway vs stripe-mock (:8708)
make test-e2e       # Stripe test-mode flows (dormant until STRIPE_TEST_SECRET_KEY is set)
make build-site     # marketing site → static HTML in frontend/apps/site/dist
make test-site      # site browser pass: every page, links, images, phone width, accessibility
```

The **pre-commit hook** (`make hooks`) runs format-check, lint and codegen-check on every commit. **CI**
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push to `main` + PR, in five
jobs (all but contract call the same make targets as the local gate): **backend** (lint · type · migrate · seed ·
pytest 90% branch), **contract** (stripe-mock), **frontend** (lint · type · prettier · copy rules · tests ·
build), **site** (browser and accessibility pass), and **codegen-drift** (fails if the generated
api-client / PowerSync schema / themes are stale). Conventions, the gate, and testing live in
[`.docs/engineering.md`](.docs/engineering.md).

## Docs

Three docs, plus the design system:
- [**architecture**](.docs/architecture.md) — the system: stack · the 5 surfaces · data model (41 tables /
  11 domains) · sync · authorization · frontend.
- [**engineering**](.docs/engineering.md) — the gate · CI · testing · the vertical-slice method ·
  copy · ports · the demo/seed · conventions.
- [**launch-readiness**](.docs/launch-readiness.md) — the launch epics and stories, mirrored in Jira (ENG), plus the after-launch list.
- [`design/`](.docs/design/) — screens (IA) · tokens · the `app-explorer.html` source.

## Status

**Alpha, active development.** Backend (all domains across the 5 surfaces, Stripe Connect payments +
KYC, webhooks, and background jobs) and the web + mobile apps are substantially built on a shared
view-model layer, with a full integration test suite and green CI. External providers (Stripe, email/SMS/push) run through faked adapters and are not yet wired to
live services. Naming and theme (**Pewter**) are decided.

---

Built for independent service providers.
