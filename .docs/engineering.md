# Clientbridge — Engineering

**How we build it**: the quality gate, testing, the shipping method, and the day-to-day conventions. For
_how it works_ see [architecture.md](architecture.md); for _what's left_ see [launch-readiness.md](launch-readiness.md).

---

## The gate — run it before "done"

Both stacks enforce **4-space indent · double quotes · semicolons (JS) · strict types · no `Any` · full
type safety.**

### Backend (Python)

- **ruff** (`backend/ruff.toml`) — format 4-space/double-quote/100-col; lint `E F I UP B SIM TID ANN RUF`.
  **`ANN401` bans explicit `Any`** in signatures; `ANN` requires full annotations, tests included. The one
  per-file ignore is `E501` in `migrations/`, for long SQL text in applied migrations, which are not
  rewritten.
- **pyright** (`pyrightconfig.json` at the repo root, the one config the editor, make, the pre-commit hook
  and CI all read): `typeCheckingMode: strict` over **`src tests scripts migrations`**, with the
  `reportUnknown*` rules off because library stubs (Stripe, SQLAlchemy results) leave members unknown.
  Pinned to `pyright==1.1.408` as a backend dev dependency, so `uv run pyright` is the same version
  everywhere. Pydantic models are checked through `dataclass_transform`: a wrong-typed or unknown
  constructor argument is an error. JSON columns are typed `dict[str, object]`. The structure check
  fails if `typeCheckingMode` is not `strict`, if any `report*` rule other than the four `reportUnknown*`
  rules and `reportMissingTypeStubs` is set below error, if `ignore` is set, or if `include` drops one of
  the four directories, or if `exclude` or `executionEnvironments` hides files.
- **No `Any`:** ruff `ANN401` bans explicit `Any` and `ANN` requires annotations; pyright
  strict checks every call against them. With the `reportUnknown*` rules off, an `Any` that comes from a
  library is not reported.
- **No suppressions:** `scripts/check_structure.py` fails on `# noqa`, `# type: ignore`, `# pyright:`,
  `# mypy:`, `# ruff:`, `# fmt:`, `# isort:`, `# pylint:` and `# pragma` comments (coverage pragmas
  included) anywhere in `src`, `tests`, `scripts` and `migrations`, and `make lint` runs ruff with
  `--ignore-noqa`, so a directive cannot hide an error. Fix the cause instead; `tests/test_structure.py`
  checks that each form and each weakened pyright setting is caught. Code the default suite does not reach,
  such as the real Stripe gateway, shows as uncovered rather than excluded; the contract job runs it.

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
  caught error's `message` reaching the UI). Debug panels, tests and e2e suites are exempt
  where the rule is about product copy. The **lean-bundle boundary** (`no-restricted-imports` bans
  `@powersync/*` + `@clientbridge/sync` from `apps/connect` and `app-core/public`) is enforced here too.
  `pnpm lint` runs eslint with `--max-warnings 0`. The config sets `noInlineConfig` and reports unused
  disable directives, so an inline `eslint-disable` or `/* eslint */` comment has no effect and fails the
  run, and `ban-ts-comment` rejects every `@ts-ignore`, `@ts-nocheck` and `@ts-expect-error`. JavaScript
  and config files are linted too (JavaScript without type information, since it sits in no tsconfig);
  only generated files are ignored (`api-client/src/generated.ts`, Connect's `public/embed.js`, the
  `expo prebuild` projects). A rule changes only in `eslint.mjs`, scoped to the files that need it, with a
  one-line reason. Prettier checks JavaScript files as well as TypeScript.
- **No suppressions:** `check-structure.mjs` reads the comments of every tracked frontend TS and JS file
  (generated files included; the generators emit none) and fails on `@ts-ignore`, `@ts-nocheck`,
  `@ts-expect-error`, `eslint-disable` in any form, `/* eslint */` and `/* global */` directives,
  `prettier-ignore`, `istanbul ignore`, `c8 ignore`, `biome-ignore` and `tslint:` comments.
  `packages/config/suppressions.test.mjs` checks each form. Assert a type error in a test with vitest's
  `expectTypeOf` instead.
