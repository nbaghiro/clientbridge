# Clientbridge

**The bridge between you and your clients.**

Clientbridge is a Canada-first, bilingual (EN/FR) all-in-one business operating system for
solo and small **service providers** — booking, invoicing, CAD-native payments (Interac
e-Transfer, EFT/PAD, cards), GST/HST/QST tax, clients/CRM, messaging, packages &
subscriptions, contracts, and light team tools.

It is a net-new product (not a fork) inspired by PocketSuite, rebuilt for Canada from the
ground up: GST/HST/PST/QST tax engine, Interac + EFT rails, CRA-aware reporting,
PIPEDA / Québec Law 25 / CASL compliance, and full English/French bilingual UX (Bill 96).

## Positioning

- **Horizontal from day one** — vertical-pluggable core; the same engine serves beauty,
  wellness, cleaning, trades, tutoring, pet care, photography and more.
- **The moat is Canada** — the tax, payments, compliance, and bilingual surface that US
  incumbents (Square, Vagaro, HoneyBook) structurally don't match.
- **White space** — beauty/personal-care + multi-discipline wellness solos + cleaning,
  where Jane App (clinical health) and Jobber (home services) don't reach.

## Repo layout

```
clientbridge/
├── README.md                              ← you are here
├── Makefile · docker-compose.yml          ← root orchestration + local infra (87xx ports)
├── .docs/                                 ← specs (architecture · data-model · schema · sync · repo-structure · ports · code-style)
│   └── design/                            ← theme-explorer.html (Pewter) + design specs
├── backend/                               ← Python · FastAPI · SQLAlchemy (37 models) · Alembic
├── frontend/                              ← pnpm+turbo · apps/{web (Vite), mobile (Expo)} · packages/{tokens,sync,api-client,config}
└── infra/                                 ← powersync sync-rules + service config · Dockerfiles · seeds
```

**Code layout — Polyglot split** (see [`.docs/repo-structure.md`](.docs/repo-structure.md)). **Scaffolded:**
backend spine (core + all 37 models + async Alembic) · frontend workspace (Pewter `tokens`, PowerSync
`sync`, `api-client`, web + mobile shells) · infra. Run with `make up` then `make dev-api` / `dev-web` /
`dev-mobile`. Ports in [`.docs/ports.md`](.docs/ports.md) (87xx).

**Selected theme: Pewter** — cool silver-gray + slate-blue accent, Schibsted Grotesk, crisp 1.5px borders. Open `.docs/design/theme-explorer.html` to compare against the other five finals (Calm, Slate, Fjord, Birch, Moss).

## Development

```
make hooks        # once per clone — installs the pre-commit hook (.githooks): format-check + lint
make up           # local infra (postgres · powersync · redis · minio, 87xx ports)
make migrate seed # schema + the Birchbark demo business
make check        # the full local gate: ruff/mypy + eslint/tsc/prettier + pytest (90% branch) + web tests
make test-contract # real StripeGateway vs stripe-mock (:8708); test-e2e needs STRIPE_TEST_SECRET_KEY
```

CI (`.github/workflows/ci.yml`) mirrors this on every push to `main` + PR: **backend** (lint · type ·
migrate · seed · pytest 90%), **contract** (stripe-mock), **frontend** (lint · type · prettier · tests),
and **codegen-drift** (fails if the generated api-client / PowerSync schema are stale).

## Status

Naming: **decided — Clientbridge** (register `clientbridge.ca`; run CIPO/USPTO knockout).
Theme: **decided — Pewter**.
Current phase: **architecture & data schema** — aligning on tech stack, repo structure, data model + naming conventions, and MVP scope before building.

---

🍁 Built for Canadian service pros.
