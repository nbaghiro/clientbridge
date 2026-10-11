# Clientbridge — Engineering

**How we build it**: the quality gate, testing, the shipping method, and the day-to-day conventions. For
*how it works* see [architecture.md](architecture.md); for *what's left* see [launch-readiness.md](launch-readiness.md).

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
- **eslint** (`packages/config/eslint.mjs`) — `strictTypeChecked` + `stylisticTypeChecked`
  (type-aware) → bans `any` **and** unsafe-`any` flows. Adds `no-console`, **`no-void`**, and
  `no-floating-promises` with `ignoreVoid:false` (a floating promise needs a real `.catch`/await, not
  `void`). The local rules in `packages/config` (one file per rule, each with a RuleTester suite run by
  `pnpm test`) keep copy and formatting in the catalogs: `no-inline-ui-string` (inline text in JSX, copy
  attributes, error sinks and hand-built DOM such as Connect's embed loader; in `apps/*/src`, `packages/ui`
  and `app-core` it is typed and default-deny, so any prose literal, or any text in a copy-named prop such
  as `label` or `title`, fails unless its contextual type is a string-literal union, it is a class list, SQL,
  markup, a path, a zone or a key name, or it is a thrown error's message), `no-composed-copy` (template
  literals, concatenation and `.join` with words or separators reaching UI text; SQL, URLs, class names,
  styles, markup and test ids are exempt), `no-raw-format` (`toLocale*`, `Intl`, `toFixed` and locale
  literals outside the formatter), `no-hand-plural` (`count === 1`, or `count > 1` between two literals, choosing between texts),
  `no-module-scope-copy` (typed: catalog text read while a module loads) and `no-error-message-copy` (a
  caught error's `message` reaching the UI). Debug panels, tests, e2e suites and the playground are exempt
  where the rule is about product copy. The **lean-bundle boundary** (`no-restricted-imports` bans
  `@powersync/*` + `@clientbridge/sync` from `apps/connect` and `app-core/public`) is enforced here too.
- **tsconfig** (`tsconfig.base.json`) — `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  + `noUnusedLocals/Parameters` + `noImplicitReturns/Override` + `noFallthroughCasesInSwitch` +
  `verbatimModuleSyntax`.

### Commands (root Makefile)
```
make lint          # backend: ruff check + mypy strict + structure check   |  frontend: eslint + tsc
make typecheck     # backend: mypy strict                 |  frontend: tsc --noEmit
make format        # backend: ruff format                 |  frontend: prettier --write
make format-check
make gen-strings   # check the app and site catalogs; regenerate strings.ts, en-XA.json and embed.js
make gen-messages  # check the backend catalog; regenerate messages.pot and en_XA.po
make gen-zones     # regenerate app-core zones.ts and zones.cases.json from the backend's tzdata
make codegen-check # regenerate api-client, sync schema, themes, strings, messages and zones; fail if stale
make precommit     # format-check + lint + codegen-check + test  (the pre-commit hook; e2e runs in CI)
make check         # lint + codegen-check + test          (the full local gate)
```
The pre-commit hook (`.githooks/pre-commit`, installed once via `make hooks`) applies only the staged
changes to a temporary worktree at `HEAD`, installs dependencies there from the local caches and runs
`make precommit`, so unstaged edits never decide a commit. It includes the backend and frontend tests, so
the local Postgres from `make up` must be running. The browser,
device and real-service suites (`test-web`, `test-connect`, `test-mobile`, `test-sync`, `test-site`,
`test-playground`) run in CI. The hook sets a writable `UV_CACHE_DIR=/tmp/uv-cache` to work around a
root-owned `~/.cache/uv`.

---

## CI — the parallel jobs (`.github/workflows/ci.yml`)

Runs on every push to `main` + all PRs; concurrency-cancels stale runs.

| Job | Steps |
|---|---|
| **backend** | Postgres 16 service · Python 3.14 · `uv sync` → `make format-check-backend lint-backend` (ruff, mypy, structure check) → `make migrate seed` → `make test-backend` (pytest, 90% branch coverage) |
| **frontend** | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make format-check-frontend lint-frontend test-frontend` (prettier, eslint + `check-structure.mjs` + knip, tsc, the site copy rules, the lint rule tests, vitest for app-core and site, then app-core again under `TZ=America/Vancouver`, `America/Halifax` and `Asia/Tokyo`; the formatter tests assert `en-CA` and `en-XA` output) → **`make build`** (a broken bundle must fail CI, beyond `tsc --noEmit`) |
| **site** | Node from `.nvmrc` · `make test-site`: a fresh build, then Playwright e2e on it (the copy rules and content tests run in the frontend job): every page returns 200 with its content in the HTML, no console errors, no broken images or internal links, no sideways scroll at 390 and 1440px, axe with no serious or critical issues, 404 page served with a 404 |
| **connect** | Postgres 16 service · `make migrate seed` · the API on :8701 · `make test-connect`: Connect's Playwright walk (book a visit, cancel it from its manage link, shop, invoice and e-Transfer, estimate, receipt, review, form, contract, preferences, not found), failing on any console error, then the `en-XA` pass over the business, booking, shop, invoice, estimate and receipt pages |
| **playground** | `make test-playground`: every story on web and both phone frames, then the `en-XA` pass over every story on a pseudo-locale dev server |
| **sync** | `make test-sync`: disposable Postgres and PowerSync, per-role replica rows and columns, revocation, hours uploads, the signing-key rotation drill and the replication health check |
| **web** | `make up migrate seed` · the API on :8701 · `make test-web`: sign-in, every page and dialog, record flows, history older than the device window, no console errors, and the `en-XA` pass over Today, Schedule, Clients, a client record, Setup's business page, Invoices and an invoice |
| **mobile** | a release APK from `expo prebuild` (bundle embedded, no Metro; Gradle's dependencies and build cache are cached) · `make up migrate seed` · the API · the Maestro walkthroughs on an Android 14 emulator booted from a cached snapshot, with `adb reverse` for 8701 and 8704 |
| **contract** | stripe-mock service · real `StripeGateway` validated against Stripe's OpenAPI mock |
| **codegen-drift** | `make codegen-check`: `make gen-api`, `gen-sync-schema`, `gen-themes`, `gen-messages`, `gen-strings` (which also fail on invalid or unused catalog messages) and `gen-zones`, then a diff check on the generated files (the api-client, sync schema, themes, `messages.pot`, `en_XA.po`, both `strings.ts` accessors and `en-XA.json` files, Connect's `embed.js`, and app-core `zones.ts` and `zones.cases.json`), so the committed generated code cannot drift from its source |

Net effect: no unformatted/untyped/uncovered code, no broken bundle, no drift between backend models and the
generated frontend contracts/themes.

---

## Testing

Tests are the **primary feedback loop** until manual QA — the goal is for green tests to remove the need for
manual QA at intermediate backend steps. Optimize for **meaningful** coverage: tests that fail when behavior,
contracts, or security regress — not line-count theater.

### Shape: integration-first
- **Integration tests dominate** — `httpx.AsyncClient` → the real FastAPI app → real migrated + seeded
  Postgres. One test file per concept (`test_<concept>[_<aspect>].py`). They cover the true HTTP contract + auth + DB constraints.
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
`FakeEmailSender`/`FakeSmsSender`/`FakePushSender` (record `.sent`), `FakeFileStorage`, `FakeIdentityProvider`
(Kratos: `identities.issue(identity)` mints a session token; `session_token(identities, db, user_id)` signs in a
seeded user; `.end_sessions()`, `.deleted`, `.step_up`, `.down` drive the edge cases and `.fresh_reads` counts uncached checks), and `FakePaymentGateway` (a substantial in-memory Stripe double that honors idempotency keys and maps magic
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
| **Contract** | `make test-kratos` | the real `KratosIdentityProvider` vs the local Kratos: admin-created identity, native login, whoami, revocation. |
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

> Coverage measurement is sensitive to the interpreter: the gate reports ~92% on Python 3.14 (the pinned
> toolchain) but lower on 3.12/3.13 (a PEP 649 annotation-measurement artifact, not real gaps) — hence the
> `.python-version` + CI pin to 3.14.

---

## Shipping method — vertical product slices

We ship in **vertical product slices**: each delivers one product area end-to-end — backend surface(s) →
sync streams → web screens → mobile screens → tests — and is demoable on **both** platforms before the next
starts. Chosen over backend-first because it's always demoable, validates the backend against real UI so it
can't drift, and matches how the product was designed (by screen). The data-dependency chain still sets the
order (Clients → Catalog/Tax → Booking → Invoices → Payments).

### The within-slice rhythm
1. **Backend** — model (if new) → migration → service/command → `api` router + DTOs → tests → `make gen-api`.
2. **Sync** — add table(s) to a stream in `sync-rules.yaml` (a history stream if rows accumulate over time) → `make gen-sync-schema` → update `tests/fixtures/sync_projections.json` after reviewing the new columns.
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

## Copy and formatting

- The app catalog is `frontend/packages/app-core/locales/en-CA.json`, shared by web, mobile, Connect and the
  embed script. Each key (`"billing.overdueBy"`) holds an ICU message, an optional `description` for
  translators and, for a message with values, its ordered `args`. `make gen-strings` checks it (ICU syntax,
  `args` against the placeholders, keys no app reads) and writes the typed `src/strings.ts` accessor, so
  call sites keep the `strings.<domain>.<key>` shape: plain entries are strings and entries with `args` are
  functions. It also writes the `en-XA` pseudo-locale and Connect's `public/embed.js`. The marketing site
  has its own catalog, `apps/site/locales/en-CA.json`, run through the same generator, and its content
  modules keep only structural data (icons, photo names, routes).
- Formatted values come from the formatter in app-core `format.ts` and `datetime.ts` and are passed into
  messages as text: money in the record's currency (`BUSINESS_CURRENCY` until businesses carry one),
  dates and times in the business time zone, lists through `Intl.ListFormat`. Messages handle plurals,
  `select` and word order and never format a value themselves.
- `activeLocale()` in `app-core/src/locale.ts` is the one place the frontend reads its locale, and it
  returns `en-CA`. `setPseudoLocale(true)` switches to `en-XA` for development and tests:
  `VITE_PSEUDO_LOCALE=1` on a web, Connect or playground dev server and `EXPO_PUBLIC_PSEUDO_LOCALE=1` in a
  mobile development build. Web, Connect and the playground set `<html lang>` from the active locale at
  startup.
- `make test-playground`, `test-web` and `test-connect` each end with an `en-XA` pass
  (`pseudo.e2e.ts`, sharing `apps/playground/e2e/pseudo.ts`). It fails on visible text or copy attributes
  that still read as an English catalog message, which is what a module-scope read, a cached English value
  or a duplicated inline string looks like, and on text cut off by a box that hides its overflow without an
  ellipsis. Names, notes and other data are not translated, so the pass does not flag them; inline copy is
  the lint rules' job.
- Backend text lives in `backend/src/clientbridge/locales/en_CA.po` and is read through `core/locale.py`
  (`locale_for`, `message`, `plural`, `format_money`, `format_number`, `format_percent`,
  `format_day_and_time`). `make gen-messages` writes `messages.pot` and `en_XA.po` and fails on missing,
  unused or empty messages, and `scripts/check_structure.py` fails on literal text passed to the email, SMS
  and push senders, CSV writers or returned from notification builders. `PSEUDO_LOCALE=1` renders backend
  output in `en_XA`.
- `pnpm --filter site lint:content` fails on em-dashes, hype words ("seamless", "robust", "leverage" and
  similar), wording that reads as unfinished product ("beta", "coming soon", "early access", "waitlist") and
  exclamation marks, in the site catalog, the content modules and the visible text of every built page.

---

## Conventions

- **Commits:** single-line, concise, imperative subject. **No body, no trailer.** Commit or push only when asked.
- **Comments:** sparing — the default is no comment. Add one only for a non-obvious *why* or an invariant,
  one line. Never narrate *what* the code does, restate types, write multi-clause block/file-header comments,
  or add decorative divider banners.
- **Migrations** live only in `backend/migrations/versions/` (timestamp-prefixed). The history was squashed
  into one baseline before launch (`20261010_000000_baseline.py`, built from the models plus the
  hand-written extension, exclusion constraints and ledger triggers); new changes are increments on it.
- **Regenerate** `api-client` (`make gen-api`) whenever the API contract changes; `gen-sync-schema` after
  model/sync-rule changes; `gen-themes` after editing `app-explorer.html`. `make codegen-check` (in the pre-commit hook, `make check` and CI) fails if any of the three is stale.
- **No build-phase/iteration numbers** in code comments or docstrings (commit messages / plan docs are fine).
- **Column names:** booleans carry no `is_` prefix (`payee`, `available`, `preferred`, `tax_registered`);
  a column naming the user who did something is `<past participle>_by` (`created_by`, `sent_by`,
  `performed_by`); money is integer cents and a percentage is integer basis points (`rate_bps`); a
  frequency is `day`/`week`/`month` (`year` for items); a bank payment is `bank_eft` everywhere. Every
  enum-like text column, including each polymorphic `parent_type`, has a CHECK listing its values.

---

## Local development

### Ports — the 87xx block
Clientbridge owns the **8700–8799** block, so a new local service picks a free port inside it. The
services below use 8700–8716, and test-only servers (web e2e, the sync verification page) use other ports
in the block. Container-internal ports stay conventional; only host mappings use 87xx.

| Port | Service | Container | Set in |
|---|---|---|---|
| **8700** | Web (Vite) — provider app | — | `apps/web` vite (strictPort) · `make dev-web` |
| **8701** | Backend API (FastAPI/uvicorn) | — | `make dev-api` |
| **8702** | Postgres (source + `powersync_storage`) | 5432 | docker-compose · `DATABASE_URL` (API role) · `MIGRATION_DATABASE_URL` (schema owner) · `ADMIN_DATABASE_URL` (role setup) |
| **8703** | Redis | 6379 | docker-compose · `REDIS_URL` |
| **8704** | PowerSync service | 8080 | docker-compose · `POWERSYNC_URL` |
| **8705 / 8706** | S3 (RustFS): API / console | 9000 / 9001 | docker-compose · `S3_ENDPOINT` |
| **8707** | Expo / Metro (mobile) | — | `make dev-mobile` |
| **8708** | stripe-mock (contract tests only) | 12111 | docker-compose `profiles:[test]` |
| **8709** | Connect (Vite) — customer app | — | `apps/connect` vite (strictPort) |
| **8710** | Marketing site (Vite, static build) | — | `apps/site` vite (strictPort) · `make dev-site` |
| **8712** | Component playground (Vite) | — | `apps/playground` vite (strictPort) · `make dev-playground` |
| **8713 / 8714** | Ory Kratos: public / admin API (admin bound to 127.0.0.1) | 4433 / 4434 | docker-compose · `KRATOS_PUBLIC_URL` / `KRATOS_ADMIN_URL` |
| **8715 / 8716** | Mailpit: web UI and API / SMTP (the API's mail under `make dev-api`; 127.0.0.1 only) | 8025 / 1025 | docker-compose |

### Bring-up
```
make hooks                 # once per clone — install the pre-commit gate
make install               # uv sync + pnpm install (applies the two op-sqlite patches)
make up                    # Postgres (logical WAL), the database roles and the storage + kratos DBs, then powersync/kratos/mailpit/redis/s3
make migrate               # roles, then Alembic as the migrator, then grants and the publication of synced tables
# separate terminals:
make dev-api  dev-web  dev-connect  dev-mobile  worker
make dev-site              # marketing site from source on :8710
make build-site            # static build in frontend/apps/site/dist (pnpm --filter site preview serves it on :8710)
make test-site             # build + Playwright pass over every page (links, images, 390px, axe)
make test-web              # web smoke test: sign in, every page and dialog, no console errors (needs the local stack + seed;
                           # scripts/web_fixtures.py first adds a client series, low stock, a dispute and a
                           # duplicate client through the API if missing)
make test-connect          # Connect e2e: book to the deposit step, manage link, shop and every client page (needs the API + seed)
make test-mobile           # Maestro native walkthroughs (development build + local stack + seed)
make lighthouse-site       # Lighthouse budget (desktop >= 95 in every category) against the :8710 preview
make dev-playground        # every shared component on web, iPhone and Android on :8712 (no backend needed)
make test-playground       # build + Playwright pass over every story page and phone frame, no console errors
make test-sync             # disposable Postgres + PowerSync: per-role replica rows and columns, revocation,
                           # hours uploads, the signing-key rotation drill, then the replication health check
make replication-health    # local PowerSync readiness, slot, retained WAL (1 GiB) and replay lag (60 s)
```
Devices sign in with Kratos (web: session cookie; mobile: session token), exchange that session at
`/sync/token` for a PowerSync token, and stream their
Sync Streams from powersync (:8704) into on-device SQLite. After changing `sync-rules.yaml`, restart the
powersync container so it loads the new streams. If a hard Docker shutdown corrupts the PowerSync
replication slot (Postgres PANICs on next start), remove `pg_replslot/powersync_*` to recover.

### Infra services (`docker-compose.yml`)
`postgres:16` (`wal_level=logical`, `max_replication_slots=4`), `journeyapps/powersync-service` (mounts
`infra/powersync/`, replicates as `powersync_source` and stores buckets in a separate `powersync_storage`
DB owned by `powersync_storage_owner`),
`redis:7` (arq queue), `s3` (RustFS, an S3-compatible dev store; MinIO no longer publishes free images),
`kratos-migrate` + `kratos` (Ory Kratos, `infra/kratos/`, its own `kratos` database), `mailpit` (catches
the API's email, auth codes included, when `SMTP_URL` points at it as `make dev-api` does; open :8715), `stripe-mock` (test profile only).
CI jobs whose Postgres is a service container start Kratos with `make kratos-standalone` (`infra/kratos/standalone.sh`), which reads the image pin from `docker-compose.yml`.
The compose Kratos posts auth email to the API at `host.docker.internal:8701`; on Linux without Docker
Desktop that is the bridge address, so run the API with `--host 0.0.0.0` there (CI does).

---

## The demo / QA account

Demo accounts are normal tenants in the main local `clientbridge` database, using the standard servers and provider integrations. `make seed` adds them when absent; `make demo-reset` refreshes only the seeded accounts and preserves unrelated tenants. `make demo-check` validates their scenario and ledger. There is no demo runtime mode or separate presentation database.

| Login | Role |
|---|---|
| hannah@birchbarkpets.ca | Hannah, owner of Birchbark Pet Studio |
| admin@birchbarkpets.ca | Alex, administrator |
| diego@birchbarkpets.ca | Diego, commissioned staff |
| priya@birchbarkpets.ca | Priya, employee |
| owner@cedarcoast.example.test | Rowan, a separate business used for isolation checks |

The password is `demo1234` and the approval PIN is `2468`. The scenario is anchored to the current Vancouver date: `seed_demo.build_demo(as_of)` builds the fixture graph, the seed modules enrich it, and it is validated before it is written. Assets in `backend/scripts/demo_assets/` upload to the configured bucket first. The seed creates (or finds) a Kratos identity for each demo user with that password and a verified email, so `make seed` needs Kratos running. A reset replaces only the seeded businesses and their rows (Kratos identities are kept and relinked), and refuses when a seeded user also belongs to another business; it pauses the ledger's append-only trigger inside the transaction. Historical provider references are fixture data, not usable Stripe objects, so new card payments, onboarding and message delivery need test-provider credentials as for any account; without them use cash or manual payments.

Two manual Stripe tools need `STRIPE_SECRET_KEY` (test mode): `uv run python -m scripts.stripe_demo_account` connects the demo business to a verified Stripe test account and reuses it on later runs, and `uv run python -m scripts.payment_accounts` audits one connected account's profile and statement descriptor, writing missing fields only with `--apply`. Integration tests use normal dependency-injected recording adapters and per-test rollback; CI databases use the `clientbridge_test*` prefix.

### PowerSync signing-key rotation

Production requires `POWERSYNC_USE_RS256=true`, a durable RSA private PEM of at least 2048 bits, and a unique `POWERSYNC_KID`. Keep the private PEM in the deployment secret manager. Every API worker must use the same active configuration. The application rejects missing production keys at startup.

To rotate, first publish the next public PEM under its new key ID in `POWERSYNC_PREVIOUS_PUBLIC_KEYS` (a JSON object); keep signing with the current key. Verify that PowerSync can obtain the expanded `/sync/keys` response before changing the signer. Then deploy the new private PEM/key ID, retaining the former public key in the overlap map. Keep both public keys available until all workers have switched and the last old token has expired, plus the measured verifier cache/clock-skew margin. Remove the former public key only after verification. Rollback uses the former signer while retaining both public verification keys; it never requires clearing client queues. `make test-sync` runs the rotation drill against the pinned service: a new key is accepted about half a second after rotation and a retired key is refused after about 299 seconds, matching the five-minute token lifetime; the drill fails if retirement takes longer than six minutes. Production timing still depends on the deployed verifier cache.