- **tsconfig** (`tsconfig.base.json`) — `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  - `noUnusedLocals/Parameters` + `noImplicitReturns/Override` + `noFallthroughCasesInSwitch` +
    `verbatimModuleSyntax`. `check-structure.mjs` fails if the base drops `strict` or one of those checks,
    if any tracked tsconfig sets a strict-family flag (`noImplicitAny`, `strictNullChecks` and the rest) or
    one of those checks to `false`, if a tsconfig does not extend `tsconfig.base.json`, or if one sets
    `exclude`.

### Commands (root Makefile)

```
make lint          # backend: ruff check + pyright strict + structure check |  frontend: eslint + structure check + knip + tsc
make typecheck     # backend: pyright strict              |  frontend: tsc --noEmit
make format        # backend: ruff format                 |  frontend: prettier --write
make format-check
make gen-strings   # check the app and site catalogs; regenerate strings.ts, en-XA.json and embed.js
make gen-messages  # check the backend catalog; regenerate messages.pot and en_XA.po
make gen-zones     # regenerate app-core zones.ts and zones.cases.json from the backend's tzdata
make gen-taxes     # regenerate app-core taxRates.ts and taxes.cases.json from services/tax.py
make codegen-check # regenerate api-client, sync schema, themes, strings, messages, zones and taxes; fail if stale
make precommit     # format-check + lint + codegen-check + test  (the pre-commit hook; e2e runs in CI)
make check         # lint + codegen-check + test          (the full local gate)
```

The pre-commit hook (`.githooks/pre-commit`, installed once via `make hooks`) applies only the staged
changes to a temporary worktree at `HEAD`, installs dependencies there from the local caches and runs
`make precommit`, so unstaged edits never decide a commit. It includes the backend and frontend tests, so
the local Postgres from `make up` must be running. The browser,
device and real-service suites (`test-web`, `test-connect`, `test-mobile`, `test-sync`, `test-site`)
run in CI. The hook uses uv's default cache in `~/.cache/uv`; a cache under `/tmp` loses files to
macOS's periodic cleanup and then fails installs.

---

## CI — the parallel jobs (`.github/workflows/ci.yml`)

Runs on every push to `main` + all PRs; concurrency-cancels stale runs. The workflow token is read-only, every job has a `timeout-minutes`, and every image is pinned by digest (the Postgres service uses the `docker-compose.yml` pin). setup-uv takes the Python version from `backend/.python-version`.

| Job               | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **backend**       | Postgres 16 service · `uv sync` → `make format-check-backend lint-backend` (ruff, pyright, structure check) → `make migrate` → `make test-backend` (pytest, 90% branch coverage, on a freshly migrated and seeded database of its own) → `make test-auth`, which fails rather than skips when the auth service is unreachable in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **frontend**      | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make format-check-frontend lint-frontend test-frontend` (prettier, eslint + `check-structure.mjs` + knip, tsc, the site copy rules, the lint rule tests, vitest for app-core and site, then app-core again under `TZ=America/Vancouver`, `America/Halifax` and `Asia/Tokyo`; the formatter tests assert `en-CA` and `en-XA` output)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **build**         | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make build-apps` (`tsc -b` and the Vite builds for web and Connect; the site job builds the site, so it is left out here), so a broken bundle fails CI beyond `tsc --noEmit`; runs beside the frontend job rather than after it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **images**        | Builds the `prod` targets of `backend/Dockerfile` and `frontend/Dockerfile` with Buildx and the GitHub Actions cache, without pushing, so a broken Dockerfile fails CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **infra**         | `uv sync` in `infra/pulumi` → `make format-check-infra lint-infra test-infra` (ruff, pyright, and pytest of the cloud, staging and prod stacks against Pulumi's mocks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **site**          | Node from `.nvmrc` · `make test-site`: a fresh build, then Playwright e2e on it (the copy rules and content tests run in the frontend job): every page returns 200 with its content in the HTML, no console errors, no broken images or internal links, no sideways scroll at 390 and 1440px, axe with no serious or critical issues, 404 page served with a 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **connect**       | Postgres 16 service · `make migrate seed` · the API on :8701 · `make test-connect` against `vite preview` of a production build (the `en-XA` pass uses the dev server, where the pseudo-locale lives): Connect's Playwright walk (book a visit, cancel it from its manage link, shop, invoice, estimate, receipt, review, form, contract, preferences, not found), failing on any console error; every client page through axe (no serious or critical issues), a keyboard walk that fails on a focus stop without a visible indicator, and a hover check on every button (AA text contrast, also over a business cover photo); then the `en-XA` pass over the business, booking, shop, invoice, estimate and receipt pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **sync**          | `make test-sync`: disposable Postgres and PowerSync, per-role replica rows and columns, revocation, hours uploads, the signing-key rotation drill and the replication health check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **web**           | `make up migrate seed` · the API on :8701 · `make test-web` against `vite preview` of a production build (the `en-XA` pass uses the dev server): sign-in, every page and dialog, record flows, history older than the device window, no console errors, axe, keyboard focus and hover contrast on the key pages, the booking composer and the client and invoice records, and the `en-XA` pass over Today, Schedule, Clients, a client record, Setup's business page, Invoices and an invoice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **shards**        | checks that every Maestro walkthrough is in exactly one shard of `e2e/shards.json` and hands the shard list to mobile-shard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **mobile-build**  | an x86_64 release APK (bundle embedded, no Metro), cached under the app's Expo native fingerprint, which changes with any native module version: on a hit `scripts/rebundle-apk.sh` only rebuilds the Hermes bundle and re-signs the cached APK, on a miss `expo prebuild` and Gradle build it, and setup-gradle restores the Gradle cache; only pushes to `main` write it back (the action's default), after removing unused entries, so a pull request's miss has no save step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **mobile-shard**  | three shards, each with `make up migrate seed` and the API started in the background, the APK from `mobile-build` and its share of the Maestro walkthroughs on an Android 14 emulator from `scripts/ci-emulator.sh`: a pinned emulator build (checked against its sha256), the system image at a pinned revision and the AVD with its quick-boot snapshot are cached together under a key named after those pins and the revision of the settings saved in the snapshot (it hides system error dialogs, so a launcher that stops responding after the resume is killed instead of covering the app). Only pushes to `main` save that cache, so pull requests restore main's copy and download nothing from Google unless the pins changed; on a miss the script installs them, retrying the image download. The workflow step waits for the API only after booting and installing the APK. Maestro is installed at the version in `MAESTRO_VERSION` and prints it, and its on-device driver listens on port 7001, since the random port Maestro picks by default lies in the ephemeral range, where an outgoing connection on the emulator can already hold it. Every shard uploads its Maestro results, debug output, logcat and the emulator and API logs (kept 3 days), prints the emulator log, Maestro's own log and logcat when it fails, and warns when a walkthrough takes over three times its usual time in `e2e/flow-seconds.json`. The APK reaches the API, PowerSync and the auth service at `10.0.2.2`, the emulator's address for the host, rather than through `adb reverse`, whose mappings vanish when the emulator's adb connection drops. The shards are listed in `e2e/shards.json`, and the `shards` job fails when a walkthrough is in none or two |
| **mobile**        | the required check: passes when the build and every shard passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **contract**      | stripe-mock service · real `StripeGateway` validated against Stripe's OpenAPI mock; a missing mock fails the job in CI instead of skipping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **codegen-drift** | `make codegen-check`: `make gen-api`, `gen-sync-schema`, `gen-themes`, `gen-messages`, `gen-strings` (which also fail on invalid or unused catalog messages), `gen-zones` and `gen-taxes`, then a diff check on the generated files (the api-client, sync schema, themes, `messages.pot`, `en_XA.po`, both `strings.ts` accessors and `en-XA.json` files, Connect's `embed.js`, app-core `zones.ts` and `zones.cases.json`, and app-core `taxRates.ts` and `taxes.cases.json`), so the committed generated code cannot drift from its source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Net effect: no unformatted/untyped/uncovered code, no broken bundle, no drift between backend models and the
generated frontend contracts/themes.

Every job runs its full suite on every pull request and on every push to `main`; no job is skipped by
the paths a change touches. With `ENV=dev` the API allows 1000 requests a minute from one address on
the public endpoints (30 otherwise), since one browser plays every visitor in the e2e suites.

---

## Testing

Tests are the **primary feedback loop** until manual QA — the goal is for green tests to remove the need for
manual QA at intermediate backend steps. Optimize for **meaningful** coverage: tests that fail when behavior,
contracts, or security regress — not line-count theater.

### Shape: integration-first

- **Integration tests dominate** — `httpx.AsyncClient` → the real FastAPI app → real migrated + seeded
  Postgres. One test file per concept (`test_<concept>[_<aspect>].py`). They cover the true HTTP contract + auth + DB constraints.
- **Unit tests** only for pure logic with many cases (the PowerSync token, PIN hashing, tax math, RRULE expansion,
  the frontend `parseTimestamp`). No DB, no HTTP.
- **We don't mock our own code.** The DB is real; our services run for real.

### Isolation: transactional rollback (`tests/conftest.py`)

Every test runs inside a transaction that is rolled back at the end. A fixture opens a connection + outer
transaction; an `AsyncSession(bind=conn, join_transaction_mode="create_savepoint")` is shared by the test
**and** the app (via `app.dependency_overrides[get_session]`). The app's `commit()`s become savepoints; the
final `rollback()` erases everything. Tests start from the **committed Birchbark seed baseline**, write
freely, and leave **zero residue** — repeatable, parallel-safe.

`make test-backend` runs the suite through `scripts/fresh_database.py`, which creates a
`clientbridge_test_<random>` database, migrates and seeds it, runs pytest against it and drops it. Other
suites, the dev API and e2e runs on the same machine share the `clientbridge` database and lock or change
the seeded rows, which made tests fail with deadlocks and unexpected rows when they ran at the same time.
A plain `uv run pytest` still uses `DATABASE_URL`. Tests that commit from their own connections (the race
tests) delete what they wrote.

### Time: one clock, frozen in tests

Code reads the current time only through `core/clock.py`: `clock.now()` for business time,
`clock.today(zone)` for a local date, and `clock.wall()` for checks against a clock outside the app
(auth session age, the PowerSync JWT `iat`/`exp`, Svix and Stripe signature tolerance, provider event
grace). The structure check fails on `datetime.now`, `datetime.utcnow`, `date.today`, `time.time` and
`func.now` anywhere else in `src`, `tests` and `scripts` (`func.now` stays in model server defaults), and
on moving the clock from `src`. Under pytest the clock starts at `FROZEN` (`tests/clock.py`,
2026-10-13T17:00Z, 10 a.m. in Vancouver) for every test and ticks from there, test modules are collected
at that instant, and `fresh_database.py` seeds the test database `--as-of FROZEN`; the `db` fixture fails
if the database was seeded at any other time. Date literals in tests therefore stay on the side of today
they were written for. Tests marked `wall_clock` (the auth contract test and the Stripe and Resend
test-mode tier) run at real time. Postgres `now()` still stamps `created_at`/`updated_at` at real time;
a service that compares a row's age against `clock.now()` stamps that column itself. The suite passes
under `faketime +730d` apart from the real S3 round trip, which S3 rejects for clock skew.

Vitest starts every frontend unit test at the same instant (`packages/config/vitest/frozen-clock.ts`
through each package's `vitest.config.ts`), and SQL that needs the time takes it as a bound parameter
rather than SQLite's `datetime('now')`. Playwright and Maestro run at real time against a seed built at
real time, since the API, PowerSync, the auth service and the device clock cannot be frozen together; their suites
derive dates from today, and `check-structure.mjs` fails on a date literal in an `e2e` folder.

### External boundaries: adapters + recording fakes

Third parties are never called. Each is an interface injected as a dependency, faked in tests:
`FakeEmailSender`/`FakeSmsSender`/`FakePushSender` (record `.sent`), `FakeFileStorage`, `FakeIdentityProvider`
(the auth service: `identities.issue(identity)` mints a session token; `session_token(identities, db, user_id)` signs in a
seeded user; `.end_sessions()`, `.deleted`, `.step_up`, `.down` drive the edge cases and `.fresh_reads` counts uncached checks), and `FakePaymentGateway` (a substantial in-memory Stripe double that honors idempotency keys and maps magic
payment methods to error paths). A test asserts on the fake — _"one reset email to alice@x with a token that
then resets the password"_ — exercising our logic up to the wire.

### Auth clients & factories

`as_owner` / `as_staff` / `unauth` — an `httpx` client pre-authenticated as that principal (`us_dev` owner /
`us_diego` staff / none). `Factory.business()/user()/staff()/client()` build valid scoped rows for
multi-tenant isolation tests (build a _second_ business to prove cross-tenant leakage is blocked).

### Stripe: three tiers, layered by cost

The fake covers our _logic_; it can't prove the real adapter maps correctly. Three tiers close that:

| Tier         | Run                  | Validates                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fake**     | default suite        | our logic + idempotency + error mapping (fast, hermetic, in-memory)                                                                                                                                                                                                                                                                                                                                                                   |
| **Contract** | `make test-contract` | the real `StripeGateway` vs **stripe-mock** (`stripe/stripe-mock` v0.206.0, pinned by digest in `docker-compose.yml` and CI) — every v1 request shape + response parse, including plan Checkout, the Billing Portal and the plan subscription calls. Stateless; asserts shapes, not state. stripe-mock has no `/v2` routes, so the Accounts v2 calls (create, retrieve, capability request) are covered by the fake and the e2e tier. |
| **Contract** | `make test-auth`     | the real `KratosIdentityProvider` vs the local auth service: admin-created identity, native login, whoami, revocation.                                                                                                                                                                                                                                                                                                                |
| **E2E**      | `make test-e2e`      | real test-mode Stripe (Accounts v2 creation and requirements, KYC transitions, declines/3DS, subscription periods at the current API version, via a Test Clock) — behavior the mock's pinned spec can't reproduce. Skipped without `STRIPE_TEST_SECRET_KEY`. One real Resend send to `delivered@resend.dev`, skipped without `RESEND_TEST_API_KEY` and `RESEND_TEST_FROM`.                                                            |

`contract`, `e2e` and `kratos` are excluded from the default run (`-m 'not contract and not e2e and not kratos'`) and auto-skip when their
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
   principles (layering · the 5 surfaces · role gates in the services · the 4-part matrix · web↔mobile
   duplication · stray comments) and fix High/Medium findings _then_. (A Catalog & Tax audit once caught an
   unguarded REST write + a router running raw queries — exactly the class this pass exists to catch.)

Read local, write via command/sync — the server is the source of truth; clients are optimistic caches.

### Each release

- Review the sales-tax rates in `services/tax.py` against the CRA and provincial pages cited in `tests/test_tax_rates.py`, and again whenever a federal or provincial budget changes a rate: add a dated row (never edit a past one), update the golden test, and run `make gen-taxes`.

### Mobile changes: an update or a store build

Each deploy ships the mobile app too ([operations](operations.md#deploys-and-rollback)). A change to JavaScript, copy, assets bundled through Metro or the app-core schema reaches installed apps as an EAS update, without review. A change to the native fingerprint needs a new store build and, for production, App Review: a native module added or upgraded (an Expo SDK upgrade included), a config plugin or its options, a permission, entitlement or `Info.plist` value, the icon or splash screen, the bundle id, and any value `app.config.ts` reads, the `extra` URLs and the Stripe publishable key included, since the fingerprint hashes the whole config. The deploy workflow tells the two apart by itself; to see it before merging, compare `node ../../node_modules/@expo/fingerprint/bin/cli.js fingerprint:generate --platform android` from `frontend/apps/mobile` on both commits. An update may change behavior within what the app already does (Apple guideline 2.5.2 and the developer agreement forbid an update that changes the app's purpose), and an installed app runs an older bundle until its next two starts, so an API change stays readable by the previous bundle for at least one release.

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
  `VITE_PSEUDO_LOCALE=1` on a web or Connect dev server and `EXPO_PUBLIC_PSEUDO_LOCALE=1` in a
  mobile development build. Web and Connect set `<html lang>` from the active locale at startup.
- `make test-web` and `make test-connect` each end with an `en-XA` pass
  (`pseudo.e2e.ts`, sharing `packages/config/e2e/pseudo.ts`). It fails on visible text or copy attributes
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
- **Comments:** sparing — the default is no comment. Add one only for a non-obvious _why_ or an invariant,
  one line. Never narrate _what_ the code does, restate types, write multi-clause block/file-header comments,
  or add decorative divider banners.
- **Migrations** live only in `backend/migrations/versions/` (timestamp-prefixed). The history was squashed
  into one baseline before launch (`20261010_000000_baseline.py`, built from the models plus the
  hand-written extension, exclusion constraints and ledger triggers); new changes are increments on it.
- **Regenerate** `api-client` (`make gen-api`) whenever the API contract changes; `gen-sync-schema` after
  model/sync-rule changes; `gen-themes` after editing `app-explorer.html`; `gen-strings` and `gen-messages` after a catalog edit; `gen-zones` after a `tzdata` upgrade; `gen-taxes` after a rate change. `make codegen-check` (in the pre-commit hook, `make check` and CI) fails if any generated file is stale.
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
services below use 8700–8716 and 8750–8751, and test-only servers (web e2e, the sync verification page) use other ports
in the block. Container-internal ports stay conventional; only host mappings use 87xx.

| Port            | Service                                                                              | Container   | Set in                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **8700**        | Web (Vite) — provider app                                                            | —           | `apps/web` vite (strictPort) · `make dev-web`                                                                            |
| **8701**        | Backend API (FastAPI/uvicorn)                                                        | —           | `make dev-api`                                                                                                           |
| **8702**        | Postgres (source + `powersync_storage`)                                              | 5432        | docker-compose · `DATABASE_URL` (API role) · `MIGRATION_DATABASE_URL` (schema owner) · `ADMIN_DATABASE_URL` (role setup) |
| **8703**        | Redis                                                                                | 6379        | docker-compose · `REDIS_URL`                                                                                             |
| **8704**        | PowerSync service                                                                    | 8080        | docker-compose · `POWERSYNC_URL`                                                                                         |
| **8705 / 8706** | S3 (RustFS): API / console                                                           | 9000 / 9001 | docker-compose · `S3_ENDPOINT`                                                                                           |
| **8707**        | Expo / Metro (mobile)                                                                | —           | `make dev-mobile`                                                                                                        |
| **8708**        | stripe-mock (contract tests only)                                                    | 12111       | docker-compose `profiles:[test]`                                                                                         |
| **8709**        | Connect (Vite) — customer app                                                        | —           | `apps/connect` vite (strictPort)                                                                                         |
| **8710**        | Marketing site (Vite, static build)                                                  | —           | `apps/site` vite (strictPort) · `make dev-site`                                                                          |
| **8711**        | Platform admin shell (Vite)                                                          | —           | `apps/admin` vite (strictPort) · `make dev-admin`                                                                        |
| **8713 / 8714** | The auth service (Ory Kratos): public / admin API (admin bound to 127.0.0.1)         | 4433 / 4434 | docker-compose · `AUTH_PUBLIC_URL` / `AUTH_ADMIN_URL`                                                                    |
| **8715 / 8716** | Mailpit: web UI and API / SMTP (the API's mail under `make dev-api`; 127.0.0.1 only) | 8025 / 1025 | docker-compose                                                                                                           |
| **8750**        | Backend image: API (the `app` profile)                                               | 8701        | docker-compose `profiles:[app]` · `make up-app`                                                                          |
| **8751**        | Web image: Caddy serving web, Connect and the site by host                           | 8080        | docker-compose `profiles:[app]` · `make up-app`                                                                          |

### Bring-up

```
make hooks                 # once per clone — install the pre-commit gate
make install               # uv sync + pnpm install (applies the two op-sqlite patches)
make up                    # Postgres (logical WAL), the database roles and the storage + auth DBs, then powersync/auth/mailpit/redis/s3
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
make test-sync             # disposable Postgres + PowerSync: per-role replica rows and columns, revocation,
                           # hours uploads, the signing-key rotation drill, then the replication health check
