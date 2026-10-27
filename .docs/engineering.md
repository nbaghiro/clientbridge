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

| Job               | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **backend**       | `uv sync` → `make format-check-backend lint-backend` (ruff, pyright, structure check) → `make test-tier` → `make test-backend` (pytest on pytest-xdist with 90% branch coverage combined across the workers, each worker on its own copy of the seeded template, which is restored from a dump the job caches under the template's name) → `make test-auth`, which fails rather than skips when the auth service is unreachable in CI |
| **frontend**      | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make format-check-frontend lint-frontend test-frontend` (prettier, eslint + `check-structure.mjs` + knip, tsc, the site copy rules, the lint rule tests, vitest for app-core and site, then app-core again under `TZ=America/Vancouver`, `America/Halifax` and `Asia/Tokyo`; the formatter tests assert `en-CA` and `en-XA` output)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **build**         | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make build-apps` (`tsc -b` and the Vite builds for web and Connect; the site job builds the site, so it is left out here), so a broken bundle fails CI beyond `tsc --noEmit`; runs beside the frontend job rather than after it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **images**        | Builds the `prod` targets of `backend/Dockerfile` and `frontend/Dockerfile` with Buildx and the GitHub Actions cache, without pushing, so a broken Dockerfile fails CI. The frontend image installs from a stage that holds only the package manifests, so its install layer stays cached until a manifest or the lockfile changes |
| **infra**         | `uv sync` in `infra/pulumi` → `make format-check-infra lint-infra test-infra` (ruff, pyright, and pytest of the cloud, staging and prod stacks against Pulumi's mocks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **site**          | Node from `.nvmrc` · Chromium through `.github/actions/playwright` · `make test-site`: a fresh build, then Playwright e2e on it (the copy rules and content tests run in the frontend job): every page returns 200 with its content in the HTML, no console errors, no broken images or internal links, no sideways scroll at 390 and 1440px, axe with no serious or critical issues, 404 page served with a 404 |
| **e2e**           | every end-to-end lane, grouped under one parent: see [End-to-end lanes in CI](#end-to-end-lanes-in-ci) |
| **e2e-result**    | the one required check for the e2e group: it passes only when every lane in it passed |
| **contract**      | stripe-mock service · real `StripeGateway` validated against Stripe's OpenAPI mock; a missing mock fails the job in CI instead of skipping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **codegen-drift** | `make codegen-check`: `make gen-api`, `gen-sync-schema`, `gen-themes`, `gen-messages`, `gen-strings` (which also fail on invalid or unused catalog messages), `gen-zones` and `gen-taxes`, then a diff check on the generated files (the api-client, sync schema, themes, `messages.pot`, `en_XA.po`, both `strings.ts` accessors and `en-XA.json` files, Connect's `embed.js`, app-core `zones.ts` and `zones.cases.json`, and app-core `taxRates.ts` and `taxes.cases.json`), so the committed generated code cannot drift from its source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### End-to-end lanes in CI

`ci.yml` calls `e2e.yml`, a reusable workflow, as its `e2e` job, and `e2e.yml` calls one reusable workflow per surface. GitHub draws each call as a box that holds its jobs, so the run graph shows one `e2e` group with a subgroup for each surface, and checks read like `e2e / web / chromium (1/5)`. Every job runs on its own runner and starts its own test tier.

| Subgroup | Jobs |
| --- | --- |
| `e2e / prepare` | runs `make test-prepare` once: it seeds the core demo businesses into a Postgres dump and builds web, Connect and admin, then uploads both as the `e2e-prepared` artifact. The web and Connect lanes wait for it |
| `e2e / web` (`e2e-web.yml`) | the Chromium lane in five shards, the `en-XA` pass, Firefox and WebKit (the cases tagged `@browsers`), journeys in two shards, and filings. Its `result` job merges each sharded lane's reports and requires every case of the lane across its shards, since a single shard holds only part of it |
| `e2e / connect` (`e2e-connect.yml`) | Chromium, the `en-XA` pass, Firefox and WebKit |
| `e2e / mobile` (`e2e-mobile.yml`) | `shards` checks that every Maestro flow is in exactly one shard of `e2e/shards.json`; `build` makes an x86_64 release APK, cached under the Expo native fingerprint so a hit only rebundles the JavaScript; `android` runs each shard on an Android 14 emulator whose pinned build, system image and quick-boot snapshot are cached together, and warns when a flow takes over three times its usual time in `e2e/flow-seconds.json`. Mobile doesn't wait for `prepare`, since its build is the longer path; each shard seeds its own snapshot |
| `e2e / sync` | `make test-sync`, which writes its own fixtures rather than the demo seed |

The shared steps live in `.github/actions`:

- **`playwright`** installs a browser and its system packages from a cache keyed by the runner image, the Playwright version and the browser. A miss installs from the Ubuntu mirror and keeps the downloaded packages; a hit installs those packages offline. The mirror has been slow enough to hold a lane for 12 minutes, so a hit removes the lanes' dependence on it. If the runner image has moved and a saved package no longer installs, the step falls back to the mirror.
- **`e2e-setup`** installs the backend and frontend, the lane's browser and the tier, and restores the `e2e-prepared` artifact into the tier's folder.

The tier's images are pulled rather than cached: pulling them took about 33 seconds, and restoring a saved copy and loading it into Docker took 31 to 47 seconds.
- **`e2e-collect`** uploads a lane's run records and the tier's logs, pass or fail.

A sharded lane splits its cases by measured time rather than by file. The runner lists the lane's cases, gives each the seconds `apps/web/e2e/case-seconds.json` records for it (the median for a case it doesn't know), and hands them out longest first to the shard with the least so far. A shard passes its cases to Playwright as `file:line` filters, so one file's cases can land in several shards, while the cases a shard holds from one file still run in order on one worker. The web `result` job uploads the merged measurements as `web-case-seconds`; copy them into `case-seconds.json` when the shards drift apart.

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

`make test-backend` runs the suite through `e2e/database.py`, which seeds a template database once per
migrations, seed code and frozen instant (or restores it from the dump it kept under the tier's `templates/`
folder, which CI caches), then copies it to a `clientbridge_test_<random>` database for
each pytest-xdist worker (`<database>_gw0`, `_gw1` and so on), runs pytest with `-n auto` and drops the copies.
`tests/__init__.py` points each worker at its own copy before the settings load, so the rollback per test
works as before and workers never see each other's rows. There is one worker per core, up to eight, and
`TEST_WORKERS` sets another count; pytest-cov combines the workers' coverage before the 90% gate. Other
suites, the dev API and e2e runs on the same machine share the `clientbridge` database and lock or change
the seeded rows, which made tests fail with deadlocks and unexpected rows when they ran at the same time.
It seeds with `--core`, so the database holds only the core businesses (Birchbark, Cedar Coast and Northlight, marked `core=True` in `DEMO_BUSINESSES`), and the other editions are built in memory and checked with `validate_graph` by `test_flows_demo_engine.py`. A plain `uv run pytest` still uses `DATABASE_URL`. Tests that commit from their own connections (the race
tests) delete what they wrote.

### Time: one clock, frozen in tests

Code reads the current time only through `core/clock.py`: `clock.now()` for business time,
`clock.today(zone)` for a local date, and `clock.wall()` for checks against a clock outside the app
(auth session age, the PowerSync JWT `iat`/`exp`, Svix and Stripe signature tolerance, provider event
grace). The structure check fails on `datetime.now`, `datetime.utcnow`, `date.today`, `time.time` and
`func.now` anywhere else in `src`, `tests`, `scripts` and `e2e` (`func.now` stays in model server defaults), and
on moving the clock from `src`. Under pytest the clock starts at `FROZEN` (`tests/clock.py`,
2026-10-13T17:00Z, 10 a.m. in Vancouver) for every test and ticks from there, test modules are collected
at that instant, and `e2e/database.py` seeds the test database `--as-of FROZEN`; the `db` fixture fails
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

### How an e2e run starts

An e2e run works on its own copy of the core demo businesses in the shared tier, renamed into its namespace (`backend/e2e/namespace.py`). Seeding those businesses takes about a minute, so it happens once into a Postgres dump (`backend/e2e/snapshot.py`, under the tier's `snapshots/` folder) keyed by the migrations and the seed's code and assets. A run restores the dump into a scratch database, puts the demo assets in its own bucket, and copies the rows into the tier under its namespace, which takes seconds. A run with an explicit seed instant, such as filings with its quarter opening, needs a dump made at that instant. A real-time run takes one made in the last 15 minutes on the same local day in every core business's zone, since the suites derive their dates from today; otherwise it seeds a new one. Concurrent runs wait for the one that is seeding.

Browser lanes preview production builds of web, Connect and admin. The runner builds each app once per source fingerprint (the tracked frontend files other than tests, the mobile app and the site) into the tier's `builds/` folder, and every lane on that source serves the same build with `vite preview`, which answers `/config.js` with the run's URLs. The `en-XA` pass keeps a dev server, since the pseudo-locale is a development switch. `make test-prepare` does both ahead of time, which is what CI's prepare job runs.

### Where an e2e test goes

The browser and device suites follow the same one-name-per-concept rule as the rest of the code, so the file for a test is the one named after the concept you changed: the app-core domain file, the strings group, the service and the page share that name.

| What changed                                                       | File to extend                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One concept's provider behaviour (rules, states, rejections)       | `apps/web/e2e/<concept>.e2e.ts`, for example `clients`, `billing`, `pos`, `earnings` or `reports`                                                                                       |
| A public page                                                      | `apps/connect/e2e/<publicPage>.e2e.ts`, for example `publicBooking`, `publicPay` or `publicShop`                                                                                        |
| A mobile-only screen or native behaviour                           | `apps/mobile/e2e/<concept>.yaml`, or `<concept>.<aspect>.yaml` when the concept has more than one flow; `shards.json` sets the order                                                    |
| Something whose consequences cross concepts, devices or the worker | the anchor journey in `apps/web/e2e/journeys/<flow>.journey.ts`: `visit`, `estimate`, `stock`, `client`, `documents`, `communication`, `entitlements`, `team`, `device` or `operations` |
| A new concept                                                      | a new `<concept>.e2e.ts`                                                                                                                                                                |

Pages named by their nav label use their concept's name here too, so Invoices tests live in `billing`, Inbox in `messaging`, Team in `staff` and Schedule in `bookings`. A few cross-cutting suites keep their own names, as the backend's `test_flows_*` do: `auth`, `offline`, `sync`, `security`, `shell` (the page-and-dialog walk), `accessibility` and `pseudo`, plus `embed` and `site` in Connect. A mobile flow may also take the name of a screen with no domain of its own, such as `setup`. The completed-quarter filing case is `remittances.filing.ts`, and the Stripe lane's files start with `stripe-`.

Helpers live in `apps/web/e2e/support/<concept>.ts`, and their database checks are read-only SQL over the one connection in `support/db.ts`. `check-structure.mjs` fails on a spec, journey or flow named any other way, or a helper outside `support/`; it reads the concepts from `app-core/src/domain/` and Connect's pages from `apps/connect/src/pages/`. Each new case also gets an ID in `backend/e2e/results.py` and its audit families in `.docs/executions/e2e/coverage.json`. A lane fails when a case its registry requires doesn't run, and `test_harness.py` checks that every registered ID is written in its lane's files.

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
| **8709**        | Connect (Vite) — customer app, on `book.`, `shop.`, `pay.` and `<slug>.localhost`    | —           | `apps/connect` vite (strictPort)                                                                                         |
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
                           # `e2e.actions web-fixtures` first adds a client series, low stock, a dispute and a
                           # duplicate client through the API if missing)
make test-connect          # Connect e2e: book to the deposit step, manage link, shop and every client page (needs the API + seed)
make test-mobile           # Maestro native walkthroughs (development build + local stack + seed)
make test-staging-smoke    # read-only Playwright checks of deployed staging (SMOKE_* env vars pick another
                           # environment; see demo.md for the logins it uses)
make lighthouse-site       # Lighthouse budget (desktop >= 95 in every category) against the :8710 preview
make test-sync             # disposable Postgres + PowerSync: per-role replica rows and columns, revocation,
                           # hours uploads, the signing-key rotation drill, then the replication health check
make images                # build the backend and web prod images
make up-app                # the prod images on the local infra: API :8750, web :8751
make replication-health    # local PowerSync readiness, slot, retained WAL (1 GiB) and replay lag (60 s)
```

Locally `BASE_DOMAIN` stays unset, so the API keeps its localhost URLs from `.env`, `TRUSTED_PROXY_HOPS`
is 0 (the socket peer is the client) and logs are plain text; the web, Connect and admin dev servers serve
`/config.js` with the localhost URLs in each app's committed `.env.development`, and a publishable key from
its own `.env` (`STRIPE_PUBLISHABLE_KEY`). A deployed API sets `ENV` (`staging` or `prod`) and `BASE_DOMAIN`,
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

`uv run python -m scripts.verify_db_access` (from `backend/`, needs Docker) keeps this working. It starts the pinned `postgres:16` image on a random local port with two Cloud SQL style admins, `prod_admin` and `staging_admin` (each `CREATEROLE CREATEDB REPLICATION`, neither a superuser nor a member of the other), leaves production's application database for `db_access` to create and has `staging_admin` create staging's, and runs the image's `migrate` step (`scripts/migrate.py`) twice for a production environment on the default names as `prod_admin`, then twice for a staging environment whose six URLs carry a `staging_` prefix as `staging_admin`. For each environment it fails unless the migrator owns every table and the application database, the API can read and write every table but cannot create objects, the source role has `REPLICATION` and `SELECT` on exactly the synced tables, the publication lists exactly those tables and belongs to the migrator, the storage and auth databases belong to their roles, and the source role can create a logical replication slot. It also fails if any role or the admin of one environment can connect to any database of the other, if either admin can `SET ROLE` to, change the password of or grant itself any of the other environment's roles, if either admin holds the owner's rights on the other's databases, or if one admin is a member of the other. The container is removed afterwards. The stock superuser path is the one `make migrate` and `e2e/database.py` use, so the backend suite covers it.

A role with `REPLICATION` can also take a physical base backup of the whole instance where the server accepts replication connections. Cloud SQL does not accept them from users, but this is why the source credentials are kept as carefully as the admin's.

### Images (`backend/Dockerfile`, `frontend/Dockerfile`)

Both Dockerfiles build from the repo root (`docker build -f backend/Dockerfile --target prod .`), and each keeps its ignore list next to it as `Dockerfile.dockerignore`, since Docker reads that file rather than a `.dockerignore` outside the context root. The backend Dockerfile has a `base` stage (Python from `.python-version`, uv from its pinned image, the locked dependencies without the dev group), a `dev` stage (all groups, the repo mounted at `/app`, uvicorn with reload on 8701) and a `prod` stage, which bakes in the source and `infra/powersync/sync-rules.yaml` and runs as uid 10001. One `prod` image runs three commands: the default starts uvicorn on 8701 with two workers and proxy headers off (the API reads `X-Forwarded-For` itself), `arq clientbridge.tasks.worker.WorkerSettings` starts the worker, and `migrate` (`scripts/migrate.py`) runs the three steps of `make migrate`, with one difference: after `db_access roles` it reads the database's Alembic revision, and when that revision is not in the image's `migrations/` it fails with a message naming the revision, unless `MIGRATE_ALLOW_AHEAD=1` is set, which only the deploy workflow's rollback run does (a rollback to an image older than the last migration); then it logs the revision and skips `alembic upgrade head` and `db_access grants`, exiting 0. `roles` only sets passwords, memberships and ownership, so it is safe on a newer schema. `grants` is skipped because the table grants and the publication follow the synced tables of the newer image that migrated the schema, and the older image's list could name a table that no longer exists or narrow the publication. `make migrate` itself is unchanged. The demo seed is not part of it, because `scripts/seed_demo.py` refuses a database that is not on localhost. The base images (`python`, `node` and `caddy` from Docker Hub, `uv` from ghcr.io) are pinned by digest; Docker Hub limits anonymous pulls per address, so if the CI build starts failing on pulls, log the build job in to Docker Hub or pull through a mirror (`mirror.gcr.io`, or an Artifact Registry remote repository for Docker Hub) without changing the digests.

The web image builds web, Connect and the site with pnpm and copies them into Caddy (`frontend/Caddyfile`), which listens on 8080 over plain HTTP and routes by host. Its `serve` entry point needs only `BASE_DOMAIN`: it derives `SITE_HOST`, `APP_HOST`, `BOOK_HOST`, `PAY_HOST` and `SHOP_HOST` (each can be overridden), rewrites the site's placeholder domain `base.invalid` into the real URLs (a demo link's `<slug>.base.invalid` becomes that business's page) in a copy under `/tmp/site`, and starts Caddy. Caddy answers `/config.js` on every host from `BASE_DOMAIN`, `STRIPE_PUBLISHABLE_KEY` and the optional `API_URL`, `AUTH_URL`, `SYNC_URL`, `PAGE_URL`, `BOOK_URL`, `SHOP_URL` and `PAY_URL` (`runtimeConfig()` in app-core uses each one that is set and otherwise derives `https://api.D`, `https://sync.D` and so on from the base domain, with auth on the API host; deployed environments set none of them), serves `robots.txt` with the sitemap on the site host only when `ENVIRONMENT=production` (every other case disallows everything), serves Connect on `book.`, `shop.` and `pay.` and on any other one-label subdomain as a business page, redirects the bare Connect hosts to the site, sends HSTS, `nosniff`, `strict-origin-when-cross-origin` and `frame-ancestors 'none'` everywhere except Connect's embeddable pages (business pages, booking, forms and contracts on `book.`, the shop on `shop.`, invoices on `pay.`), and caches `/assets/*` for a year while everything else is `no-cache`. The build drops the mobile importer from the lockfile first, because the hoisted linker ignores `--filter` and the mobile packages exhaust a 4 GB Docker VM.

`make images` builds both, and `make up-app` runs `docker compose --profile app up --build`: `migrate`, then `api` on :8750, `worker` (Redis database 1, so it never takes jobs from a dev worker) and `web` on :8751, against the same Postgres, auth service, Redis, RustFS and Mailpit as `make up`. `APP_DATABASE` picks the database (default `clientbridge`). Locally the app is on `localhost:8751` (so the auth session cookie on `localhost` reaches it), the site on `site.localhost:8751` and Connect on `book.`, `shop.`, `pay.` and `<slug>.localhost:8751`. Compose sets `API_URL=http://localhost:8750`, `AUTH_URL=http://localhost:8713` (the shared auth service), `SYNC_URL=http://localhost:8704` (the shared PowerSync) and the `http://` page, book, shop and pay URLs on the web service, so the browser reaches the local services rather than the `https://api.localhost` hosts the base domain would give. `infra/auth/kratos.yml` lists `http://localhost:8751` in its CORS origins and allowed return URLs.

---

## Email delivery (Resend)

Email goes out through `integrations/resend.py`: plain-text mail posted to Resend's send endpoint with `EMAIL_FROM` as the sender, the business's brand or billing email as the reply-to on client-facing mail, the message id as the idempotency key on thread, broadcast and class messages, and `business`, `client` and `message` tags that the delivery webhook reads back. Every tenant email is built by `client_email` or `business_email` in `services/notifications.py`, which apply the reply-to, the tags and the idempotency key, so no sender sets them by hand; auth mail from the auth service's courier is worded by the same module from the backend catalog and carries no tenant. Without `RESEND_API_KEY` and `EMAIL_FROM` the console no-op sender is used; production refuses to boot without them and `RESEND_WEBHOOK_SECRET`. `SMTP_URL`, when set, takes precedence over Resend; with `ENV=dev` it defaults to Mailpit (`smtp://localhost:8716`), so a dev API delivers there even with Resend keys in `.env`, an empty `SMTP_URL=` turns Mailpit off and sends through Resend locally (so an older `.env` that still has that empty line must drop it to keep Mailpit), and production refuses to boot with `SMTP_URL` set. The sender retries a 429 once, waiting for Resend's `retry-after` capped at two seconds since a send runs inside the caller's transaction, and raises on any other 4xx or 5xx, so an outage or an exhausted quota records a failed send.

Resend reports delivery to `POST /webhooks/email`, signed with Svix headers and checked by `valid_resend_signature` within a five-minute window. `process_email_event` records each event once under `resend_<svix-id>` in `webhooks`. An event finds its message through the `business` and `message` tags Resend echoes back, falling back to the global `provider_ref` lookup, and a message whose send timed out after Resend had accepted it gets its `provider_ref` backfilled from the event. `email.delivered` moves the message to delivered, `email.bounced`, `email.failed` and `email.suppressed` move it to failed, and `email.complained` withdraws email marketing consent with source `complaint` for the client behind the thread or the `client` tag, plus every active client sharing that mailbox. An event that names a message whose transaction has not committed yet is answered 503 for up to ten minutes so Svix retries it, and a signed event the schema cannot parse is acknowledged and recorded as a failed row rather than retried. Subscribe the endpoint to those five events in the Resend dashboard. Resend cannot reach localhost, so a local API is tested through a tunnel (`ngrok http <port>`) with its own webhook pointed at the tunnel host.

Production and staging setup of the sending domain, API key and webhook is in [operations](operations.md#resend).

## The demo / QA account

[demo.md](demo.md) is the overview of the demo businesses, their logins and what each shows.

Demo accounts are normal tenants in the main local `clientbridge` database, using the standard servers and provider integrations. Every `make seed` replaces the demo businesses' rows with a fresh scenario and keeps unrelated tenants, and it behaves the same way locally and on staging. Tests and CI seed only the core businesses (`make seed-core`, or `seed_demo --core`), which keeps their setup to about a quarter of the rows; this is the one deliberate difference between test data and the demo, and `make seed` and staging's nightly seed still write every business. `make demo-check` validates their scenario and ledger. There is no demo runtime mode or separate presentation database.

| Login                        | Role                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| hannah@birchbark.example     | Hannah, owner of Birchbark Pet Studio                                       |
| admin@birchbark.example      | Alex, administrator                                                         |
| diego@birchbark.example      | Diego, commissioned staff                                                   |
| priya@birchbark.example      | Priya, employee                                                             |
| owner@cedarcoast.example     | Rowan, owner of Cedar Coast Pet Care, a dog walker on a trial               |
| amrit@cedarcoast.example     | Amrit, dog walker paid commission                                           |
| tessa@cedarcoast.example     | Tessa, dog walker paid hourly                                               |
| leila@cedarcoast.example     | Leila, pet sitter paid commission                                           |
| owner@northlight.example     | Erik, owner of Northlight Security, a camera installer                      |
| office@northlight.example    | Naomi, office manager and administrator, not bookable                       |
| liam@northlight.example      | Liam, installer paid commission on labour                                   |
| ava@northlight.example       | Ava, installer paid hourly                                                  |
| owner@brightwater.example    | Leah, owner of Brightwater Home Cleaning, a house cleaner                   |
| joy@brightwater.example      | Joy, lead cleaner paid hourly                                               |
| harpreet@brightwater.example | Harpreet, cleaner paid hourly                                               |
| tomasz@brightwater.example   | Tomasz, cleaner paid commission on labour                                   |
| owner@ridgeline.example      | Jenna, owner and head coach of Ridgeline Strength Studio                    |
| mateo@ridgeline.example      | Mateo, personal trainer paid commission                                     |
| simran@ridgeline.example     | Simran, coach for mobility and Strong seniors, paid hourly                  |
| owner@lakeside.example       | Nadia, owner of Lakeside Learning Studio, tutoring and music lessons        |
| julien@lakeside.example      | Julien, English and French tutor paid commission                            |
| samuel@lakeside.example      | Samuel, science and SAT prep tutor paid hourly                              |
| sofia@lakeside.example       | Sofia, piano and guitar teacher paid commission                             |
| owner@maplemain.example      | Leila, owner and senior stylist of Maple and Main Hair Studio               |
| marcus@maplemain.example     | Marcus, senior stylist paid commission on services and retail               |
| tessa@maplemain.example      | Tessa, stylist paid commission on services and retail                       |
| gabriela@maplemain.example   | Gabriela, colourist paid commission on services and retail                  |
| amara@maplemain.example      | Amara, front desk coordinator and administrator, not bookable               |
| owner@fieldnote.example      | Amara, owner and lead photographer of Fieldnote Photography                 |
| julian@fieldnote.example     | Julian, associate photographer and second shooter paid commission           |
| ivy@fieldnote.example        | Ivy, studio manager and photo editor, administrator, not bookable           |
| owner@foothills.example      | Ravi, owner of Foothills Lawn and Garden, a lawn care crew                  |
| megan@foothills.example      | Megan, crew lead paid hourly                                                |
| tyler@foothills.example      | Tyler, seasonal crew paid hourly                                            |
| jonah@foothills.example      | Jonah, seasonal crew on the mowing route, paid hourly                       |
| owner@harbourside.example    | Leila, owner of Harbourside Massage and Wellness and an RMT                 |
| jun@harbourside.example      | Jun, registered massage therapist paid commission                           |
| wen@harbourside.example      | Wen, registered acupuncturist paid hourly                                   |
| teresa@harbourside.example   | Teresa, front desk administrator, not bookable                              |
| owner@inkwell.example        | Sasha, owner and tattoo artist of Inkwell Tattoo Collective                 |
| mei@inkwell.example          | Mei, fine-line and piercing artist paid commission                          |
| kieran@inkwell.example       | Kieran, traditional colour artist paid commission                           |
| harleen@inkwell.example      | Harleen, front desk coordinator and administrator, not bookable             |
| owner@clearcoat.example      | Mathieu, owner of Clearcoat Mobile Detailing, paint correction and coatings |
| daniela@clearcoat.example    | Daniela, detailer for paint correction and coatings, paid commission        |
| olivier@clearcoat.example    | Olivier, detailer and fleet lead, paid hourly                               |
| anh@clearcoat.example        | Anh, interior detailer, paid hourly                                         |
| owner@riverbend.example      | Linda, owner of Riverbend Driving School and an instructor                  |
| marcus@riverbend.example     | Marcus, instructor in an automatic, paid commission                         |
| jasmine@riverbend.example    | Jasmine, instructor in the school's manual car, paid hourly                 |
| arjun@riverbend.example      | Arjun, part-time instructor in an automatic, paid hourly                    |
| paul@riverbend.example       | Paul, office manager and administrator, not bookable                        |

The password is `demo1234`. The same logins work on staging, at `https://app.staging.clientbridge.ca` and in the staging mobile app, after the nightly seed ([operations.md](operations.md#stagings-demo-seed)). The scenario is anchored to the current Vancouver date: `seed_demo.build_demo(as_of)` builds the fixture graph, the seed modules enrich it, and it is validated before it is written. Birchbark is built by hand in `scripts/seed_demo.py` and the modules it calls. The other twelve businesses are built on the demo engine: `scripts/demo_engine.py` turns a business's spec (`scripts/demo_spec.py`: its people and hours, catalog, forms, contracts, pacing and storyline stages) into rows, and each business's module, such as `scripts/demo_northlight.py` or `scripts/demo_cedar.py`, holds its spec and storyline. Each business on the engine is listed in `DEMO_BUSINESSES` in `scripts/demo_context.py`, which `demo_validate`, `connect_links`, `stripe_setup`, `demo_snapshot` and the e2e web fixtures read; the engine validates the business's graph and checks that every storyline stage has its client and rows before anything is written. Assets in `backend/scripts/demo_assets/` upload to the configured bucket first. The seed creates (or finds) an auth identity for each demo user with that password and a verified email, so `make seed` needs the auth service running. Each run replaces every demo business and its rows, including those a core seed leaves out and any business no longer registered, and refuses when a seeded user also belongs to another business. It builds each business in its own process, then purges every demo business in a short transaction of its own (pausing the ledger's append-only trigger only where entries exist), and then writes, posts the ledger and validates each business in its own process, connection and transaction, largest first, with `--jobs` processes at a time (the CPU count, at most 8). If one business fails, the seed exits non-zero and names it, and that business is left empty while the others hold the new data, so rerun the seed. `--scratch URL` changes where the writes go: the seed creates and migrates that empty database, writes and validates every business there, and only then copies each one into the target in a transaction of its own, which purges the business and streams its rows table by table with binary `COPY`, parents first. Accounts arrive with their balances under the ledger's write mode (`clientbridge.ledger_write`), the entries' balance trigger is paused for that transaction, each journal's balance check runs before it ends, and the copy fails unless every account's balance equals the sum of its entries. The `payments.booking_id` cycle is filled in after bookings. The seed refuses to copy when scratch holds rows outside the demo businesses and their users. If any business fails in scratch, nothing is copied; if a copy fails, that business keeps its old rows. Staging's Job runs this way against a Postgres sidecar in its own pod (the Cloud SQL version, on loopback port 5433, trusting local logins), because each statement through the Cloud SQL proxy costs about 10 ms and the direct seed makes about 197k of them. A local run with 10.5 ms added to each round trip to the target made about 1,200 round trips and copied the 11 businesses in 67 seconds. Ledger rows are dated from the scenario's clock as they are written, and `python -m scripts.demo_fingerprint --compare URL URL` compares two seeded databases table by table, with the ledger's random ids replaced by their refs, to show a change to the seed left its rows unchanged. Auth identities are found by email or created, and the seed tags each one it creates or finds with `clientbridge_demo` in the identity's admin metadata. Only `make seed` against the dev `clientbridge` database and staging's seed Job pass `--prune-logins`, because test, scratch and other databases share the same auth service but hold only some of its users: with it, after the target's rows are in (after the copy, when `--scratch` is used), `scripts/demo_logins.py` deletes each tagged identity whose email the seed no longer writes and no user row references, first removing any empty user a sign-in with it provisioned, and prints the emails it deleted. The seed refuses the flag with `--core`, or when the target is anything but the environment's app database (`clientbridge` on dev, `staging_clientbridge` on staging) that `DATABASE_URL` also names. An identity without the tag is never deleted, whatever its domain, so one made before tagging existed has to be deleted by hand. Demo contacts use reserved addresses (`.example` and `.test` domains, and 555-0100 to 555-0199 phone numbers), and the delivery job marks any email or SMS to a reserved address `failed` with `reserved_address` instead of handing it to the provider, so the demo's reminders and notices never leave the app. Historical provider references are fixture data, not usable Stripe objects: the fixture account reads as fully onboarded so Getting paid agrees with the seeded payment history, but new card payments and onboarding need the sandbox link below or test-provider credentials as for any account; without them use cash or manual payments. `make seed` refuses anything but a local database with `ENV=dev`; staging's deploy runs the same seed against `staging_clientbridge` with `ENV=staging`, and production is always refused.

Stripe sandbox provisioning and demo-account linking are documented in
[Local sandbox setup](payments.md#local-sandbox-setup). That guide covers plan/apply, onboarding,
webhook listeners, fixture versus real provider references, and relinking after a demo reset.

Which signing secret each Stripe event uses, the pinned API version and the staging and live endpoints are in [Payments and Stripe](payments.md#staging-and-production-setup).

`uv run python -m scripts.payment_accounts` (needs `STRIPE_SECRET_KEY`, test mode) audits one connected account's display name, support email, business URL and statement descriptor through Accounts v2, writing missing fields only with `--apply`. Integration tests use normal dependency-injected recording adapters and per-test rollback; CI databases use the `clientbridge_test*` prefix.

### Demo businesses by vertical

There is one seeded demo business for each vertical the product serves, so a prospective customer sees their own trade and each trade can be tested from its own point of view. Provinces are mixed so the demos show GST, PST, QST, Manitoba's RST and HST. A marketing site trade page's demo link opens its business, and a vertical without a trade page is reached from the login table. Auto detailing is shown by Clearcoat Mobile Detailing, on the `vehicle` subject kind, and is the one business in Quebec, so it is the demo for GST with QST.

| Vertical                      | Business                         | Business page   | Subject kind | Province | Site trade page           |
| ----------------------------- | -------------------------------- | --------------- | ------------ | -------- | ------------------------- |
| Pet grooming and daycare      | Birchbark Pet Studio             | `birchbark.D`   | pet          | BC       | `/solutions/pet-grooming` |
| Dog walking and pet sitting   | Cedar Coast Pet Care             | `cedarcoast.D`  | pet          | BC       | none                      |
| Home services and trades      | Northlight Security              | `northlight.D`  | site         | BC       | `/solutions/trades`       |
| Home cleaning                 | Brightwater Home Cleaning        | `brightwater.D` | property     | AB       | `/solutions/cleaning`     |
| Hair and beauty salon         | Maple and Main Hair Studio       | `maplemain.D`   | none         | ON       | `/solutions/salons`       |
| Personal training and fitness | Ridgeline Strength Studio        | `ridgeline.D`   | none         | AB       | `/solutions/fitness`      |
| Tutoring and lessons          | Lakeside Learning Studio         | `lakeside.D`    | student      | ON       | `/solutions/tutoring`     |
| Massage and wellness          | Harbourside Massage and Wellness | `harbourside.D` | none         | BC       | `/solutions/wellness`     |
| Photography                   | Fieldnote Photography            | `fieldnote.D`   | none         | ON       | `/solutions/photography`  |
| Landscaping and lawn care     | Foothills Lawn and Garden        | `foothills.D`   | property     | AB       | none                      |
| Tattoo studio                 | Inkwell Tattoo Collective        | `inkwell.D`     | none         | BC       | none                      |
| Mobile car detailing          | Clearcoat Mobile Detailing       | `clearcoat.D`   | vehicle      | QC       | none                      |
| Driving school                | Riverbend Driving School         | `riverbend.D`   | student      | MB       | none                      |

### Birchbark Pet Studio walkthrough

Birchbark shows the `pet` subject kind for a grooming and daycare studio in Victoria, and it is the business the web, Connect and end-to-end fixtures use. It is built by hand rather than on the demo engine, so its ids carry no business prefix. Hannah and Diego groom from Tuesday to Saturday, Priya bathes and runs the front desk, and Alex is the administrator. New online clients wait for approval, and clients sign the grooming services agreement and waiver. Grooming and baths carry GST only, retail products GST and PST, and gift cards none.

| Stage                                                | Where to look                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| New clients booked online, waiting for approval      | Nadia (`bk_welcome_0`) and Tom (`bk_welcome_1`)                                                  |
| Intake form answered and agreement signed            | Amélie (`fr_intake_0`, `sig_0`); Fatima's is pending (`sig_pending`), Olivia's declined          |
| Regulars on repeating series                         | Bella (`sch_bella`), Rex (`sch_rex`), Miso (`sch_miso`) and eight more                           |
| Puppy class with deposits and a waitlist             | `sch_puppy`, deposits such as `pay_dep_bk_puppy_<date>_<n>`, Ada waitlisted (`bk_class_extra_3`) |
| Today's bath checked in, groomer off to a house call | Cooper (`bk_today_cooper`) and Miso (`bk_today_miso`, with the house-call note)                  |
| Paid by Tap to Pay with a tip                        | Willow (`bk_tap_willow`, `ord_tap`): a bath and treats, with Diego's tip                         |
| 5-bath pack for one pet                              | Rex (`pkg_marcus`), two baths used                                                               |
| Overdue invoices                                     | Marcus (`inv_1002`, `inv_1003`) and Liam (`inv_1005`)                                            |
| Refunds                                              | Olivia (`pay_refr`) and Noah's goodwill credit on a sale (`pay_demo_partial_refund`)             |
| No-show                                              | Grace (`bk_011`)                                                                                 |
| Daycare membership, paused and past due              | David (`sub_david`), Priscilla (`sub_priscilla`) and Ethan (`sub_pastdue`)                       |
| Estimates sent, accepted and declined                | Priscilla (`est_1001`), Liam (`est_1002`), Yuki (`est_1003`)                                     |
| Gift cards bought and used                           | Liam (`gc_liam`); David's card paid part of an invoice (`gc_used`)                               |
| Feedback and review requests                         | Amélie (`fr_satisfaction_0`) and Marcus (`fr_satisfaction_1`), with ten review requests          |
| Broadcasts                                           | `bro_deshed`, `bro_holiday` and `bro_winback`                                                    |
| Card chargeback waiting for a response               | `pay_1006`                                                                                       |

Cooper's bath with Priya is under way and checked in when the seed runs between about 9:00 and 16:30 Vancouver time from Tuesday to Saturday. Miso's house call starts within the hour, with Hannah or Diego on the way, when one of them is free then. At other times those two visits aren't seeded. A house call is an ordinary booking with a note giving the address, because a pet has no place of its own.

### Northlight Security walkthrough

Northlight shows the `site` subject kind end to end for a camera sales and installation business: a client books a survey on Connect, the owner quotes equipment and labour, the client accepts and signs, an installer runs the visit from the mobile app, and the handover form is signed on site. Products carry GST and PST and labour GST only. Each stage has a seeded client, with ids following `bk_nl_<key>`, `est_nl_<key>` and `cl_nl_<key>`:

| Stage                                          | Where to look                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| New lead, pending survey with a survey form    | Harper (`bk_nl_harper_survey`)                                                       |
| Estimate sent with optional lines              | Rajesh (`est_nl_rajesh`)                                                             |
| Accepted estimate ready for Book the install   | Ruth (`est_nl_ruth`)                                                                 |
| Install booked from its estimate, deposit paid | Claire (`bk_nl_claire`)                                                              |
| Add-on that lengthens the install              | Claire and Simon (`bk_nl_simon`): a second camera mount adds 30 min                  |
| Two-person install                             | Claire, with Ava helping; Harbourline Bikes (`bk_nl_harbourbikes`)                   |
| Today's installs, on site and on the way       | Owen (`bk_nl_owen`) and Mei Lin (`bk_nl_meilin`)                                     |
| Installed and paid by Tap to Pay               | Sarah (`bk_nl_sarah`): photos, handover form, equipment, plan, review                |
| Commercial client with two sites, overdue      | Island Storage (`cl_nl_islandstorage`)                                               |
| Unused part refunded after the install         | Nora (`inv_nl_nora`): one junction box with GST and PST                              |
| Five-star and four-star install feedback       | Sarah (`fr_nl_feedback_sarah`) and Marco on a visible cable (`fr_nl_feedback_marco`) |
| Warranty call on a camera nearing its end date | Fiona (`bk_nl_fiona_warranty`)                                                       |
| Declined estimate, cancelled survey            | Gordon (`est_nl_gordon`), Natalie (`bk_nl_natalie_survey`)                           |

Owen's and Mei Lin's installs show one installer on site and one on the way when the seed runs between about 9:00 and 12:15 Vancouver time on a working day; at other times they move to the next working day without those states.

The scenario works around what the product does not do yet. A two-day install is shown as separate bookings, and the handover form stands in for a checklist; there is no time tracking. On a two-person install the helper's calendar shows a block for the job, and Liam's share of the Harbourline Bikes labour is half the line at his own rate. Sarah's install is checked out on a Tap to Pay sale, which pays Liam his commission on the visit's line as an invoice would, and the payment reads as an ordinary card sale. The on-my-way text goes through the delivery job and does not appear in the inbox.

### Brightwater Home Cleaning walkthrough

Brightwater shows the `property` subject kind for a house cleaning business in Calgary, built on the demo engine in `scripts/demo_brightwater.py`. A new client books a first clean online and fills in the home details form, move-out and move-in cleans are quoted by estimate and held with a 25% deposit, regulars are on weekly or every-two-weeks series, and the three cleaners work from the mobile app with each home's entry, alarm and pet notes on its property. Alberta charges GST only, so cleans, add-ons and supplies carry 5% and gift cards none. Each stage has a seeded client, with ids following `bk_bw_<key>`, `est_bw_<key>` and `cl_bw_<key>`:

| Stage                                                  | Where to look                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| New lead, first clean waiting for approval             | Sofia (`bk_bw_sofia`): home details form, agreement not yet signed                       |
| Move-out quote sent with optional lines                | Daniel (`est_bw_daniel`): kitchen and bathroom photos on his home details                |
| Move-out quote accepted and booked, deposit paid       | Wei (`est_bw_wei`, `bk_bw_wei`), Harpreet with Tomasz as crew (`av_bw_crew_wei`)         |
| Regular every two weeks on a series                    | Margaret (`sch_bw_margaret`); Anjali (`sch_bw_anjali`) is weekly on Saturdays            |
| Today's cleans: checked in, on the way and later today | Linh (`bk_bw_linh`), Chidi (`bk_bw_chidi`) and Kateryna (`bk_bw_kateryna`)               |
| Cleaned and paid by Tap to Pay with a tip              | Amara (`bk_bw_amara`, `ord_bw_amara`)                                                    |
| Property manager with four units, one invoice overdue  | Prairie Lane (`cl_bw_prairielane`, `inv_bw_prairielane_sunnyside`)                       |
| Cancelled late, with a late cancellation fee           | Brandon (`bk_bw_brandon_late`, `inv_bw_brandon_late`)                                    |
| Five-star feedback and a review request                | Fatima (`fr_bw_feedback_fatima`)                                                         |
| Three-star feedback about a missed spot, re-clean done | Kevin (`fr_bw_feedback_kevin`, `bk_bw_kevin_reclean`) and the owner's reply in the inbox |
| Gift card bought for a mother's clean                  | Jasmine (`gc_bw_mom`) and her mother Teresita (`bk_bw_teresita_gift`)                    |

Add-ons lengthen the clean they ride on: inside the oven by 45 minutes, the fridge by 30, windows by 60 and each load of laundry by 20. Wei's move-out has Tomasz as crew alongside Harpreet, blocked on his calendar for the whole job. Rachel's deep clean (`bk_bw_rachel`) has a partial refund for an add-on that wasn't done, and `bk_bw_home_20_lockout` is a no-show where the cleaner couldn't get in. The three cleans today show Joy checked in, Harpreet on the way and Tomasz later in the day when the seed runs between about 9:00 and 12:30 Calgary time on a weekday; at other times they move to the next working day without those states.

The scenario works around what the product does not do yet. There is no late cancellation fee in the product: the cancellation cutoff only limits online changes, so Brandon's fee is an invoice line added by hand, and the lockout is a no-show with no fee. Ratings come from the Clean feedback form; the product records review requests but not the reviews themselves, so the owner's reply to Kevin is an email. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems it on its own: Teresita's clean is booked at no charge and the card is redeemed for its price with GST. Amara's clean is checked out on a Tap to Pay sale, which pays Joy for the clean as an invoice would, and the tip is recorded on the payment. Entry, alarm and pet notes are free text on the property, visible to every team member.

### Ridgeline Strength Studio walkthrough

Ridgeline shows a training studio in Edmonton with no subject kind: a new client books a free intro on Connect and fills in the PAR-Q and waiver, then trains one to one, buys a 10-session pack, or joins a monthly class membership and books small group classes from a weekly timetable of eleven sessions. Alberta charges GST only, so every line carries GST except gift cards. Members book classes at no charge, drop-ins are invoiced per class, and Strong seniors, which only Simran teaches, has regulars on a 10-class pass. Classes run in the Studio and bootcamp on the Turf, both set up as rooms and equipment, so two studio classes can't overlap. Mateo runs Strength foundations, a six-week program on Thursday evenings that a student joins as a whole: enrolling books all six evenings, takes a $50 deposit and issues the invoice, due on the first evening. Each stage has a seeded client, with ids following `bk_rl_<key>`, `sub_rl_<plan>_<key>` and `cl_rl_<key>`:

| Stage                                                         | Where to look                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| New lead, free intro booked online with a PAR-Q               | Hailey (`bk_rl_hailey_intro`, pending approval; waiver still unsigned)          |
| Member on the unlimited plan                                  | Ben (`sub_rl_unlimited_ben`)                                                    |
| Member whose card failed, past due                            | Kyle (`sub_rl_eight_kyle`), with the text about the declined card               |
| Halfway through a 10-session pack                             | Grace (`pkg_rl_pt10_grace`): five used, the sixth booked (`bk_rl_grace_pack_5`) |
| Full class, waitlist seat given after a cancellation          | `ses_rl_full_class`: Lucy cancelled, Farah got the seat, Devon still waits      |
| Today's training and class with check-ins                     | Omar (`bk_rl_omar_today`), `ses_rl_today_class`, Linh later today               |
| Cancelled membership                                          | Carmen (`sub_rl_unlimited_carmen`), moving to Calgary                           |
| Strong seniors on a 10-class pass                             | Elaine (`pkg_rl_seniors_elaine`)                                                |
| Six-week program halfway through, deposits paid               | Jake (`sch_rl_foundations`, `bk_rl_foundations_jake_0`)                         |
| Program balance overdue after its first evening               | Isaac (`inv_rl_foundations_isaac`)                                              |
| Next program enrolling, invoiced and due on its first evening | Brianna (`sch_rl_foundations_next`, `inv_rl_foundations_next_brianna`)          |
| Five-star and four-star feedback                              | Walter (`fr_rl_feedback_walter`), Anita on parking (`fr_rl_feedback_anita`)     |
| Paid by Tap to Pay with a retail add-on                       | Jordan (`ord_rl_jordan`): a session and a set of bands                          |

The scenario works around what the product does not do yet. The product stores no star reviews, so session feedback is a form with a rating field, and the owner's reply to Anita is an email in her thread. A membership's eight classes a month and its 10% retail discount are shown on the plan but not enforced: members' class bookings are priced at zero by hand and the seed keeps 8-class members to eight. A membership cannot be paused from the app, so the stage shows a cancellation. A failed renewal leaves no failed payment row, only the past due plan. Omar's session and today's class are in progress only when the seed runs inside a coach's hours; at other times they move to the next working day without check-ins.

### Lakeside Learning Studio walkthrough

Lakeside shows the `student` subject kind for a tutoring and music lessons studio in Ottawa. Parents are the clients and their children are the students, each with a grade, school, birthday and allergies where they have one, and lesson notes on the student. A new family books an assessment online and fills in the registration form, students then come at the same time each week through a ten-week term as a series, and families pay per lesson, up front for a term package, or monthly on a plan. Piano lessons need the Piano room, which the studio sets up as a room. Curriculum tutoring and music lessons are exempt from HST, while SAT prep and books and supplies carry HST at 13%. Ids follow `cl_ls_<family>`, `sj_ls_<family>` for the first child and `sch_ls_<key>` for a weekly series, whose visits are `bk_ls_<key>_<n>`:

| Stage                                                     | Where to look                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New family booked an assessment, registration submitted   | Amara Nwosu (`bk_ls_nwosu_assessment`, waiting for approval; policies not yet signed)                                                                                                                 |
| Two children on different weekly series, sibling discount | Thu Tran (`sch_ls_tran_minh`, `sch_ls_tran_an`, 10% off An's invoices)                                                                                                                                |
| Partway through a 10-lesson term package                  | Isabelle Fontaine (`pkg_ls_term10_fontaine`, `sch_ls_fontaine`)                                                                                                                                       |
| A term package for each child and one to share            | Chen (`pkg_ls_term10fr_chen_olivia`, `pkg_ls_term12_chen_ethan`, `pkg_ls_term12_chen_shared`)                                                                                                         |
| Missed lesson, rescheduled as a make-up                   | Yusuf Ahmed (cancelled `bk_ls_ahmed_5`, make-up `bk_ls_ahmed_makeup`, text thread)                                                                                                                    |
| SAT prep class nearly full                                | Marta Kowalski (`ses_ls_sat_3`, seven of eight seats, each on a course package)                                                                                                                       |
| Exam review class full, with a waitlist                   | Marc Leblanc (`bk_ls_review_next_leblanc` on `ses_ls_review_next`)                                                                                                                                    |
| Coding camp week with siblings, pickups and deposits      | `sch_ls_coding_camp`: Monday to Friday next week, nine students, each with a $100 deposit paid, Monday one seat short of full, Thu Tran's two children, Lucas Wong and Nora Murphy away two days each |
| Today's lessons for each tutor                            | The calendar today: two to three lessons each from `sch_ls_dhillon`, `sch_ls_gagne`, `sch_ls_rahimi`, `sch_ls_li` and others                                                                          |
| Monthly plan paid by pre-authorized debit                 | Yaw Mensah (`sub_ls_plan_mensah`, bank account `pm_ls_mensah`, signed plan agreement)                                                                                                                 |
| Five-star feedback from a parent                          | Laura Bianchi (`fr_ls_feedback_bianchi`), with a review request and a thank-you thread                                                                                                                |
| Term-end thread and next term registration                | Nadège Desrosiers (`th_ls_desrosiers_email`, `fr_ls_reregister_desrosiers`)                                                                                                                           |
| Overdue invoice, no-show, three-star feedback             | Brendan Sullivan (`inv_ls_sullivan_overdue`), Daniel Park (`bk_ls_park_extra`), Navdeep Gill (`fr_ls_feedback_gill`, owner reply by email)                                                            |
| Paid by Tap to Pay with a book                            | Jun Li (`ord_ls_li_book`)                                                                                                                                                                             |

Weekly series are placed by working day from the seed date, so today's lessons always fall on the day the seed runs, or on Monday when it runs on a Sunday. At the frozen test time they are all still ahead, in the afternoon; lessons that have begun when the seed runs are checked in, so a seed from about 15:30 Ottawa time shows check-ins, and one in the evening finds them completed. The scenario works around what the product does not do yet. Reviews are stored only as review requests, so ratings live in a feedback form and the owner's reply is an email. A plan's lessons are booked at no charge with a note, because a subscription does not cover bookings the way a package does. The sibling discount is a 10% discount on each invoice rather than a rule. Clients cannot buy packages or gift cards online, so the studio sells them in person, and Ontario's point-of-sale rebate on printed books is not modelled, so the workbooks carry the full 13% HST. A registration form is answered once per family for the first child, and each student's learning needs are a note on the student. The coding camp is a program: Samuel teaches it from 9 to 3 on date hours added for that week, each student holds a booking per day with the price on Monday's, and each enrolment takes a $100 deposit and is invoiced when it is made, with the deposit taken off and the rest due on the camp's first day.

### Maple and Main Hair Studio walkthrough

Maple and Main is a four-chair salon on the Danforth in Toronto with no subject kind: the client is the only thing booked. Leila (the owner) and Marcus are senior stylists, Tessa is a stylist with a lower price for the same cut, Gabriela is the colourist, and Amara runs the front desk. Everything carries Ontario's 13% HST except gift cards. The book covers 30 weeks of history and 5 weeks ahead, visits are paid at the desk with tips on most card payments, partial highlights, full highlights and balayage take a deposit, and the three stylists earn commission on services and retail. Each stage has a seeded client, with ids following `bk_mm_<key>` and `cl_mm_<key>`:

| Stage                                                  | Where to look                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| First-time client with the consultation form submitted | Farah (`bk_mm_farah_consult`, `fr_mm_consult_farah`): pending online booking, photos         |
| Regular rebooked every six weeks with a series         | Grace (`sch_mm_grace`): root colour with Gabriela, colour formula in her notes               |
| Colour formula noted on each visit                     | Grace (`fr_mm_formula_grace_0` to `_4`); Natasha's came out warmer (`fr_mm_formula_natasha`) |
| Today's book, with a balayage in progress              | Olivia (`bk_mm_olivia`) and every stylist's `bk_mm_today_<member>_<n>`                       |
| No-show with a forfeited deposit                       | Tamara (`bk_mm_tamara`), rebooked as `bk_mm_tamara_rebook`                                   |
| Visit invoice overdue                                  | Roya (`bk_mm_roya_highlights`, `inv_mm_roya_highlights`)                                     |
| Bridal party booked after the trial                    | Sofia (`bk_mm_sofia_trial`, `bk_mm_sofia_bride`, `bk_mm_sofia_party_<n>`)                    |
| Retail sold at checkout with a cut                     | Elena (`bk_mm_elena`, `ord_mm_elena`)                                                        |
| Gift card bought and redeemed                          | David (`gc_mm_david`) and Priyanka (`bk_mm_priyanka_gift`)                                   |
| Three-blowout package, two used                        | Chloé (`pkg_mm_blowouts_chloe`)                                                              |
| Five-star and four-star feedback                       | Amira (`fr_mm_feedback_amira`) and Robert (`fr_mm_feedback_robert`), with a reply            |

Today's book shows Olivia's balayage in progress, with morning visits paid and the rest of the day ahead, when the seed runs from about 75 minutes after Gabriela starts until three and a half hours before she finishes, on a day all four stylists work (11:15 to 15:45 Toronto time on a Tuesday or Friday). At other times the same book moves to the next day all four work, without those states.

The scenario works around what the product does not do yet. A price can't vary by stylist, so the two cut prices are two services, each offered only by its own stylists: the senior cut by Leila and Marcus and the stylist cut by Tessa. A visit holds the chair for its whole length, with no processing time in which the stylist can take another client, and one booking carries one service, so a cut and colour would be two bookings. Elena's cut and the other desk checkouts go through a sale, which pays the stylist's service commission on the visit and retail commission on the products; the other visits are invoiced, which pays service commission and no retail commission. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Priyanka's on its own, so her visit is booked at no charge with a note and Marcus earns no commission on it. Star ratings live with external reviews, so the feedback form's rating field stands in for them, and Leila's reply is an email. Gabriela records each colour visit in the Colour formula form, a treatment note on the visit (`fr_mm_formula_<key>`) that only she and the managers can read; Grace's and Olivia's standing formulas also stay in their client notes. The front desk is paid outside the app, and the brand has no cover photo because it takes a URL rather than an uploaded file.

### Fieldnote Photography walkthrough

Fieldnote shows a portrait and wedding studio in Hamilton with no subject kind. A couple asks for a quote, the owner sends an estimate with optional lines, and the couple accepts, signs the wedding agreement and pays a 30% retainer. The wedding is booked for Amara, the only photographer who offers weddings, with Julian on it as crew, the planning form collects the timeline, venues, must-have shots and family list, and the balance is invoiced after the wedding, before the full gallery is delivered. Families book sessions with a $100 deposit, mini-session days are classes of twelve 20-minute slots, and prints are sold at an ordering appointment by Tap to Pay. Ontario charges HST at 13% on every line except gift cards. Each stage has a seeded client, with ids following `bk_fn_<key>`, `est_fn_<key>`, `inv_fn_<key>` and `cl_fn_<key>`:

| Stage                                               | Where to look                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Wedding inquiry with an estimate sent               | Olivia (`est_fn_olivia`, optional lines; agreement unsigned, `sig_fn_olivia`)   |
| Estimate accepted, agreement signed, retainer paid  | Sanjay (`bk_fn_sanjay`, `sig_fn_sanjay`, planning form `fr_fn_planning_sanjay`) |
| Wedding done, balance invoiced before delivery      | Emma (`inv_fn_emma`), open and due within two weeks                             |
| Balance invoice overdue, partly paid                | Kristen (`inv_fn_kristen`), with the payment plan agreed by email               |
| No-show who forfeited the deposit                   | Ryan (`bk_fn_ryan_noshow`)                                                      |
| Past wedding fully paid, with a five-star review    | Aaliyah (`inv_fn_aaliyah`, `fr_fn_feedback_aaliyah`)                            |
| Headshot session today                              | James (`bk_fn_james_today`), with his questionnaire                             |
| Headshot session under way, checked in              | Hyun-woo (`bk_fn_hyunwoo_today`)                                                |
| Family mini-session day, most slots booked          | `ses_fn_fall_mini_00` to `_11`: ten booked, two open; Chloé has the first       |
| Newborn session booked around the due date          | Fatima (`bk_fn_fatima_newborn`), a placeholder date to be moved after the birth |
| Print order sold at the ordering appointment        | Wei Ling (`bk_fn_wei_ordering`, `ord_fn_wei`): prints, a canvas and a USB       |
| Four-star review about delivery time, with a reply  | Rohan (`fr_fn_feedback_rohan`, `th_fn_rohan_email`)                             |
| Team headshots on a 5-session package               | Barton & Hess (`pkg_fn_team_bartonhess`): three used, one booked                |
| Corporate event paid, and a declined event estimate | Ferrovia (`bk_fn_ferrovia`), Corktown Design (`est_fn_corktown`)                |

As crew, Julian's calendar is blocked for the wedding's whole window, and the coverage line is split evenly between Amara and him, so he earns his 40% on half of it; the second-shooter line on the balance invoice is a charge with no member. Hyun-woo's headshot is under way and checked in when the seed runs inside Amara's or Julian's hours, and Ryan didn't come to his family session and forfeited the $100 deposit.

The scenario works around what the product does not do yet. A booking has no place, so the venue addresses live in the planning form and a client note. A booking can't be marked as date to be confirmed, so the newborn session holds a placeholder date with a note. Multi-day events would need one booking per day, travel fees would be a manual line, and there is no gallery or photo delivery: the sneak peek and gallery are mentioned in messages and invoice notes only. The retainer is 30% of the coverage item, not of the whole estimate, because a deposit is set per item. There are no star reviews, so feedback is a form with a rating field and the reply to Rohan is an email. James's session is later today only when the seed runs inside Amara's hours; at other times it moves to her next working day.

### Foothills Lawn and Garden walkthrough

Foothills shows the `property` subject kind for a seasonal lawn and landscaping business in Calgary. Each client's yard holds its address, gate code and sprinkler notes in access and its dogs in pets, with the lot size and sprinklers as extra attributes. Jonah runs the weekly and every-two-weeks mowing series from May to the end of October, Megan and Tyler do cleanups, hedges, beds and projects, and Ravi quotes projects and clears snow in winter. Everything carries GST only, as in Alberta. The history runs from February, when only snow clearing is booked, through a busy summer to fall cleanups in October and November. Each stage has a seeded client, with ids following `bk_fh_<key>`, `est_fh_<key>`, `sch_fh_<key>` and `cl_fh_<key>`:

| Stage                                               | Where to look                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Weekly mowing series that ends with the season      | Helen (`sch_fh_helen`), with her fall cleanup booked after the final cut                |
| Fall cleanup quotes sent, one accepted and booked   | Lucy (`est_fh_lucy`) and Kwame (`est_fh_kwame`); Amir (`est_fh_amir`, `bk_fh_amir`)     |
| Project accepted, deposit paid, done with photos    | Mariana (`bk_fh_mariana`): before, progress and after photos, signed sign-off           |
| Project accepted and booked, deposit paid           | Graham (`est_fh_graham`, `bk_fh_graham`)                                                |
| Sod estimate sent with optional lines               | Farah (`est_fh_farah`), with the project agreement waiting to be signed                 |
| Today's route: on site, on the way, later today     | Megan at Bernadette's (`bk_fh_bernadette`), Tyler on the way to Chloe's (`bk_fh_chloe`) |
| Snow plan sign-ups for the winter                   | Linda (`sub_fh_snow_linda`), Patrick and Adebayo; last winter's plans renewed           |
| Condo board on a weekly series, one invoice overdue | Silver Ridge Court (`sch_fh_silverridge`, `inv_fh_silverridge_hedges`)                  |
| Rain-delayed visit moved to the next dry day        | Nina (`bk_fh_nina`): note, text thread and a reschedule audit                           |
| No-show for a consultation, rebooked                | Ian (`bk_fh_home_23_missed`), rebooked as `bk_fh_home_23_consult`, with the text thread |
| Five-star feedback and a review request             | Harjit (`fr_fh_feedback_harjit`)                                                        |
| Three-star feedback about a gate left open          | Carol (`fr_fh_feedback_carol`), the owner's reply and a note on her yard                |
| Hedge trim paid by Tap to Pay                       | Marco (`ord_fh_marco`)                                                                  |
| Declined retaining wall estimate                    | Doug (`est_fh_doug`)                                                                    |

Megan's projects and Amir's fall cleanup have a second crew member, Tyler in season and Ravi while the crew is laid off, whose calendar is blocked for the visit (`av_fh_crew_<key>`); the spring cleanups get one where someone is free. Megan and Tyler show the on-site and on-the-way states when the seed runs between about 8:00 and 14:30 Calgary time on a weekday; at other times the route moves to the next working day without those states. The mowing series run from the first week of May to October 31 of the latest season to have started, and the seasonal crew is laid off from November to May, when Ravi takes Tyler's place on the route. The storyline is written for mid-October; seeded at another time of year it still builds and validates, but stages such as the fall quotes and the final cut no longer match the date.

The scenario works around what the product does not do yet. There is no route order or travel time beyond the buffer after each visit. Nothing in scheduling knows about weather: the rain delay is an ordinary reschedule, and snow visits are booked by hand after each snowfall rather than triggered by it. The snow plan is a yearly subscription that bills the season in October; the visits it covers are separate bookings at no charge, and nothing counts or limits them. The property kind has no lot size or sprinkler fields, so those sit in the yard's attributes, where the app doesn't show them, and in its access notes. Materials sold by the cubic yard use whole units, mowing series bill one invoice per visit rather than a monthly statement, and the seasonal crew's layoff is a long time-off entry. The portrait check in `demo_validate` counts only payments made on an invoice, not an applied deposit, so Mariana, whose project invoice is settled by her deposit and an e-Transfer, has no portrait.

### Harbourside Massage and Wellness walkthrough

Harbourside shows a massage therapy and acupuncture clinic in Vancouver with no subject kind. A new client books online, gets the health history form the clinic sends with a first booking, signs the cancellation policy, and sees one of two registered massage therapists or the acupuncturist. Massage therapy carries GST only: it isn't on the federal list of GST-exempt health services, and BC charges no PST on it. Acupuncture by a registered acupuncturist is GST-exempt, gift cards carry no tax when sold, the massage oil carries GST and PST, and the herbal heat compress carries GST only because BC exempts hot and cold packs from PST. Acupuncture is booked only with Wen and massage only with Leila or Jun. Every treatment takes one of Rooms 1 to 3, and the couples massage takes the two tables in the couples room, "Couples room, table 1" and "table 2", so a second couples booking at the same time is refused. Each practitioner's title carries their credential and registration number, such as Leila's "Owner · RMT · Reg. 10482", and the visit's receipt prints it for extended health claims, so invoice notes name only the service. Each stage has a seeded client, with ids following `bk_hs_<key>`, `pkg_hs_<pack>_<key>` and `cl_hs_<key>`:

| Stage                                                | Where to look                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| New client, health history in before the first visit | Ananya (`bk_hs_ananya_first`, `fr_hs_intake_ananya`); Chloe's form is still unanswered                                  |
| Regular partway through a 10-pack                    | Kenji (`pkg_hs_pack10_kenji`): six used, the seventh booked (`bk_hs_kenji_6`)                                           |
| Today's treatments, one checked in                   | Sofia with Leila (`bk_hs_sofia_today`), Ethan with Jun, Rosa with Wen                                                   |
| Late cancellation inside 24 hours, fee charged       | Brendan (`bk_hs_brendan_late`, `inv_hs_brendan_late`), rebooked for next week                                           |
| Missed visit, fee invoice overdue                    | Tyler (`bk_hs_tyler_missed`, `inv_hs_tyler_missed`)                                                                     |
| December gift card, redeemed in the new year         | Margaret bought `gc_hs_lucas`; Lucas used it (`bk_hs_lucas_gift`)                                                       |
| Couples massage with both therapists                 | Leah and Aaron (`bk_hs_couples_leah`, `bk_hs_couples_aaron`), and last Valentine's                                      |
| Weekly acupuncture series                            | Harjit (`sch_hs_harjit`), after his initial visit (`bk_hs_harjit_initial`)                                              |
| Treatment notes on visits, one amended               | Fatemeh (`fr_hs_soap_fatemeh`), Hiroshi (`fr_hs_soap_hiroshi`, `fr_hs_soap_hiroshi_amended`) and Raj (`fr_hs_soap_raj`) |
| Visit receipt with the practitioner's registration   | Hiroshi's massage with Jun (`inv_hs_hiroshi_recent`)                                                                    |
| Five-star and four-star feedback                     | Fatemeh (`fr_hs_feedback_fatemeh`), Gwen on the cold room (`fr_hs_feedback_gwen`)                                       |

The scenario works around what the product does not do yet. A booking has one practitioner, so a couples massage is two bookings at the same time that the front desk makes. A visit paid by invoice or sale has a receipt that prints the practitioner's title with their registration, but a package's visits have no receipt of their own, and nothing bills insurers directly. A late cancellation doesn't charge a fee by itself (a deposit is kept only on a no-show), so Brendan's fee is its own invoice. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Lucas's on its own, so his visit has no invoice and the redemption isn't linked to it. Practitioners earn on paid invoices and sales, so package and gift card visits, which have neither, pay them nothing. The product stores no star reviews, so feedback is a form with a rating field, and Leila's reply to Gwen is an email in her thread. Sofia is checked in only when the seed runs inside Leila's hours; otherwise whoever is working has the checked-in client, and outside everyone's hours the three visits move to the next working day without one. The brand has no cover photo, because a cover is a URL and the demo's images aren't served from a fixed address.

### Inkwell Tattoo Collective walkthrough

Inkwell is a three-artist tattoo studio on Main Street in Vancouver with no subject kind: the client is the only thing booked. Sasha (the owner) does large custom work and sleeves, Mei does fine-line pieces and is the only one who pierces, Kieran works in traditional colour, and Harleen runs the front desk and the inbox. Custom work starts with a free consultation and a design brief; custom sessions of two, four and six hours take a $100, $150 or $200 non-refundable deposit at booking, which comes off the final session, and most card payments carry a tip for the artist. Tattooing and piercing are personal services, which BC's PST doesn't apply to (PST Bulletin 138), so services carry GST only. The aftercare balm and wash carry GST and PST, the healing film is treated as a dressing under the PST exemption for first-aid supplies and carries GST only, and gift cards carry no tax. The book covers 30 weeks of history and 5 weeks ahead, with a quieter July and August because a new tattoo has to stay out of the sun and water. Each stage has a seeded client, with ids following `bk_iw_<key>` and `cl_iw_<key>`:

| Stage                                                           | Where to look                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| New client after a consultation, design brief and references in | Noor (`bk_iw_noor_consult`, `fr_iw_brief_noor`): two reference images, consult note                                        |
| Custom piece booked, deposit paid                               | Tomás (`bk_iw_tomas`): moved once by text, consent form waiting                                                            |
| No-show who forfeited the deposit                               | Brady (`bk_iw_brady`)                                                                                                      |
| Balance left to pay after the session, overdue                  | Mateo (`bk_iw_mateo_balance`, `inv_iw_mateo_balance`)                                                                      |
| Sleeve partway through its sessions                             | Anika (`sch_iw_anika`): three of six full days done, deposit held on the last, project agreement, progress photo           |
| Today's sessions, one checked in                                | Kenji (`bk_iw_kenji`) and each artist's `bk_iw_today_<artist>_<n>`                                                         |
| Flash day with short walk-in slots                              | Jordan (`bk_iw_flashday_jordan`) and `bk_iw_flashday_<artist>_<n>`, three weeks back, with the broadcast that announced it |
| Aftercare sold with the session                                 | Lucía (`bk_iw_lucia`, `inv_iw_lucia`): balm, wash and film on the session invoice, with a tip                              |
| Free touch-up booked                                            | Hana (`bk_iw_hana_touchup`), seven weeks after her session (`bk_iw_hana`)                                                  |
| Five-star and four-star feedback                                | Oluwaseun (`fr_iw_feedback_olu`) and Graham (`fr_iw_feedback_graham`, about the wait), with Sasha's reply                  |

Kenji's four-hour session is under way, checked in 75 minutes ago, when the seed runs between about 12:15 and 15:45 Vancouver time on a day Kieran, Sasha or Mei works and is free then; the earlier sessions that day are paid and the later ones are ahead. At other times the same book moves to the next day at least two artists work, without those states. The rest of the history includes a gift card bought and redeemed (`gc_iw_amelia`, `bk_iw_ronan_gift`), a refunded healing film (`bk_iw_cole_flash`), piercings every week, consent forms signed before every tattoo and piercing of the last ten weeks, and aftercare acknowledgements after the custom sessions.

The scenario works around what the product does not do yet. A deposit belongs to one booking, so a sleeve's deposit is taken on its last session and the earlier sessions show none. A price can't vary with the time a session actually takes, so the three session lengths are three services, and a session that runs short or long keeps its booked price. Nothing checks the three-month window for a free touch-up: the touch-up is booked at no charge by hand. The consent form records the photo ID and date of birth, but nothing enforces the age of 18. A flash day has no walk-in queue or open slots to publish, so the desk books each walk-in as it arrives. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Ronan's on its own, so his piece is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and Sasha's reply is an email. Artists who rent a chair rather than take commission can't be set up, and the front desk is paid outside the app. The brand has no cover photo because it takes a URL rather than an uploaded file.

### Cedar Coast Pet Care walkthrough

Cedar Coast shows the `pet` subject kind for a dog walking and pet sitting team in downtown Vancouver: a new client books a free meet and greet on Connect with no approval step (on purpose, so one demo shows booking without approval), fills in the intake form and signs the key holding agreement, and then walks solo, joins group walks, buys a 10-walk pack or the monthly walking plan, or books Leila, the only sitter who takes them, for overnight stays. Services carry GST only and shop products GST and PST. Regular walks are invoiced weekly, and the business stays on a 14-day trial so the plan page shows that state. Each stage has a seeded client, with ids following `bk_cc_<key>`, `cl_cc_<key>` and `sch_cc_<key>`:

| Stage                                                  | Where to look                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| New client's meet and greet booked online, intake sent | Daniel (`bk_cc_daniel_meet`, `fr_cc_meet_daniel`)                  |
| Regular on a weekday walk series, invoiced weekly      | Morgan (`sch_cc_morgan`)                                           |
| Partway through a 10-walk pack for one dog             | Wen (`pkg_cc_ten_wen`), for Mochi                                  |
| Today's walks, checked in and on the way               | Sanjay (`bk_cc_sanjay_today`) and Chloé (`bk_cc_chloe_today`)      |
| Overnight stay this weekend, deposit paid              | Nasrin (`bk_cc_nasrin_stay`)                                       |
| Holiday sitting request, quote sent                    | Ben (`est_cc_ben_holiday`)                                         |
| Cat drop-ins while the owner is away                   | Aiko (`bk_cc_aiko_trip_0`)                                         |
| Late cancellation, half the walk charged               | Ryan (`bk_cc_ryan_late`, `inv_cc_ryan_late`)                       |
| Missed walk charged in full, invoice overdue           | Derek (`bk_cc_derek_missed`, `inv_cc_derek_missed`)                |
| Five-star and four-star feedback, with a reply         | Isabel (`fr_cc_feedback_isabel`), Callum (`fr_cc_feedback_callum`) |
| Monthly walking plan and puppy visits                  | Elena (`sub_cc_plan_elena`), Simran (`sch_cc_simran`)              |
| Group walk full, with a dog on the waitlist            | Natasha (`bk_cc_tasha_wait`)                                       |
| Walk and collar light paid by Tap to Pay               | Hugo (`ord_cc_hugo`)                                               |
| Stay cut short, one night refunded                     | María José (`bk_cc_maria_stay`)                                    |

The scenario works around what the product does not do yet. A booking can't cross midnight inside a member's hours, so Leila has no hours from Friday to Sunday and every stay starts on one of those evenings; it is one long booking priced per night, and she takes no other visits while it runs. Home access lives in a pinned client note and the intake answers, since pet subjects have no access field. There is no late-cancellation fee, so Ryan's fee is a separate invoice line, and Derek's missed walk is invoiced by hand and left overdue. Reviews are the feedback form's rating and comments plus review requests, because the product stores no star reviews or public replies; Callum's reply is a text message. Plan walks are booked at no charge alongside the monthly subscription, and package and plan walks earn the walker nothing. Today's walks show one walker checked in and one on the way when the seed runs during working hours on a weekday; at other times they move to the next working day without those states.

### Clearcoat Mobile Detailing walkthrough

Clearcoat shows the `vehicle` subject kind for a mobile car detailer in Montreal, built on the demo engine in `scripts/demo_clearcoat.py`. Each vehicle holds its year, make, model, colour, plate, size and the address where it's parked, with parking notes such as a garage level and visitor fob. A new client books a wash or detail online and fills in the vehicle details form, paint correction and ceramic coatings are quoted from photos and held with a deposit, and the four detailers work from the mobile app, filling in a signed walkaround form before larger jobs. Paint correction and coatings are offered only by Mathieu and Daniela. Quebec charges GST at 5% and QST at 9.975%, so every service, add-on and product carries both, and gift cards carry neither. Each stage has a seeded client, with ids following `bk_ct_<key>`, `est_ct_<key>` and `cl_ct_<key>`:

| Stage                                                         | Where to look                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| New client booked online, waiting for approval                | Émilie (`bk_ct_emilie`): pet hair add-on, vehicle form with a photo, agreement not yet signed    |
| Ceramic coating quote sent with optional lines                | Raj (`est_ct_raj`): paint photo on his vehicle form, correction and engine bay optional          |
| Paint correction accepted and booked, deposit paid            | Nadia (`est_ct_nadia`, `bk_ct_nadia`), with the engine bay add-on, in her condo garage           |
| Today's visits: checked in, on the way and later today        | Julie (`bk_ct_julie`), Thomas (`bk_ct_thomas`) and Samira (`bk_ct_samira`)                       |
| Monthly wash club member                                      | Marie-Claude (`sub_ct_club_marieclaude`); Jean-François (`sub_ct_club_jf`) joined two months ago |
| Three-wash pack for one of two cars                           | David (`pkg_ct_three_david`): the Forester's pack, two used; Rachel's Mazda paid per visit       |
| Fleet visit with a crew of two, one invoice overdue           | Plomberie Rosemont (`cl_ct_rosemont`, `av_ct_crew_rosemont_3`, `inv_ct_rosemont_3`)              |
| Walkaround signed, detailed and paid by Tap to Pay with a tip | Lucas (`fr_ct_walkaround_lucas`, `ord_ct_lucas`): a full detail and a spray detailer             |
| Cancelled late, with a late cancellation fee                  | Jason (`bk_ct_jason_late`, `inv_ct_jason_late`)                                                  |
| Rain day, wash moved to the next dry day                      | Isabelle (`bk_ct_isabelle`): note, text thread and a reschedule audit                            |
| Odour treatment refunded                                      | Simon (`inv_ct_simon`), with the owner's email about the headliner                               |
| Five-star feedback and a review request                       | Fatou (`fr_ct_feedback_fatou`)                                                                   |
| Four-star feedback about a late arrival                       | Mei (`fr_ct_feedback_mei`), with the owner's reply                                               |
| Gift card bought for a father's detail                        | Sophie (`gc_ct_dad`) and her father Gilles (`bk_ct_gilles_gift`)                                 |

Add-ons lengthen the visit they ride on: pet hair removal and the large vehicle charge by 30 minutes, the engine bay and headlight restoration by 45, and the odour treatment by an hour. Each detailer has 30 minutes after a visit to drive to the next one. Plomberie Rosemont's four vans are washed once a month by Olivier with Anh as crew, blocked on Anh's calendar for the whole visit, and the invoice is due in 14 days. `bk_ct_car_21_missed` is a no-show where the car wasn't parked where the client said. Julie's interior detail is checked in, Olivier is on the way to Thomas and Samira's wash is later in the day when the seed runs between about 9:00 and 13:00 Montreal time from Tuesday to Friday; at other times the three visits move to the next working day without those states, and Julie's walkaround isn't seeded.

The scenario works around what the product does not do yet. A booking holds one vehicle, so a fleet visit is booked on Rosemont's first van and names all four in its note. A price can't vary with the vehicle's size, so the large vehicle charge is an add-on the client or detailer picks. Nothing in scheduling knows about weather: the rain day is an ordinary reschedule. Wash club washes are booked at no charge alongside the monthly subscription, nothing counts them against the plan's one wash a month, and they earn the detailer nothing. There is no late cancellation fee in the product, so Jason's fee is an invoice line added by hand. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Gilles's on its own, so his detail is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and the replies are emails.

### Riverbend Driving School walkthrough

Riverbend shows the `student` subject kind for a driving school in Winnipeg, built on the demo engine in `scripts/demo_riverbend.py`. A teenager's parent is the client and the teen is the student, with a birthday, grade and school; an adult learner is their own client and student. The school shares three cars, set up as rooms and equipment: "Corolla · auto · ABC 123" and "Civic · auto · DEF 456" for automatic lessons, highway lessons, refresher assessments and road tests, and "Golf · manual · GHI 789" for manual lessons, while parking practice goes out in whichever car is free. Automatic lessons are offered by Linda, Marcus and Arjun and manual lessons only by Jasmine, so with three automatic instructors and two automatic cars, a lesson needs a free car as well as a free instructor. Instructors pick students up at home, school or work, with the pickup in the booking's note. A new student books a lesson online and fills in the registration form, regulars come weekly on a 10-lesson pack that belongs to one student, the classroom course runs over four Tuesday evenings, and the road test package holds its date with a $50 deposit. Lessons, packages and the course carry GST only, the student driver magnet carries GST and Manitoba's 7% RST, and gift cards carry neither. Each stage has a seeded client, with ids following `bk_rb_<key>`, `pkg_rb_<pack>_<key>` and `cl_rb_<household>`:

| Stage                                                                 | Where to look                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| New teen student booked online, registration in, waiting for approval | Angela for Bianca (`bk_rb_ramos`, `fr_rb_registration_ramos`), agreement not yet signed                                 |
| Partway through a 10-lesson pack on a weekly series                   | Karen for Noah (`pkg_rb_ten_auto_bergen`, `sch_rb_bergen`): six used on Saturdays with Marcus                           |
| Two siblings, each with their own pack                                | Hiroshi for Aiko, manual with Jasmine (`pkg_rb_ten_manual_aiko`), and Ken, automatic with Arjun (`pkg_rb_ten_auto_ken`) |
| Today's lessons: in the car, instructor on the way, later today       | Lena with Marcus (`bk_rb_lena`), Linda on the way to Navjot (`bk_rb_navjot`) and Emma with Jasmine (`bk_rb_emma`)       |
| Both automatics out, so Arjun's free hour can't be booked             | Ethan with Linda (`bk_rb_both_cars_linda`) and Gabriel with Marcus (`bk_rb_both_cars_marcus`), the same afternoon hour  |
| Road test package booked, deposit paid                                | Meera for Rohan (`bk_rb_rohan_roadtest`), with the confirmation email                                                   |
| Road test passed, five-star feedback and a review request             | Sophie (`bk_rb_sophie_roadtest`, `fr_rb_feedback_sophie`)                                                               |
| Classroom course halfway through, one balance overdue                 | `sch_rb_course`: six students; Ricardo for Mateo still owes (`inv_rb_course_alvarez`)                                   |
| Next classroom course enrolling                                       | `sch_rb_course_next`: Nicole for Zoé, Tanya for Caleb and one more                                                      |
| Newcomer's refresher assessment, paid by Tap to Pay                   | Dmytro (`ord_rb_dmytro`), with a highway lesson booked                                                                  |
| Missed lesson charged in full, invoice overdue                        | Shawn for Brayden (`bk_rb_brayden_missed`, `inv_rb_brayden_missed`)                                                     |
| Lesson cut short, half refunded                                       | Amir (`inv_rb_amir_highway`): a flat tire 40 minutes into a highway lesson                                              |
| Four-star feedback about a late pickup                                | Tanya for Caleb (`fr_rb_feedback_caleb`), with the owner's reply                                                        |
| Gift card from a grandparent, used for a highway lesson               | Donald (`gc_rb_noah`) and Noah's lesson (`bk_rb_noah_gift`)                                                             |

Each lesson has 15 minutes after it for the drive to the next pickup, and the car is held for that time too. For the hour of `bk_rb_both_cars_linda`, which starts at 15:00, 15:30 or 16:00 on a Monday, Wednesday or Friday a few days ahead, Linda and Marcus each have one of the automatics, so Connect offers no automatic lesson at that hour even though Arjun is working and free. Enrolling in the classroom course books all four evenings at once and issues the invoice, due on the first evening. Lena is in the car and checked in, Linda is on the way to Navjot and Emma's manual lesson is later in the day when the seed runs between about 11:30 and 15:00 Winnipeg time from Tuesday to Friday; at other times the three lessons move to the next working day without those states.

The scenario works around what the product does not do yet. A visit holds one car, so a lesson can't need a car and a second piece of equipment at once, and a car has no maintenance windows of its own. A booking has no place of its own, so the pickup address is in the booking's note and the registration form. A student's licence stage, such as a learner's licence since February, is a note on the student, because the student kind has no licence field, and nothing checks a licence before a lesson. The road test itself is booked with the testing office, outside the app, and its time is in the booking's note. There is no late cancellation or missed-lesson fee in the product, so Brayden's charge is an invoice added by hand. A gift card can pay toward a checkout sale but not toward an invoice, and the demo redeems Noah's on its own, so his lesson is booked at no charge with a note. Star ratings live with external reviews, so the feedback form's rating stands in for them, and the reply is an email.

### PowerSync signing-key rotation

The signing key, its key ID and the rotation procedure are in [operations](operations.md#powersync-signing-keys).

Offline regression coverage includes month rollover, cancellation after session timeout, access removal after an accepted hours edit, seven-day offline access expiry, static-only service-worker caching, and Android offline hours across a process restart (`offline.hours.yaml`). Run `make test-sync` with a stable source tree: Vite reloads the test page if a source edit lands mid-test.

### Local platform admin demo

After `make seed`, run `make configure-demo-admin` and restart `make dev-api` to load the grant, then run `make dev-admin`. Open `http://localhost:8711` and sign in through the regular login page as **hannah@birchbark.example**, password **demo1234**. The command resolves the existing seeded `us_dev` identity and writes only `DEV_PLATFORM_ADMIN_IDENTITY_IDS` in `backend/.env`; it does not reset business data or change the account password. Rerun it if the auth identity is recreated.

This grant is ignored unless `ENV=dev`; staging/production require explicitly configured `PLATFORM_ADMIN_IDENTITY_IDS`. Diego and Priya remain ordinary demo staff. The console uses admin-scoped navy sidebar `#142238` and accent `#243f65`; the provider app theme is unchanged.

### Admin workspace

Run `make dev-admin` and open `http://localhost:8711`. `make configure-demo-admin` grants the existing Hannah demo identity development-only platform access without reseeding. Signed-out users go through the regular web login; ordinary business roles do not grant platform access.

The core workspace provides searchable businesses, user accounts and client records, payment/refund/ledger inspection, grouped audit records, webhook processing and applied/expected migration revisions. Access shows the current operator's grant; migrations and grant changes remain server/deployment workflows. List pages show 50 rows at a time, and related detail collections show at most 100 records.

Email lab uses the same ten synthetic templates as `make preview-emails`. Select a template, enter one recipient, choose a configured SMTP or Resend transport, then confirm. The subject is marked `[TEST]`; demo links and codes are not live customer actions. Local SMTP is captured in Mailpit (`http://localhost:8715`). Provider acceptance is not proof of inbox delivery. The initial send guard is process-local with Resend provider idempotency; durable delivery history and multi-worker deduplication are not implemented.
