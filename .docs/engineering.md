# Clientbridge — Engineering

**How we build it**: the quality gate, testing, the shipping method, and the day-to-day conventions. For
*how it works* see [architecture.md](architecture.md); for *what's left* see [roadmap.md](roadmap.md).

---

## The gate — run it before "done"

Both stacks enforce **4-space indent · double quotes · semicolons (JS) · strict types · no `Any` · full
type safety.**

### Backend (Python)
- **ruff** (`backend/ruff.toml`) — format 4-space/double-quote/100-col; lint `E F I UP B SIM TID ANN RUF`.
  **`ANN401` bans explicit `Any`** in signatures; `ANN` requires full annotations. Per-file ignores: `tests/`
  drop `ANN`; `migrations/` drop `ANN,E501,I001,UP`; `seed_demo.py` drops `E501` + ambiguous-glyph rules.
- **mypy** (`pyproject.toml [tool.mypy]`) — `strict = true` + `pydantic.mypy` plugin + `warn_unreachable`,
  over **`src scripts tests`**. Strict bans *implicit* `Any`; JSON columns typed `dict[str, object]`.
- **No `Any` is enforced twice:** mypy bans implicit, ruff `ANN401` bans explicit.

### Frontend (TypeScript)
- **prettier** (`packages/config/prettier.config.json`) — `tabWidth:4`, `semi:true`, `singleQuote:false`,
  `printWidth:100`, trailing commas all.
- **eslint** (`packages/config/eslint.config.mjs`) — `strictTypeChecked` + `stylisticTypeChecked`
  (type-aware) → bans `any` **and** unsafe-`any` flows. Adds `no-console`, **`no-void`**, and
  `no-floating-promises` with `ignoreVoid:false` (a floating promise needs a real `.catch`/await, not
  `void`). Registers two local rules: **`no-inline-ui-string`** (forces UI copy into `strings.ts`; allow-lists
  brand tokens `Clientbridge`/`PowerSync`; off for `Debug*.tsx`) and the **lean-bundle boundary**
  (`no-restricted-imports` bans `@powersync/*` + `@clientbridge/sync` from `apps/connect` and
  `app-core/public`).