make images                # build the backend and web prod images
make up-app                # the prod images on the local infra: API :8750, web :8751
make replication-health    # local PowerSync readiness, slot, retained WAL (1 GiB) and replay lag (60 s)
```

Locally `BASE_DOMAIN` stays unset, so the API keeps its localhost URLs from `.env`, `TRUSTED_PROXY_HOPS`
is 0 (the socket peer is the client) and logs are plain text; the web and Connect dev servers serve an empty
`config.js` and read their `VITE_*` URLs. A deployed API sets `ENV` (`staging` or `prod`) and `BASE_DOMAIN`,
and refuses to start when a required setting is missing or a set URL disagrees with the base domain. Its
logs are one JSON object per line, and the probes are `/health` (liveness) and `/ready` (the database).
`DB_POOL_SIZE` and `DB_MAX_OVERFLOW` size the engine's pool per process (`core/db.py`); they default to
SQLAlchemy's own 5 and 10, and deployed environments lower them (see [operations](operations.md#plain-settings)).

The auth service and PowerSync keep their local files in `infra/`, and a deployed environment sets the rest through
the environment, from `clientbridge.core.deployment` (standard library only, so the Pulumi program
imports it):

- The auth service runs `AUTH_COMMAND` (`serve -c /etc/config/auth/kratos.yml --watch-courier`, no
  `--dev`) with `infra/auth/` mounted at `/etc/config/auth`, the variables from
  `auth_env(base_domain, api_url=..., admin_url=...)` and the secrets in `AUTH_SECRETS` (`DSN`,
  `SECRETS_COOKIE`, `SECRETS_CIPHER`, the courier's `AUTH_EMAIL_HOOK_SECRET` and the Google client).
  Kratos takes a list as comma-separated values and replaces the file's list with it. Without `--dev`
  every cookie is `Secure`, which the `__Host-cb_session` session cookie requires.
- PowerSync reads `infra/powersync/powersync.deployed.yaml` (`powersync_env(api_url=...)` sets
  `POWERSYNC_CONFIG_PATH` and `PS_JWKS_URI`) with `PS_SOURCE_URI` and `PS_STORAGE_URI` from secrets:
  the `POWERSYNC_SOURCE_DATABASE_URL` and `POWERSYNC_STORAGE_DATABASE_URL` values in `postgresql://`
  form, pointed at the Cloud SQL Auth Proxy on `127.0.0.1:5432`. `sslmode` is `disable` because the
  proxy encrypts the connection to Cloud SQL; a direct connection would need `verify-full` instead.
