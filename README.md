# Clientbridge

**The bridge between you and your clients.**

Clientbridge is an all-in-one business operating system for solo and small **service
providers** — booking, invoicing, payments (cards, Tap to Pay and EFT-PAD), sales tax,
clients/CRM, messaging, packages & subscriptions, contracts, POS, and light team tools. It is a
net-new product, built around a first-class configurable tax engine and modern payment rails.

## Positioning

- **Horizontal from day one** — a vertical-pluggable core; the same engine serves beauty, wellness,
  cleaning, trades, tutoring, pet care, photography and more.
- **Depth where incumbents are shallow** — a first-class tax, payments, and compliance
  surface that big horizontal tools (Square, Vagaro, HoneyBook) treat as afterthoughts.
- **White space** — beauty/personal-care + multi-discipline wellness solos + cleaning, where Jane App
  (clinical health) and Jobber (home services) don't reach.

The seeded demo businesses, their logins and what each one shows are in [`.docs/demo.md`](.docs/demo.md).

## Architecture

A **local-first**, polyglot monorepo. Every screen reads from an on-device SQLite replica (instant,
offline-capable); writes are always server-authoritative and flow back through the Postgres WAL. Full
detail in [`.docs/architecture.md`](.docs/architecture.md).

- **Backend** (`backend/`) — Python 3.14 · FastAPI · SQLAlchemy (async) · Postgres · Alembic · `arq`
  (Redis jobs) · `uv`. Layered **router → service → models**; tenancy always via `core.scoping`; money
  / uniqueness / cross-tenant writes go through `run_command` (atomic + audited + idempotent). Every
  capability is exactly one of **5 surfaces**: sync-read · offline command (a local outbox replayed to a
typed `/v1` command) · command (`POST /v1`) · webhook/public · job. Payments are Stripe Connect (Accounts v2 merchants with no Stripe dashboard, direct charges + app fee).
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
├── .github/workflows/ci.yml        CI: lint, then checks and e2e, then ci-result
├── .githooks/                      versioned git hooks (pre-commit = format-check, lint, codegen-check, test)
├── .docs/                          main docs · company/ · reviews/ · explorations/ · executions/
├── backend/                        FastAPI app: src/clientbridge/{api,schemas,services,models,core,sync,tasks,integrations}
├── frontend/                       pnpm+turbo workspace
│   ├── apps/{web (Vite), mobile (Expo), connect (Vite), admin (Vite), site (Vite, static)}
│   └── packages/{app-core, tokens, ui, sync, api-client, config}
└── infra/                          auth (Kratos config) · powersync (sync rules + config) · pulumi (cloud stacks)
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
cp .env.example backend/.env  # local settings
make hooks                    # install the pre-commit hook
make install                  # backend (uv sync) + frontend (pnpm install) deps
make up                       # local infra: postgres · powersync · auth (Kratos) · mailpit · redis · s3 (RustFS)
make migrate                  # database roles, the schema, grants and the sync publication
make seed                     # replace the demo businesses (needs the auth service from `make up`)

# run (separate terminals)
make dev-api                  # FastAPI        → http://localhost:8701
make dev-web                  # web (Vite)     → http://localhost:8700
make dev-connect              # Connect (Vite) → http://localhost:8709
make dev-admin                # admin (Vite)   → http://localhost:8711
make dev-mobile               # mobile (Expo)  → http://localhost:8707
make dev-site                 # marketing site → http://localhost:8710
make worker                   # arq background jobs (reminders, sweeps, reconciliation)
```

Card payments in the demo need the demo businesses linked to the Stripe sandbox, as described in
[Local sandbox setup](.docs/payments.md#local-sandbox-setup).

Host ports use the **87xx** block; see
[`.docs/engineering.md`](.docs/engineering.md#ports--the-87xx-block).

## Development

`make check` runs the full local gate (lint, generated-code drift and the tests), and the pre-commit hook
installed by `make hooks` runs format-check, lint, codegen-check and the tests on the staged changes.
The tests need Docker running, because they start the shared test tier themselves. The gate, CI, the test
suites and the e2e lanes are described in [`.docs/engineering.md`](.docs/engineering.md).

## Docs

The main docs are listed in the [documentation index](.docs/README.md):

- [**architecture**](.docs/architecture.md): the system, data model, sync, authorization and the frontend.
- [**engineering**](.docs/engineering.md): the gate, CI, testing, local development and conventions.
- [**demo**](.docs/demo.md): the demo businesses, their logins and what each one shows.
- [**launch-readiness**](.docs/launch-readiness.md): the launch plan and deferred scope. Its tickets are
  tracked in Linear (key `CB`).
- [**payments**](.docs/payments.md): Stripe accounts, merchant payments, payouts and platform billing.
- [**operations**](.docs/operations.md): environments, secrets, providers, deploys, jobs, alerts and restore.

## Status

**Alpha, in active development.** The backend, web, mobile, Connect and admin apps are built on a shared
view-model layer, with an integration test suite and e2e lanes in CI. Stripe, Resend, Twilio, Expo push
and the Kratos auth service each have a real adapter in
[`backend/src/clientbridge/integrations/`](backend/src/clientbridge/integrations/). Staging deploys on
every push to `main` after CI passes, and each deploy runs a smoke check against its hosts. Production
is not deployed yet.

---

Built for independent service providers.