- **tsconfig** (`tsconfig.base.json`) — `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  + `noUnusedLocals/Parameters` + `noImplicitReturns/Override` + `noFallthroughCasesInSwitch` +
  `verbatimModuleSyntax`.

### Commands (root Makefile)
```
make lint          # backend: ruff check + mypy strict   |  frontend: eslint + tsc
make typecheck     # backend: mypy strict                 |  frontend: tsc --noEmit
make format        # backend: ruff format                 |  frontend: prettier --write
make format-check
make precommit     # format-check + lint  (the pre-commit hook, no tests)
make check         # lint + test          (the full local gate)
```
The pre-commit hook (`.githooks/pre-commit`, installed once via `make hooks`) runs `make precommit`. It sets
a writable `UV_CACHE_DIR=/tmp/uv-cache` to work around a root-owned `~/.cache/uv`.

---

## CI — four parallel jobs (`.github/workflows/ci.yml`)

Runs on every push to `main` + all PRs; concurrency-cancels stale runs.

| Job | Steps |
|---|---|
| **backend** | Postgres 16 service · Python 3.14 · `uv sync` → `ruff check` → `ruff format --check` → `mypy src scripts tests` → `alembic upgrade head` → `python -m scripts.seed_demo` → `pytest --cov=clientbridge --cov-branch --cov-fail-under=90` |
| **frontend** | pnpm 9 · `pnpm install --frozen-lockfile` → `pnpm lint` (eslint) → `pnpm typecheck` (tsc) → `pnpm format:check` (prettier) → `pnpm test` (vitest) → **`pnpm build`** (a broken bundle must fail CI, beyond `tsc --noEmit`) |
| **contract** | stripe-mock service · real `StripeGateway` validated against Stripe's OpenAPI mock |
| **codegen-drift** | `make gen-api` + `make gen-sync-schema` + `make gen-themes`, then `git diff --exit-code` on the four generated artifacts (`api-client/src/generated.ts`, `sync/src/schema.ts`, `tokens/src/themes.css`, `tokens/src/themes.ts`) — the committed generated code can't drift from its source |

Net effect: no unformatted/untyped/uncovered code, no broken bundle, no drift between backend models and the
generated frontend contracts/themes.

---

## Testing

Tests are the **primary feedback loop** until manual QA — the goal is for green tests to remove the need for
manual QA at intermediate backend steps. Optimize for **meaningful** coverage: tests that fail when behavior,
contracts, or security regress — not line-count theater.

### Shape: integration-first
- **Integration tests dominate** — `httpx.AsyncClient` → the real FastAPI app → real migrated + seeded
  Postgres. One test file per router/domain. They cover the true HTTP contract + auth + DB constraints.
- **Unit tests** only for pure logic with many cases (JWT, password hashing, tax math, RRULE expansion,
  the frontend `parseTimestamp`). No DB, no HTTP.
- **We don't mock our own code.** The DB is real; our services run for real.

### Isolation: transactional rollback (`tests/conftest.py`)
Every test runs inside a transaction that is rolled back at the end. A fixture opens a connection + outer
transaction; an `AsyncSession(bind=conn, join_transaction_mode="create_savepoint")` is shared by the test
**and** the app (via `app.dependency_overrides[get_session]`). The app's `commit()`s become savepoints; the
final `rollback()` erases everything. Tests start from the **committed Birchbark seed baseline**, write
freely, and leave **zero residue** — repeatable, parallel-safe.

### External boundaries: adapters + recording fakes
Third parties are never called. Each is an interface injected as a dependency, faked in tests:
`FakeEmailSender`/`FakeSmsSender`/`FakePushSender` (record `.sent`), `FakeFileStorage`, `FakeOAuthVerifier`,
and `FakePaymentGateway` (a substantial in-memory Stripe double that honors idempotency keys and maps magic
payment methods to error paths). A test asserts on the fake — *"one reset email to alice@x with a token that
then resets the password"* — exercising our logic up to the wire.

### Auth clients & factories
`as_owner` / `as_staff` / `unauth` — an `httpx` client pre-authenticated as that principal (`us_dev` owner /
`us_diego` staff / none). `Factory.business()/user()/staff()/client()` build valid scoped rows for
multi-tenant isolation tests (build a *second* business to prove cross-tenant leakage is blocked).

### Stripe: three tiers, layered by cost
The fake covers our *logic*; it can't prove the real adapter maps correctly. Three tiers close that:

| Tier | Run | Validates |
|---|---|---|
| **Fake** | default suite | our logic + idempotency + error mapping (fast, hermetic, in-memory) |
| **Contract** | `make test-contract` | the real `StripeGateway` vs **stripe-mock** (OpenAPI spec) — every request shape + response parse. Stateless; asserts shapes, not state. |
| **E2E** | `make test-e2e` | real test-mode Stripe (KYC transitions, declines/3DS, subscription periods at the current API version, via a Test Clock) — behavior the mock's pinned spec can't reproduce. Skipped without `STRIPE_TEST_SECRET_KEY`. |

`contract`/`e2e` are excluded from the default run (`-m "not contract and not e2e"`) and auto-skip when their
backing service/keys are absent, so `make test` stays hermetic. Golden Stripe webhook fixtures live in
`tests/fixtures/stripe/`.

### The 4-part matrix (the real bar)
A feature isn't "done" until its tests clear all four:
1. **Happy path** — intended outcome + response shape.
2. **Every error path** — each 4xx with the right code/message.
3. **Security invariants** — tenant isolation, role gates (403), token tamper/expiry, no enumeration leaks.
4. **Idempotency / edges** — double-submit, duplicate-unique, expired/used token, empty/oversized input.

The **90% branch-coverage floor** (`--cov-branch --cov-fail-under=90`, migrations excluded) surfaces
untested code — the matrix above is the standard; don't chase the number with trivial tests.

> Coverage measurement is sensitive to the interpreter: the gate reports ~91% on Python 3.14 (the pinned
> toolchain) but lower on 3.12/3.13 (a PEP 649 annotation-measurement artifact, not real gaps) — hence the
> `.python-version` + CI pin to 3.14.

---

## Shipping method — vertical product slices

We ship in **vertical product slices**: each delivers one product area end-to-end — backend surface(s) →
sync rules → web screens → mobile screens → tests — and is demoable on **both** platforms before the next
starts. Chosen over backend-first because it's always demoable, validates the backend against real UI so it
can't drift, and matches how the product was designed (by screen). The data-dependency chain still sets the
order (Clients → Catalog/Tax → Booking → Invoices → Payments).

### The within-slice rhythm
1. **Backend** — model (if new) → migration → service/command → `api/v1` router + DTOs → tests → `make gen-api`.
2. **Sync** — add table(s) to `sync-rules.yaml` → `make gen-sync-schema`.
3. **Web** — page(s) under `apps/web/src/pages`; read via `useQuery`, write via the typed api-client. **Put
   UI-agnostic logic (row types, query hooks, mutations, formatters) in `@clientbridge/app-core`, not the screen.**
4. **Mobile** — screen(s) importing the same `@clientbridge/app-core`; only the markup differs.
5. **Verify + commit** (lint/tsc/tests green).
6. **Milestone audit at the slice/phase boundary** — before the next slice, review the changeset against the
   principles (layering · the 5 surfaces · role gates vs `WRITE_POLICY` · the 4-part matrix · web↔mobile
   duplication · stray comments) and fix High/Medium findings *then*. (A Catalog & Tax audit once caught an
   unguarded REST write + a router running raw queries — exactly the class this pass exists to catch.)

Read local, write via command/sync — the server is the source of truth; clients are optimistic caches.

---

## Copy — one catalog per side

- **Every user-facing UI string** lives in `frontend/packages/app-core/src/strings.ts` — a single `strings`
  object grouped by domain, shared by web + mobile. Screens render `strings.<domain>.<key>` (literals or
  interpolation functions) and never hold inline copy — including validation messages and shared descriptor
  labels (weekdays, nav, roles). Enforced by the `no-inline-ui-string` lint rule.
- **Backend notification copy** is the server-side equivalent: the builder functions in
  `services/notification_service.py` return `(subject, body[, push])` per event — all in one place.

---

## Conventions

- **Commits:** single-line, concise, imperative subject. **No body, no trailer.** Commit or push only when asked.
- **Comments:** sparing — the default is no comment. Add one only for a non-obvious *why* or an invariant,
  one line. Never narrate *what* the code does, restate types, write multi-clause block/file-header comments,
  or add decorative divider banners.
- **Migrations** live only in `backend/migrations/versions/` (timestamp-prefixed).
- **Regenerate** `api-client` (`make gen-api`) whenever the API contract changes; `gen-sync-schema` after
  model/sync-rule changes; `gen-themes` after editing `app-explorer.html`. CI has drift gates for all three.
- **No build-phase/iteration numbers** in code comments or docstrings (commit messages / plan docs are fine).

---

## Local development

### Ports — the 87xx block
Clientbridge claims **8700–8709** so it runs simultaneously with sibling projects in `~/Documents/code`.
Container-internal ports stay conventional; only host mappings use 87xx.

| Port | Service | Container | Set in |
|---|---|---|---|
| **8700** | Web (Vite) — provider app | — | `apps/web` vite (strictPort) · `make dev-web` |
| **8701** | Backend API (FastAPI/uvicorn) | — | `make dev-api` |
| **8702** | Postgres (source + `powersync_storage`) | 5432 | docker-compose · `DATABASE_URL` |
| **8703** | Redis | 6379 | docker-compose · `REDIS_URL` |
| **8704** | PowerSync service | 8080 | docker-compose · `POWERSYNC_URL` |
| **8705 / 8706** | MinIO — S3 API / console | 9000 / 9001 | docker-compose · `S3_ENDPOINT` |
| **8707** | Expo / Metro (mobile) | — | `make dev-mobile` |
| **8708** | stripe-mock (contract tests only) | 12111 | docker-compose `profiles:[test]` |
| **8709** | Connect (Vite) — customer app | — | `apps/connect` vite (strictPort) |

### Bring-up
```
make hooks                 # once per clone — install the pre-commit gate
make install web-install   # uv sync + pnpm install (applies the two op-sqlite patches)
make up                    # Postgres (logical WAL) + powersync publication + storage DB, then powersync/redis/minio
make migrate seed          # alembic upgrade head, then the Birchbark demo
# separate terminals:
make dev-api  dev-web  dev-connect  dev-mobile  worker
```
Devices authenticate to the API, exchange a JWT at `/sync/token` for a PowerSync token, and stream their
buckets from powersync (:8704) into on-device SQLite. If a hard Docker shutdown corrupts the PowerSync
replication slot (Postgres PANICs on next start), remove `pg_replslot/powersync_*` to recover.

### Infra services (`docker-compose.yml`)
`postgres:16` (`wal_level=logical`, `max_replication_slots=4`), `journeyapps/powersync-service` (mounts
`infra/powersync/`, bucket storage in a separate `powersync_storage` DB on the same Postgres),
`redis:7` (arq queue), `minio` (S3 dev), `stripe-mock` (test profile only).

---

## The demo / QA account

`make seed` loads **Birchbark Pet Studio** (Victoria, BC — pet grooming/daycare, **GST 5% + PST 7%**, ~300
rows exercising every implemented surface; `backend/scripts/seed_demo.py`). It's the **committed baseline every integration test
asserts against** — idempotent (TRUNCATE-then-insert, hand-ordered FK-safe because models declare no
relationships). Owner = the dev user **`us_dev`** (Hannah), so the apps stream *this* business via the dev
sync token.

- **Dev login is passwordless:** `POST /auth/login {"email":"hannah@birchbarkpets.ca"}` (owner) — or
  `diego@`/`priya@` to switch users. Prod accounts require a password.
- **Readable IDs** for debugging: `bz_birchbark`, `us_dev`, `cl_amelie`, `sj_bella`, `inv_1001`. Dates are
  anchored to *now*, so there's always recent + upcoming activity.
- Structural integrity (FKs · CHECKs · uniqueness) is proven by a successful `make seed` — a bad row can't
  insert; behavior is covered by the test suite that runs against this seed.