- The API sets `AUTH_INTERNAL_URL` and `AUTH_ADMIN_URL` to the auth service's two in-cluster Services; with
  `BASE_DOMAIN` set, `AUTH_SESSION_COOKIE` becomes `__Host-cb_session` and `AUTH_PUBLIC_URL`
  `https://api.<base>/auth`.

`uv run python -m scripts.verify_kratos` (from `backend/`, needs Docker) starts the pinned Kratos with
an in-memory database and the deployed environment for `clientbridge.test`, checks that the login flow's URLs
are under `api.<base>/auth/` and that local return URLs and CORS origins are refused, then runs the Kratos
contract (`-m kratos`) against it, including a browser sign-in whose `__Host-` cookie reaches `whoami`.
Browsers accept a `__Host-` cookie only over https (or on `localhost`), so the web and mobile auth e2e
against this cookie run on staging.

Devices sign in with the auth service (web: session cookie; mobile: session token), exchange that session at
`/sync/token` for a PowerSync token, and stream their
Sync Streams from powersync (:8704) into on-device SQLite. After changing `sync-rules.yaml`, restart the
powersync container so it loads the new streams. If a hard Docker shutdown corrupts the PowerSync
replication slot (Postgres PANICs on next start), remove `pg_replslot/powersync_*` to recover.

### Infra services (`docker-compose.yml`)

`postgres:16` (`wal_level=logical`, `max_replication_slots=4`), `journeyapps/powersync-service` (mounts
`infra/powersync/`, replicates as `powersync_source` and stores buckets in a separate `powersync_storage`
DB owned by `powersync_storage_owner`),
`redis:7` (arq queue), `s3` (RustFS, an S3-compatible dev store; MinIO no longer publishes free images),
`auth-migrate` + `auth` (the auth service, Ory Kratos, `infra/auth/`, its own `auth` database), `mailpit` (catches
the API's email, auth codes included, since `SMTP_URL` points at it by default when `ENV=dev`; open :8715), `stripe-mock` (test profile only).
CI jobs whose Postgres is a service container start the auth service with `make auth-standalone` (`infra/auth/standalone.sh`), which reads the image pin from `docker-compose.yml`.
The compose auth service posts auth email to the API at `host.docker.internal:8701`; on Linux without Docker
Desktop that is the bridge address, so run the API with `--host 0.0.0.0` there (CI does).

### Database roles and the admin

`scripts/db_access.py` (the roles in [Database roles and replication](architecture.md#database-roles-and-replication)) runs as the admin in `ADMIN_DATABASE_URL`. Locally and in CI that is the `clientbridge` superuser. On Cloud SQL each environment has its own admin, `prod_admin` or `staging_admin`, a `CREATEROLE CREATEDB` user that is neither a superuser nor a member of `cloudsqlsuperuser`, so the script uses only what such an admin can do; the shared `postgres` user is not used by any workload. The admin needs `CREATEROLE` and `CREATEDB`, the owner's privileges on the application database, and the right to set `REPLICATION` on the PowerSync source role: on stock Postgres the admin must have `REPLICATION` itself, and on Cloud SQL the admin may need it granted, which we have not checked. When the application database does not exist, `roles` creates it as the admin (from the `postgres` database), so an environment's application database should not be created through the Cloud SQL API, which would make `cloudsqlsuperuser` its owner; the script stops with a clear message when the admin cannot act as the database's owner. We have not run this against Cloud SQL itself yet.

Role and database names come from connection URLs, never from constants, because production and staging share one Cloud SQL instance and roles are instance-wide. Each role takes its user name and password from its URL, and the two service databases take their names from theirs:

| Login                | URL                              | Local default (user and database)                   |
| -------------------- | -------------------------------- | --------------------------------------------------- |
| Application database | `ADMIN_DATABASE_URL`             | `clientbridge`                                      |
| Migrator             | `MIGRATION_DATABASE_URL`         | `clientbridge_migrator` on the application database |
| API                  | `DATABASE_URL`                   | `clientbridge_api` on the application database      |
| PowerSync source     | `POWERSYNC_SOURCE_DATABASE_URL`  | `powersync_source` on the application database      |
| PowerSync storage    | `POWERSYNC_STORAGE_DATABASE_URL` | `powersync_storage_owner` on `powersync_storage`    |
| Auth service         | `AUTH_DATABASE_URL`              | `auth` on `auth`                                    |

Without one of the last three URLs the role keeps its local name, on the admin's host, with the password from `POWERSYNC_SOURCE_PASSWORD`, `POWERSYNC_STORAGE_PASSWORD` or `AUTH_DB_PASSWORD`, so local and CI setups are unchanged. A deployed environment sets all six URLs with its own prefix (for example `staging_clientbridge_api` on `staging_clientbridge`), and these are the same URLs PowerSync and the auth service connect with. The script refuses URLs where the migrator, API or source name a database other than the admin's, where two roles share a name, or where two of the three databases share a name.

- `roles` creates or updates the five roles, then grants the migrator, storage and auth roles to the admin `WITH INHERIT TRUE, SET TRUE` when it cannot already act as them. PostgreSQL 16 needs that membership for `CREATE DATABASE ... OWNER`, `ALTER ... OWNER TO` and `ALTER DEFAULT PRIVILEGES FOR ROLE`. A superuser already passes those checks, so nothing is granted locally. On PostgreSQL 16 a `CREATEROLE` user gets `ADMIN` only on the roles it created, so each environment's admin can grant itself, rename or change the password of only its own environment's roles.
- `roles` makes the migrator the owner of the application database (`ALTER DATABASE ... OWNER TO`), so the admin keeps the owner's rights only through its membership in its own migrator, and no other environment's admin or `cloudsqlsuperuser` member holds them (`DROP DATABASE` included).
- Passwords are sent as SCRAM-SHA-256 verifiers computed by the script, never as plain text, so a failed `CREATE ROLE` or `ALTER ROLE` cannot put a password in the script's error or in the server log (`log_min_error_statement`), and the script's own error names only the role and Postgres's message.
- `roles` also revokes `CONNECT` and `TEMPORARY` from `PUBLIC` on the environment's three databases, since Postgres grants them to every role by default. Only the roles listed above can connect, so one environment's roles cannot open the other's databases, and its replication role cannot decode the other's changes.
- `SUPERUSER` and `REPLICATION` are changed only when they differ from the wanted value, because a non-superuser may not name `SUPERUSER` in `ALTER ROLE` at all.
- The `powersync` publication is created and altered as the migrator (`SET ROLE`), since `CREATE PUBLICATION ... FOR TABLE` and `ALTER PUBLICATION ... SET TABLE` require owning the tables. An existing publication owned by another role is handed to the migrator first, and an all-tables publication is dropped and recreated in the same transaction. Publications are per database, so each environment has its own.
- `grants` runs as the admin with the migrator's privileges, so the table grants are recorded as made by the owner.

`uv run python -m scripts.verify_db_access` (from `backend/`, needs Docker) keeps this working. It starts the pinned `postgres:16` image on a random local port with two Cloud SQL style admins, `prod_admin` and `staging_admin` (each `CREATEROLE CREATEDB REPLICATION`, neither a superuser nor a member of the other), leaves production's application database for `db_access` to create and has `staging_admin` create staging's, and runs the image's `migrate` step (`scripts/migrate.py`) twice for a production environment on the default names as `prod_admin`, then twice for a staging environment whose six URLs carry a `staging_` prefix as `staging_admin`. For each environment it fails unless the migrator owns every table and the application database, the API can read and write every table but cannot create objects, the source role has `REPLICATION` and `SELECT` on exactly the synced tables, the publication lists exactly those tables and belongs to the migrator, the storage and auth databases belong to their roles, and the source role can create a logical replication slot. It also fails if any role or the admin of one environment can connect to any database of the other, if either admin can `SET ROLE` to, change the password of or grant itself any of the other environment's roles, if either admin holds the owner's rights on the other's databases, or if one admin is a member of the other. The container is removed afterwards. The stock superuser path is the one `make migrate` and `scripts/fresh_database.py` use, so the backend suite covers it.

A role with `REPLICATION` can also take a physical base backup of the whole instance where the server accepts replication connections. Cloud SQL does not accept them from users, but this is why the source credentials are kept as carefully as the admin's.

### Images (`backend/Dockerfile`, `frontend/Dockerfile`)

Both Dockerfiles build from the repo root (`docker build -f backend/Dockerfile --target prod .`), and each keeps its ignore list next to it as `Dockerfile.dockerignore`, since Docker reads that file rather than a `.dockerignore` outside the context root. The backend Dockerfile has a `base` stage (Python from `.python-version`, uv from its pinned image, the locked dependencies without the dev group), a `dev` stage (all groups, the repo mounted at `/app`, uvicorn with reload on 8701) and a `prod` stage, which bakes in the source and `infra/powersync/sync-rules.yaml` and runs as uid 10001. One `prod` image runs three commands: the default starts uvicorn on 8701 with two workers and proxy headers off (the API reads `X-Forwarded-For` itself), `arq clientbridge.tasks.worker.WorkerSettings` starts the worker, and `migrate` (`scripts/migrate.py`) runs the three steps of `make migrate`, with one difference: after `db_access roles` it reads the database's Alembic revision, and when that revision is not in the image's `migrations/` it fails with a message naming the revision, unless `MIGRATE_ALLOW_AHEAD=1` is set, which only the deploy workflow's rollback run does (a rollback to an image older than the last migration); then it logs the revision and skips `alembic upgrade head` and `db_access grants`, exiting 0. `roles` only sets passwords, memberships and ownership, so it is safe on a newer schema. `grants` is skipped because the table grants and the publication follow the synced tables of the newer image that migrated the schema, and the older image's list could name a table that no longer exists or narrow the publication. `make migrate` itself is unchanged. The demo seed is not part of it, because `scripts/seed_demo.py` refuses a database that is not on localhost. The base images (`python`, `node` and `caddy` from Docker Hub, `uv` from ghcr.io) are pinned by digest; Docker Hub limits anonymous pulls per address, so if the CI build starts failing on pulls, log the build job in to Docker Hub or pull through a mirror (`mirror.gcr.io`, or an Artifact Registry remote repository for Docker Hub) without changing the digests.

The web image builds web, Connect and the site with pnpm and copies them into Caddy (`frontend/Caddyfile`), which listens on 8080 over plain HTTP and routes by host. Its `serve` entry point needs only `BASE_DOMAIN`: it derives `SITE_HOST`, `APP_HOST`, `BOOK_HOST`, `PAY_HOST` and `SHOP_HOST` (each can be overridden), rewrites the site's placeholder domain `base.invalid` into the real URLs in a copy under `/tmp/site`, and starts Caddy. Caddy answers `/config.js` on every host from `BASE_DOMAIN`, `STRIPE_PUBLISHABLE_KEY` and the optional `API_URL`, `AUTH_URL`, `SYNC_URL`, `PAY_URL` and `BOOK_URL` (`runtimeConfig()` in app-core uses each one that is set and otherwise derives `https://api.D`, `https://sync.D` and so on from the base domain, with auth on the API host; deployed environments set none of them), serves `robots.txt` with the sitemap on the site host only when `ENVIRONMENT=production` (every other case disallows everything), sends HSTS, `nosniff`, `strict-origin-when-cross-origin` and `frame-ancestors 'none'` everywhere except Connect's embeddable paths (`/b/`, `/i/`, `/form/`, `/contract/`, `/review/`), and caches `/assets/*` for a year while everything else is `no-cache`. The build drops the mobile importer from the lockfile first, because the hoisted linker ignores `--filter` and the mobile packages exhaust a 4 GB Docker VM.

`make images` builds both, and `make up-app` runs `docker compose --profile app up --build`: `migrate`, then `api` on :8750, `worker` (Redis database 1, so it never takes jobs from a dev worker) and `web` on :8751, against the same Postgres, auth service, Redis, RustFS and Mailpit as `make up`. `APP_DATABASE` picks the database (default `clientbridge`). Locally the app is on `localhost:8751` (so the auth session cookie on `localhost` reaches it), the site on `site.localhost:8751` and Connect on `book.`, `pay.` and `shop.localhost:8751`. Compose sets `API_URL=http://localhost:8750`, `AUTH_URL=http://localhost:8713` (the shared auth service), `SYNC_URL=http://localhost:8704` (the shared PowerSync) and the `http://` pay and book URLs on the web service, so the browser reaches the local services rather than the `https://api.localhost` hosts the base domain would give. `infra/auth/kratos.yml` lists `http://localhost:8751` in its CORS origins and allowed return URLs.

---

## Email delivery (Resend)

Email goes out through `integrations/resend.py`: plain-text mail posted to Resend's send endpoint with `EMAIL_FROM` as the sender, the business's brand or billing email as the reply-to on client-facing mail, the message id as the idempotency key on thread, broadcast and class messages, and `business`, `client` and `message` tags that the delivery webhook reads back. Every tenant email is built by `client_email` or `business_email` in `services/notifications.py`, which apply the reply-to, the tags and the idempotency key, so no sender sets them by hand; auth mail from the auth service's courier is worded by the same module from the backend catalog and carries no tenant. Without `RESEND_API_KEY` and `EMAIL_FROM` the console no-op sender is used; production refuses to boot without them and `RESEND_WEBHOOK_SECRET`. `SMTP_URL`, when set, takes precedence over Resend; with `ENV=dev` it defaults to Mailpit (`smtp://localhost:8716`), so a dev API delivers there even with Resend keys in `.env`, an empty `SMTP_URL=` turns Mailpit off and sends through Resend locally (so an older `.env` that still has that empty line must drop it to keep Mailpit), and production refuses to boot with `SMTP_URL` set. The sender retries a 429 once, waiting for Resend's `retry-after` capped at two seconds since a send runs inside the caller's transaction, and raises on any other 4xx or 5xx, so an outage or an exhausted quota records a failed send.

Resend reports delivery to `POST /webhooks/email`, signed with Svix headers and checked by `valid_resend_signature` within a five-minute window. `process_email_event` records each event once under `resend_<svix-id>` in `webhooks`. An event finds its message through the `business` and `message` tags Resend echoes back, falling back to the global `provider_ref` lookup, and a message whose send timed out after Resend had accepted it gets its `provider_ref` backfilled from the event. `email.delivered` moves the message to delivered, `email.bounced`, `email.failed` and `email.suppressed` move it to failed, and `email.complained` withdraws email marketing consent with source `complaint` for the client behind the thread or the `client` tag, plus every active client sharing that mailbox. An event that names a message whose transaction has not committed yet is answered 503 for up to ten minutes so Svix retries it, and a signed event the schema cannot parse is acknowledged and recorded as a failed row rather than retried. Subscribe the endpoint to those five events in the Resend dashboard. Resend cannot reach localhost, so a local API is tested through a tunnel (`ngrok http <port>`) with its own webhook pointed at the tunnel host.

Production and staging setup of the sending domain, API key and webhook is in [operations](operations.md#resend).

## The demo / QA account

Demo accounts are normal tenants in the main local `clientbridge` database, using the standard servers and provider integrations. Every `make seed` replaces the demo businesses' rows with a fresh scenario and keeps unrelated tenants, and it behaves the same way locally and on staging. `make demo-check` validates their scenario and ledger. There is no demo runtime mode or separate presentation database.

| Login                         | Role                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| hannah@birchbark.example      | Hannah, owner of Birchbark Pet Studio                                |
| admin@birchbark.example       | Alex, administrator                                                  |
| diego@birchbark.example       | Diego, commissioned staff                                            |
| priya@birchbark.example       | Priya, employee                                                      |
| owner@cedarcoast.example.test | Rowan, owner of Cedar Coast Pet Care, a second business on a trial   |
| owner@northlight.example      | Erik, owner of Northlight Security, a camera installer               |
| office@northlight.example     | Naomi, office manager and administrator, not bookable                |
| liam@northlight.example       | Liam, installer paid commission on labour                            |
| ava@northlight.example        | Ava, installer paid hourly                                           |
| owner@brightwater.example     | Leah, owner of Brightwater Home Cleaning, a house cleaner            |
| joy@brightwater.example       | Joy, lead cleaner paid hourly                                        |
| harpreet@brightwater.example  | Harpreet, cleaner paid hourly                                        |
| tomasz@brightwater.example    | Tomasz, cleaner paid commission on labour                            |
| owner@ridgeline.example       | Jenna, owner and head coach of Ridgeline Strength Studio             |
| mateo@ridgeline.example       | Mateo, personal trainer paid commission                              |
| simran@ridgeline.example      | Simran, coach for mobility and Strong seniors, paid hourly           |
| owner@lakeside.example        | Nadia, owner of Lakeside Learning Studio, tutoring and music lessons |
| julien@lakeside.example       | Julien, English and French tutor paid commission                     |
| samuel@lakeside.example       | Samuel, science and SAT prep tutor paid hourly                       |
| sofia@lakeside.example        | Sofia, piano and guitar teacher paid commission                      |
| owner@maplemain.example       | Leila, owner and senior stylist of Maple and Main Hair Studio        |
| marcus@maplemain.example      | Marcus, senior stylist paid commission on services and retail        |
| tessa@maplemain.example       | Tessa, stylist paid commission on services and retail                |
| gabriela@maplemain.example    | Gabriela, colourist paid commission on services and retail           |
| amara@maplemain.example       | Amara, front desk coordinator and administrator, not bookable        |

The password is `demo1234`. The same logins work on staging, at `https://app.staging.clientbridge.ca` and in the staging mobile app, after each deploy's seed. The scenario is anchored to the current Vancouver date: `seed_demo.build_demo(as_of)` builds the fixture graph, the seed modules enrich it, and it is validated before it is written. Northlight Security, the camera installer, is built on the demo engine: `scripts/demo_engine.py` turns a business's spec (`scripts/demo_spec.py`: its people and hours, catalog, forms, contracts, pacing and storyline stages) into rows, and `scripts/demo_northlight.py` holds Northlight's spec and storyline. Each business on the engine is listed in `DEMO_BUSINESSES` in `scripts/demo_context.py`, which `demo_validate`, `connect_links`, `web_fixtures`, `stripe_setup` and `demo_snapshot` read; the engine validates the business's graph and checks that every storyline stage has its client and rows before anything is written. Its two installs today show one installer on site and one on the way when the seed runs between about 9:00 and 12:15 Vancouver time on a working day; at other times they move to the next working day without those states. Assets in `backend/scripts/demo_assets/` upload to the configured bucket first. The seed creates (or finds) an auth identity for each demo user with that password and a verified email, so `make seed` needs the auth service running. Each run replaces only the seeded businesses and their rows, and refuses when a seeded user also belongs to another business; it pauses the ledger's append-only trigger inside the transaction, and dates the ledger rows it writes from the scenario's clock. Auth identities are found by email or created, so an identity whose email the seed no longer uses stays in the auth service until it is deleted there; it still signs in, but to a new user with no business, which opens onboarding. Delete it from the auth service when a demo email changes. Demo contacts use reserved addresses (`.example` and `.test` domains, and 555-0100 to 555-0199 phone numbers), and the delivery job marks any email or SMS to a reserved address `failed` with `reserved_address` instead of handing it to the provider, so the demo's reminders and notices never leave the app. Historical provider references are fixture data, not usable Stripe objects: the fixture account reads as fully onboarded so Getting paid agrees with the seeded payment history, but new card payments and onboarding need the sandbox link below or test-provider credentials as for any account; without them use cash or manual payments. `make seed` refuses anything but a local database with `ENV=dev`; staging's deploy runs the same seed against `staging_clientbridge` with `ENV=staging`, and production is always refused.

Stripe sandbox provisioning and demo-account linking are documented in
[Local sandbox setup](payments.md#local-sandbox-setup). That guide covers plan/apply, onboarding,
webhook listeners, fixture versus real provider references, and relinking after a demo reset.

Which signing secret each Stripe event uses, the pinned API version and the staging and live endpoints are in [Payments and Stripe](payments.md#staging-and-production-setup).

`uv run python -m scripts.payment_accounts` (needs `STRIPE_SECRET_KEY`, test mode) audits one connected account's display name, support email, business URL and statement descriptor through Accounts v2, writing missing fields only with `--apply`. Integration tests use normal dependency-injected recording adapters and per-test rollback; CI databases use the `clientbridge_test*` prefix.

### Northlight Security walkthrough

Northlight shows the `site` subject kind end to end for a camera sales and installation business: a client books a survey on Connect, the owner quotes equipment and labour, the client accepts and signs, an installer runs the visit from the mobile app, and the handover form is signed on site. Products carry GST and PST and labour GST only. Each stage has a seeded client, with ids following `bk_nl_<key>`, `est_nl_<key>` and `cl_nl_<key>`:

| Stage                                          | Where to look                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| New lead, pending survey with a survey form    | Harper (`bk_nl_harper_survey`)                                        |
| Estimate sent with optional lines              | Rajesh (`est_nl_rajesh`)                                              |
| Accepted estimate ready for Book the install   | Ruth (`est_nl_ruth`)                                                  |
| Install booked from its estimate, deposit paid | Claire (`bk_nl_claire`)                                               |
| Today's installs, on site and on the way       | Owen (`bk_nl_owen`) and Mei Lin (`bk_nl_meilin`)                      |
| Installed and paid by Tap to Pay               | Sarah (`bk_nl_sarah`): photos, handover form, equipment, plan, review |
| Commercial client with two sites, overdue      | Island Storage (`cl_nl_islandstorage`)                                |
| Warranty call on a camera nearing its end date | Fiona (`bk_nl_fiona_warranty`)                                        |
| Declined estimate, cancelled survey            | Gordon (`est_nl_gordon`), Natalie (`bk_nl_natalie_survey`)            |

The scenario works around what the product does not do yet. A job has one installer, so a two-person or two-day install is shown as separate bookings, and the handover form stands in for a checklist; there is no time tracking. A Tap to Pay job goes through a sale, which pays retail commission only, so the installer earns nothing for Sarah's labour, and the payment reads as an ordinary card sale. The on-my-way text goes through the delivery job and does not appear in the inbox.

### Brightwater Home Cleaning walkthrough

Brightwater shows the `property` subject kind for a house cleaning business in Calgary, built on the demo engine in `scripts/demo_brightwater.py`. A new client books a first clean online and fills in the home details form, move-out and move-in cleans are quoted by estimate and held with a 25% deposit, regulars are on weekly or every-two-weeks series, and the three cleaners work from the mobile app with each home's entry, alarm and pet notes on its property. Alberta charges GST only, so cleans, add-ons and supplies carry 5% and gift cards none. Each stage has a seeded client, with ids following `bk_bw_<key>`, `est_bw_<key>` and `cl_bw_<key>`:

| Stage                                                  | Where to look                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| New lead, first clean waiting for approval             | Sofia (`bk_bw_sofia`): home details form, agreement not yet signed                       |
| Move-out quote sent with optional lines                | Daniel (`est_bw_daniel`): kitchen and bathroom photos on his home details                |
| Move-out quote accepted and booked, deposit paid       | Wei (`est_bw_wei`, `bk_bw_wei`)                                                          |
| Regular every two weeks on a series                    | Margaret (`sch_bw_margaret`); Anjali (`sch_bw_anjali`) is weekly on Saturdays            |
| Today's cleans: checked in, on the way and later today | Linh (`bk_bw_linh`), Chidi (`bk_bw_chidi`) and Kateryna (`bk_bw_kateryna`)               |
| Cleaned and paid by Tap to Pay with a tip              | Amara (`bk_bw_amara`, `ord_bw_amara`)                                                    |
| Property manager with four units, one invoice overdue  | Prairie Lane (`cl_bw_prairielane`, `inv_bw_prairielane_sunnyside`)                       |
| Cancelled late, with a late cancellation fee           | Brandon (`bk_bw_brandon_late`, `inv_bw_brandon_late`)                                    |
| Five-star feedback and a review request                | Fatima (`fr_bw_feedback_fatima`)                                                         |
| Three-star feedback about a missed spot, re-clean done | Kevin (`fr_bw_feedback_kevin`, `bk_bw_kevin_reclean`) and the owner's reply in the inbox |
| Gift card bought for a mother's clean                  | Jasmine (`gc_bw_mom`) and her mother Teresita (`bk_bw_teresita_gift`)                    |

Rachel's deep clean (`bk_bw_rachel`) has a partial refund for an add-on that wasn't done, and `bk_bw_home_20_lockout` is a no-show where the cleaner couldn't get in. The three cleans today show Joy checked in, Harpreet on the way and Tomasz later in the day when the seed runs between about 9:00 and 12:30 Calgary time on a weekday; at other times they move to the next working day without those states.

The scenario works around what the product does not do yet. A booking has one cleaner, so a two-person move-out is shown as one cleaner for the whole time. Only products can be add-ons, so inside the oven, the fridge, windows and laundry are products without stock, and adding one doesn't lengthen the booking. There is no late cancellation fee in the product: the cancellation cutoff only limits online changes, so Brandon's fee is an invoice line added by hand, and the lockout is a no-show with no fee. Ratings come from the Clean feedback form; the product records review requests but not the reviews themselves, so the owner's reply to Kevin is an email. A gift card is redeemed against its balance rather than paid on an invoice, so Teresita's clean is booked at no charge and the card is redeemed for its price with GST. Tap to Pay goes through a sale, which pays retail commission only, so Amara's clean isn't in Joy's earnings; the tip is recorded on the payment. Entry, alarm and pet notes are free text on the property, visible to every team member.

### Ridgeline Strength Studio walkthrough

Ridgeline shows a training studio in Edmonton with no subject kind: a new client books a free intro on Connect and fills in the PAR-Q and waiver, then trains one to one, buys a 10-session pack, or joins a monthly class membership and books small group classes from a weekly timetable of eleven sessions. Alberta charges GST only, so every line carries GST except gift cards. Members book classes at no charge, drop-ins are invoiced per class, and Strong seniors regulars use a 10-class pass. Each stage has a seeded client, with ids following `bk_rl_<key>`, `sub_rl_<plan>_<key>` and `cl_rl_<key>`:

| Stage                                                | Where to look                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| New lead, free intro booked online with a PAR-Q      | Hailey (`bk_rl_hailey_intro`, pending approval; waiver still unsigned)            |
| Member on the unlimited plan                         | Ben (`sub_rl_unlimited_ben`)                                                      |
| Member whose card failed, past due                   | Kyle (`sub_rl_eight_kyle`), with the text about the declined card                 |
| Halfway through a 10-session pack                    | Grace (`pkg_rl_pt10_grace`): five used, the sixth booked (`bk_rl_grace_pack_5`)   |
| Full class, waitlist seat given after a cancellation | `ses_rl_full_class`: Lucy cancelled, Farah got the seat, Devon still waits        |
| Today's training and class with check-ins            | Omar (`bk_rl_omar_today`), `ses_rl_today_class`, Linh later today                 |
| Cancelled membership                                 | Carmen (`sub_rl_unlimited_carmen`), moving to Calgary                             |
| Strong seniors on a 10-class pass                    | Elaine (`pkg_rl_seniors_elaine`)                                                  |
| Five-star and four-star feedback                     | Walter (`fr_rl_feedback_walter`), Anita on parking (`fr_rl_feedback_anita`)       |
| Paid by Tap to Pay with a retail add-on              | Jordan (`ord_rl_jordan`): a session and a set of bands                            |

The scenario works around what the product does not do yet. The product stores no star reviews, so session feedback is a form with a rating field, and the owner's reply to Anita is an email in her thread. A membership's eight classes a month and its 10% retail discount are shown on the plan but not enforced: members' class bookings are priced at zero by hand and the seed keeps 8-class members to eight. A membership cannot be paused from the app, so the stage shows a cancellation. A failed renewal leaves no failed payment row, only the past due plan. Omar's session and today's class are in progress only when the seed runs inside a coach's hours; at other times they move to the next working day without check-ins.

### Lakeside Learning Studio walkthrough

Lakeside shows the `student` subject kind for a tutoring and music lessons studio in Ottawa. Parents are the clients and their children are the students, each with a grade, school, birthday and allergies where they have one, and lesson notes on the student. A new family books an assessment online and fills in the registration form, students then come at the same time each week through a ten-week term as a series, and families pay per lesson, up front for a term package, or monthly on a plan. Curriculum tutoring and music lessons are exempt from HST, while SAT prep and books and supplies carry HST at 13%. Ids follow `cl_ls_<family>`, `sj_ls_<family>` for the first child and `sch_ls_<key>` for a weekly series, whose visits are `bk_ls_<key>_<n>`:

| Stage                                                     | Where to look                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| New family booked an assessment, registration submitted   | Amara Nwosu (`bk_ls_nwosu_assessment`, waiting for approval; policies not yet signed)                                                       |
| Two children on different weekly series, sibling discount | Thu Tran (`sch_ls_tran_minh`, `sch_ls_tran_an`, 10% off An's invoices)                                                                      |
| Partway through a 10-lesson term package                  | Isabelle Fontaine (`pkg_ls_term10_fontaine`, `sch_ls_fontaine`)                                                                             |
| Missed lesson, rescheduled as a make-up                   | Yusuf Ahmed (cancelled `bk_ls_ahmed_5`, make-up `bk_ls_ahmed_makeup`, text thread)                                                          |
| SAT prep class nearly full                                | Marta Kowalski (`ses_ls_sat_3`, seven of eight seats, each on a course package)                                                             |
| Exam review class full, with a waitlist                   | Marc Leblanc (`bk_ls_review_next_leblanc` on `ses_ls_review_next`)                                                                          |
| Today's lessons for each tutor                            | The calendar today: two to three lessons each from `sch_ls_dhillon`, `sch_ls_gagne`, `sch_ls_rahimi`, `sch_ls_li` and others                |
| Monthly plan paid by pre-authorized debit                 | Kwame Mensah (`sub_ls_plan_mensah`, bank account `pm_ls_mensah`, signed plan agreement)                                                     |
| Five-star feedback from a parent                          | Laura Bianchi (`fr_ls_feedback_bianchi`), with a review request and a thank-you thread                                                      |
| Term-end thread and next term registration                | Nadège Desrosiers (`th_ls_desrosiers_email`, `fr_ls_reregister_desrosiers`)                                                                 |
| Overdue invoice, no-show, three-star feedback             | Brendan Sullivan (`inv_ls_sullivan_overdue`), Daniel Park (`bk_ls_park_extra`), Harpreet Gill (`fr_ls_feedback_gill`, owner reply by email) |
| Paid by Tap to Pay with a book                            | Jun Li (`ord_ls_li_book`)                                                                                                                   |

Weekly series are placed by working day from the seed date, so today's lessons always fall on the day the seed runs, or on Monday when it runs on a Sunday. At the frozen test time they are all still ahead, in the afternoon; a seed run in the evening finds them completed. The scenario works around what the product does not do yet. Reviews are stored only as review requests, so ratings live in a feedback form and the owner's reply is an email. A plan's lessons are booked at no charge with a note, because a subscription does not cover bookings the way a package does. The sibling discount is a 10% discount on each invoice rather than a rule. Clients cannot buy packages or gift cards online, so the studio sells them in person, and Ontario's point-of-sale rebate on printed books is not modelled, so the workbooks carry the full 13% HST. A registration form is answered once per family for the first child, and each student's learning needs are a note on the student.

### Maple and Main Hair Studio walkthrough

Maple and Main is a four-chair salon on the Danforth in Toronto with no subject kind: the client is the only thing booked. Leila (the owner) and Marcus are senior stylists, Tessa is a stylist with a lower price for the same cut, Gabriela is the colourist, and Amara runs the front desk. Everything carries Ontario's 13% HST except gift cards. The book covers 30 weeks of history and 5 weeks ahead, visits are paid at the desk with tips on most card payments, partial highlights, full highlights and balayage take a deposit, and the three stylists earn commission on services and retail. Each stage has a seeded client, with ids following `bk_mm_<key>` and `cl_mm_<key>`:

| Stage                                                  | Where to look                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| First-time client with the consultation form submitted | Farah (`bk_mm_farah_consult`, `fr_mm_consult_farah`): pending online booking, photos |
| Regular rebooked every six weeks with a series         | Grace (`sch_mm_grace`): root colour with Gabriela, colour formula in her notes       |
| Today's book, with a balayage in progress              | Olivia (`bk_mm_olivia`) and every stylist's `bk_mm_today_<member>_<n>`               |
| No-show with a forfeited deposit                       | Tamara (`bk_mm_tamara`), rebooked as `bk_mm_tamara_rebook`                           |
| Bridal party booked after the trial                    | Sofia (`bk_mm_sofia_trial`, `bk_mm_sofia_bride`, `bk_mm_sofia_party_<n>`)            |
| Retail sold at checkout with a cut                     | Elena (`bk_mm_elena`, `ord_mm_elena`)                                                |
| Gift card bought and redeemed                          | David (`gc_mm_david`) and Priyanka (`bk_mm_priyanka_gift`)                           |
| Three-blowout package, two used                        | Chloé (`pkg_mm_blowouts_chloe`)                                                      |
| Five-star and four-star feedback                       | Amira (`fr_mm_feedback_amira`) and Robert (`fr_mm_feedback_robert`), with a reply    |

Today's book shows Olivia's balayage in progress, with morning visits paid and the rest of the day ahead, when the seed runs from about 75 minutes after Gabriela starts until three and a half hours before she finishes, on a day all four stylists work (11:15 to 15:45 Toronto time on a Tuesday or Friday). At other times the same book moves to the next day all four work, without those states.

The scenario works around what the product does not do yet. A price can't vary by stylist, so the two cut prices are two services, and any stylist can be booked for either online. A visit holds the chair for its whole length, with no processing time in which the stylist can take another client, and one booking carries one service, so a cut and colour would be two bookings. A checkout at the desk goes through a sale, which pays retail commission only, so Elena's cut and the other desk checkouts earn the stylist nothing for the service; the other visits are invoiced, which pays service commission and no retail commission. Redeeming a gift card posts the amount to revenue rather than paying the visit's invoice, so Priyanka's visit is booked at no charge with a note, and Marcus earns no commission on it. Star ratings live with external reviews, so the feedback form's rating field stands in for them, and Leila's reply is an email. Colour formulas are client notes. The front desk is paid outside the app, and the brand has no cover photo because it takes a URL rather than an uploaded file.

### PowerSync signing-key rotation

The signing key, its key ID and the rotation procedure are in [operations](operations.md#powersync-signing-keys).

Offline regression coverage includes month rollover, cancellation after session timeout, access removal after an accepted hours edit, seven-day offline access expiry, static-only service-worker caching, and Android offline hours across a process restart (`07-sync-startup.yaml`). Run `make test-sync` with a stable source tree: Vite reloads the test page if a source edit lands mid-test.

### Local platform admin demo

After `make seed`, run `make configure-demo-admin` and restart `make dev-api` to load the grant, then run `make dev-admin`. Open `http://localhost:8711` and sign in through the regular login page as **hannah@birchbark.example**, password **demo1234**. The command resolves the existing seeded `us_dev` identity and writes only `DEV_PLATFORM_ADMIN_IDENTITY_IDS` in `backend/.env`; it does not reset business data or change the account password. Rerun it if the auth identity is recreated.

This grant is ignored unless `ENV=dev`; staging/production require explicitly configured `PLATFORM_ADMIN_IDENTITY_IDS`. Diego and Priya remain ordinary demo staff. The console uses admin-scoped navy sidebar `#142238` and accent `#243f65`; the provider app theme is unchanged.

### Admin workspace

Run `make dev-admin` and open `http://localhost:8711`. `make configure-demo-admin` grants the existing Hannah demo identity development-only platform access without reseeding. Signed-out users go through the regular web login; ordinary business roles do not grant platform access.

The core workspace provides searchable businesses, user accounts and client records, payment/refund/ledger inspection, grouped audit records, webhook processing and applied/expected migration revisions. Access shows the current operator's grant; migrations and grant changes remain server/deployment workflows. List pages show 50 rows at a time, and related detail collections show at most 100 records.

Email lab uses the same ten synthetic templates as `make preview-emails`. Select a template, enter one recipient, choose a configured SMTP or Resend transport, then confirm. The subject is marked `[TEST]`; demo links and codes are not live customer actions. Local SMTP is captured in Mailpit (`http://localhost:8715`). Provider acceptance is not proof of inbox delivery. The initial send guard is process-local with Resend provider idempotency; durable delivery history and multi-worker deduplication are not implemented.
