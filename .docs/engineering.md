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
  and CI all read): `typeCheckingMode: strict` over **`src tests scripts migrations e2e`**, with the
  `reportUnknown*` rules off because library stubs (Stripe, SQLAlchemy results) leave members unknown.
  Pinned to `pyright==1.1.408` as a backend dev dependency, so `uv run pyright` is the same version
  everywhere. Pydantic models are checked through `dataclass_transform`: a wrong-typed or unknown
  constructor argument is an error. JSON columns are typed `dict[str, object]`. The structure check
  fails if `typeCheckingMode` is not `strict`, if any `report*` rule other than the four `reportUnknown*`
  rules and `reportMissingTypeStubs` is set below error, if `ignore` is set, or if `include` drops one of
  the five directories, or if `exclude` or `executionEnvironments` hides files.
- **No `Any`:** ruff `ANN401` bans explicit `Any` and `ANN` requires annotations; pyright
  strict checks every call against them. With the `reportUnknown*` rules off, an `Any` that comes from a
  library is not reported.
- **No suppressions:** `scripts/check_structure.py` fails on `# noqa`, `# type: ignore`, `# pyright:`,
  `# mypy:`, `# ruff:`, `# fmt:`, `# isort:`, `# pylint:` and `# pragma` comments (coverage pragmas
  included) anywhere in `src`, `tests`, `scripts`, `e2e`, `migrations` and `infra/pulumi`, and `make lint`
  runs ruff with `--ignore-noqa`, so a directive cannot hide an error. The same script fails on a
  docstring or comment block longer than one line, or a divider banner, in every one of those folders but
  `migrations`, and on a subfolder in `backend/e2e`, which stays a flat package of one file per concept. Fix the cause instead; `tests/test_structure.py`
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
make gen-themes    # regenerate tokens themes.ts from packages/tokens/src/themes.css
make gen-waitlist-email # regenerate apps/site/server/waitlist-email.json from the email layout
make codegen-check # regenerate api-client, sync schema, themes, strings, messages, zones, taxes and the waitlist email; fail if stale
make precommit     # format-check + lint + codegen-check + test  (the pre-commit hook; e2e runs in CI)
make check         # lint + codegen-check + test          (the full local gate)
make revision name=<change>  # Alembic autogenerate into backend/migrations/versions/ (after schema approval)
```

The pre-commit hook (`.githooks/pre-commit`, installed once via `make hooks`) applies only the staged
changes to a temporary worktree at `HEAD`, installs dependencies there from the local caches and runs
`make precommit`, so unstaged edits never decide a commit. It includes the backend, frontend and infra
tests, so Docker must be running: the backend suite starts the shared test tier itself
(`tier.hold()` in `backend/e2e/tier.py`) and needs no `make up`. The browser, device and real-service
suites (`test-web`, `test-connect`, `test-mobile`, `test-sync`, `test-site`) run in CI. The hook uses
uv's default cache in `~/.cache/uv`; a cache under `/tmp` loses files to macOS's periodic cleanup and
then fails installs.

---

## CI: lint, then the tests (`.github/workflows/ci.yml`)

Runs on every push to `main` + all PRs; concurrency-cancels stale runs. The workflow token is read-only, every job has a `timeout-minutes`, and every image is pinned by digest (the Postgres service uses the `docker-compose.yml` pin). setup-uv takes the Python version from `backend/.python-version`.

`ci.yml` runs three groups and one result job. Each group is a reusable workflow, so the run graph draws it as a box that holds its jobs, and checks read like `lint / backend`. The `lint` group (`lint.yml`) holds the fast checks. `checks` (`checks.yml`) and `e2e` (`e2e.yml`) both need it, so a format, lint, type or codegen failure stops the run before any test tier or browser starts. `ci-result` runs last whatever happened and passes only when all three groups passed. It is the one required check, so the ruleset doesn't list each job, and a group that was skipped because lint failed counts as a failure.

| Job                   | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **lint / backend**    | `uv sync` → `make format-check-backend lint-backend` (ruff format, ruff, pyright and the structure check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **lint / frontend**   | Node from `.nvmrc` · pnpm 9 · `pnpm install --frozen-lockfile` → `make format-check-frontend lint-frontend` (prettier, eslint + `check-structure.mjs` + knip, tsc and the site copy rules)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **lint / infra**      | `uv sync` in `infra/pulumi` → `make format-check-infra lint-infra test-infra` (ruff, pyright, and pytest of the cloud, staging and prod stacks against Pulumi's mocks, which takes under a minute)                                                                                                                                                                                                                                                                                                                                                                                                               |
| **lint / codegen**    | `make codegen-check`: `make gen-api`, `gen-sync-schema`, `gen-themes`, `gen-messages`, `gen-strings` (which also fail on invalid or unused catalog messages), `gen-zones`, `gen-taxes` and `gen-waitlist-email`, then a diff check on the generated files (the api-client, sync schema, `themes.ts`, `messages.pot`, `en_XA.po`, both `strings.ts` accessors and `en-XA.json` files, Connect's `embed.js`, app-core `zones.ts` and `zones.cases.json`, app-core `taxRates.ts` and `taxes.cases.json`, and the site's `server/waitlist-email.json`), so the committed generated code cannot drift from its source |
| **checks / backend**  | `make test-tier` → `make test-backend` (pytest on pytest-xdist with 90% branch coverage combined across the workers, each worker on its own copy of the seeded template, which is restored from a dump the job caches under the template's name) → `make test-auth`, which fails rather than skips when the auth service is unreachable in CI                                                                                                                                                                                                                                                                    |
| **checks / contract** | `make test-tier` → `make test-contract`: the real `StripeGateway` validated against Stripe's OpenAPI mock; a missing mock fails the job in CI instead of skipping                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **checks / frontend** | `make test-frontend build-apps`: the lint rule tests, vitest for app-core and site, then app-core again under `TZ=America/Vancouver`, `America/Halifax` and `Asia/Tokyo` (the formatter tests assert `en-CA` and `en-XA` output), then `tsc -b` and the Vite build of every app except the site (web, Connect and admin), so a broken bundle fails CI beyond `tsc --noEmit`. The build step took 20 seconds in a recent run on `main`, less than a job's setup, so it shares this job. The site job builds the site, so `build-apps` leaves it out                                                               |
| **checks / images**   | Builds the `prod` targets of `backend/Dockerfile` and `frontend/Dockerfile` with Buildx and the GitHub Actions cache, without pushing, so a broken Dockerfile fails CI. It then starts each image's server binary (`python`, `caddy`) with `--cap-drop ALL` and `no-new-privileges`, as the cluster's pods run it, so a binary that carries file capabilities fails here rather than in a deploy. The frontend image installs from a stage that holds only the package manifests, so its install layer stays cached until a manifest or the lockfile changes                                                     |
| **checks / site**     | Chromium through `.github/actions/playwright` · `make test-site`: a fresh build, then Playwright e2e on it: every page returns 200 with its content in the HTML, no console errors, no broken images or internal links, no sideways scroll at 390 and 1440px, axe with no serious or critical issues, 404 page served with a 404                                                                                                                                                                                                                                                                                 |
| **e2e**               | every end-to-end lane, grouped under one parent: see [End-to-end lanes in CI](#end-to-end-lanes-in-ci)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **ci-result**         | the one required check: it passes only when `lint`, `checks` and `e2e` all passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### End-to-end lanes in CI

`ci.yml` calls `e2e.yml` as its `e2e` job once the `lint` group has passed, and `e2e.yml` calls one reusable workflow per surface. The run graph shows one `e2e` group with a subgroup for each surface, and checks read like `e2e / web / chromium (1/5)`. Every job runs on its own runner and starts its own test tier.

| Subgroup                            | Jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e / prepare`                     | runs `make test-prepare` once: it seeds the core demo businesses into a Postgres dump and builds web, Connect and admin, then uploads both as the `e2e-prepared` artifact. The web and Connect lanes wait for it, and the Android shards pick up its snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `e2e / web` (`e2e-web.yml`)         | the Chromium lane in five shards, the `en-XA` pass, Firefox and WebKit (the cases tagged `@browsers`), journeys in two shards, and filings. Its `result` job merges each sharded lane's reports and requires every case of the lane across its shards, since a single shard holds only part of it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `e2e / connect` (`e2e-connect.yml`) | Chromium, the `en-XA` pass, Firefox and WebKit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e / mobile` (`e2e-mobile.yml`)   | `shards` runs `python -m e2e.shards --surface native --count 5`, which splits the Maestro flows into five shards by their measured seconds with the same balancer as the web lanes, adds a sixth for the flows tagged `stripe`, which run with `--fake-stripe`, and hands the list to `android`; `build` makes an x86_64 release APK, cached under the Expo native fingerprint so a hit only rebundles the JavaScript; `android` runs each shard on an Android 14 emulator whose pinned build, system image and quick-boot snapshot are cached together, and warns when a flow takes over three times its usual time in `backend/e2e/seconds.json`. Mobile doesn't wait for `prepare`, so the build starts at once. By the time an `android` shard has its emulator and tier up, `prepare` has normally uploaded its seed snapshot; the shard waits up to five minutes for the artifact through the Actions API (which is why the `e2e` job has `actions: read`), and seeds its own when it doesn't arrive. Seeding on a runner that also hosts the emulator took about three and a half minutes, longer than a shard's flows |
| `e2e / sync`                        | `make test-sync`, which writes its own fixtures rather than the demo seed. Every case runs in Chromium, and the replica lifecycle cases (`lifecycle.e2e.ts`) also run in Firefox and in WebKit, which gets a persistent profile because OPFS refuses a private context. The `chromium-indexeddb` and `firefox-indexeddb` projects run the lifecycle and outbox cases on IndexedDB, leaving out the `@opfs` ones. `forbidOnly` is on, and the lane fails unless every case `SYNC_CASES` in `backend/e2e/results.py` lists for a project ran once and passed; `make test-sync ARGS="<playwright args>"` runs a selection without that check                                                                                                                                                                                                                                                                                                                                                                                                         |

The shared steps live in `.github/actions`:

- **`playwright`** installs a browser and its system packages from a cache keyed by the runner image, the Playwright version and the browser. A miss installs from the Ubuntu mirror and keeps the downloaded packages; a hit installs those packages offline. The mirror has been slow enough to hold a lane for 12 minutes, so a hit removes the lanes' dependence on it. If the runner image has moved and a saved package no longer installs, the step falls back to the mirror.
- **`setup`** installs the backend or infra Python project with uv and the frontend workspace with pnpm, each when asked; the lint and checks jobs use it directly.
- **`e2e-setup`** installs the backend and frontend through `setup`, then the lane's browser and the tier, and restores the `e2e-prepared` artifact into the tier's folder.

The tier's images are pulled rather than cached: pulling them took about 33 seconds, and restoring a saved copy and loading it into Docker took 31 to 47 seconds.

- **`e2e-collect`** uploads a lane's run records and the tier's logs, pass or fail.

A sharded lane splits its cases by measured time rather than by file. The runner lists the lane's cases, gives each the seconds `backend/e2e/seconds.json` records for it under `web` (the median for a case it doesn't know), and hands them out longest first to the shard whose expected wall time grows least. A shard's expected time is the larger of its total over the two Playwright workers and its longest file, since one file's cases run on one worker. A shard passes its cases to Playwright as `file:line` filters, so one file's cases can land in several shards, while the cases a shard holds from one file still run in order on one worker. The account runs about 20 jobs at once, shared with every other workflow, so more shards stop shortening a run once the lanes queue for runners; six Chromium and three journeys shards used more runner time than five and two without finishing sooner. The web `result` job uploads the merged measurements as `web-case-seconds`; merge them into `seconds.json` when the shards drift apart, averaging with the values already there, since one run's times vary with what shared its runner.

Net effect: no unformatted/untyped/uncovered code, no broken bundle, no drift between backend models and the
generated frontend contracts/themes.

Every job runs its full suite on every pull request and on every push to `main`; no job is skipped by
the paths a change touches.

Three workflows run outside the pull request flow and never gate a merge. `flakes.yml` runs every Sunday,
and by hand, and runs `make test-flakes` for the web, Connect and journeys lanes, uploading each lane's
`flakes.json`. `mutations.yml` runs `make test-mutations` every Sunday and by hand. `native-ios.yml` runs
only by hand, on a self-hosted Mac with Docker, Xcode, Maestro and a booted simulator whose UDID is the
run's input, because GitHub's macOS runners can't run Docker; it builds the e2e app and runs the native
lane on iOS. With `ENV=dev` the API allows 1000 requests a minute from one address on
the public endpoints (30 otherwise), since one browser plays every visitor in the e2e suites.

### Storage bench (`.github/workflows/storage-bench.yml`)

The storage bench measures how the web replica's storage behaves in each browser. It lives in `frontend/packages/sync/bench/` and opens a PowerSync database with the app's `AppSchema` and the workspace's `@powersync/web`, then applies one first checkpoint through `powersync_control` with no network. The rows are synthetic, but each table has the row count Cedar Coast Pet Care, the largest core business, syncs. For each storage (IndexedDB, OPFS and memory by default) and each context (a plain Playwright context, which browses privately, and an on-disk profile), it records the OPFS probe, cold open, the first checkpoint, reads, the reopen after a reload and the SQLite file size. It also runs two tabs writing at once, reloads in a row, a relaunch followed by `disconnectAndClear()` and `VACUUM`, and, when asked, a script navigation during the first checkpoint while it watches for a renderer crash. Each run writes `results.json`, `tables.md` and the page logs to `.scratchpad/bench/`.

```
cd frontend/packages/sync
node bench/run.ts --browser chromium   # or firefox, webkit, chrome, msedge
node bench/run.ts --browser chrome --crash-runs 30 --headed
node bench/safari.ts                   # real Safari; needs "Allow remote automation"
node bench/tables.ts <results.json or folder>...
```

The workflow runs only from `workflow_dispatch` and never gates a merge. It runs the bench on Linux (Chromium, Firefox, WebKit), macOS (the same three and Safari through `safaridriver`) and Windows (Chromium, Firefox, Chrome and Edge, with the crash scenario on Chrome and Edge). The Linux Chromium job also builds the web app and records its wasm files. Each job uploads its results and adds its tables to the run summary, and a last job joins every table into `storage-bench-tables`. The bench serves its page on 8795 (`BENCH_PORT`) and drives safaridriver on 8796 (`SAFARI_DRIVER_PORT`).

---

## Testing

Tests are the **primary feedback loop** until manual QA — the goal is for green tests to remove the need for
manual QA at intermediate backend steps. Optimize for **meaningful** coverage: tests that fail when behavior,
contracts, or security regress — not line-count theater.

### Shape: integration-first

- **Integration tests dominate** — `httpx.AsyncClient` → the real FastAPI app → real migrated + seeded
  Postgres. One test file per concept (`test_<concept>[_<aspect>].py`). They cover the true HTTP contract + auth + DB constraints.
- **Unit tests** only for pure logic with many cases (tax math in `test_tax.py`, the PowerSync signing
  keys, the frontend `parseTimestamp` and the zone table checked against `zones.cases.json`). No DB, no HTTP.
- **We don't mock our own code.** The DB is real; our services run for real.

### Isolation: transactional rollback (`tests/conftest.py`)

Every test runs inside a transaction that is rolled back at the end. A fixture opens a connection + outer
transaction; an `AsyncSession(bind=conn, join_transaction_mode="create_savepoint")` is shared by the test
**and** the app (via `app.dependency_overrides[get_session]`). The app's `commit()`s become savepoints; the
final `rollback()` erases everything. Tests start from the **committed core seed** (Birchbark, Cedar Coast and Northlight), write
freely, and leave **zero residue** — repeatable, parallel-safe.

`make test-backend` runs the suite through `e2e/database.py`, which seeds a template database once per
migrations, seed code and frozen instant (or restores it from the dump it kept under the tier's `templates/`
folder, which CI caches, and then uploads the demo assets its files name, as the seed would have), then copies it to a `clientbridge_test_<random>` database for
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

### Stripe: four tiers, layered by cost

The fake covers our _logic_; it can't prove the real adapter maps correctly. Three more tiers close that:

| Tier         | Run                        | Validates                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fake**     | default suite              | our logic + idempotency + error mapping (fast, hermetic, in-memory)                                                                                                                                                                                                                                                                                                                                                                       |
| **Contract** | `make test-contract`       | the real `StripeGateway` vs **stripe-mock** (`stripe/stripe-mock` v0.206.0, pinned by digest in `docker-compose.yml` and CI) — every v1 request shape + response parse, including plan Checkout, the Billing Portal and the plan subscription calls. Stateless; asserts shapes, not state. stripe-mock has no `/v2` routes, so the Accounts v2 calls (create, retrieve, capability request) are covered by the fake and the sandbox tier. |
| **Contract** | `make test-auth`           | the real `KratosIdentityProvider` vs the local auth service: admin-created identity, native login, whoami, revocation.                                                                                                                                                                                                                                                                                                                    |
| **Sandbox**  | `make test-sandbox`        | real test-mode Stripe (Accounts v2 creation and requirements, KYC transitions, declines and 3D Secure, refunds, disputes won and lost, a manual payout through transit to the bank, subscription periods at the current API version via a Test Clock), each checked against our ledger — behavior the mock's pinned spec can't reproduce. Skipped without `STRIPE_TEST_SECRET_KEY`; `make test-stripe-qa` runs it with no skips on a leased pair. One real Resend send to `delivered@resend.dev`, skipped without `RESEND_TEST_API_KEY` and `RESEND_TEST_FROM`.                                                                |
| **Browser**  | `make test-stripe-browser` | each money flow end to end on the shared test tier against the sandbox's QA merchants: real Stripe.js and embedded components, signed webhooks through the relay, and the ledger checked against Stripe's balance transactions. Its cases (`STRIPE-BROWSER-*`, `FIN-DEPOSIT-*`, `STR-E*`, and `SCH-E2E-17`, the reaper racing a payment whose event the relay holds) live in `apps/connect/e2e/stripe/*.stripe.ts` and are registered for the `stripe` lane in `backend/e2e/cases.json`.                             |

`contract`, `sandbox` and `kratos` are excluded from the default run (`-m 'not contract and not sandbox and not kratos'`) and auto-skip when their
backing service/keys are absent, so `make test` stays hermetic. Golden Stripe webhook fixtures live in
`tests/fixtures/stripe/`.

Real-Stripe runs lease a pair of QA merchants: slot a is the business under test and slot b another business, for tenancy checks. A developer's runs use the `local` pair from `.scratchpad/stripe-local-merchants-ready.json`. Hosted runs use one of six CI pairs, `ci-1` to `ci-6`, whose account ids are checked in at `backend/e2e/stripe_pool.json` (ids only, no keys). Each pair has its own lock file (`.scratchpad/stripe-qa.lock`, `stripe-qa-ci-N.lock`), so runs on different pairs never wait on each other, and every run refunds, voids or loses each object it created before it reports.

CI runs real Stripe as `ci.yml`'s `stripe` job (`e2e-stripe.yml`, checks `stripe / api`, `stripe / browser (1/2)` and so on) on every pull request and every `main` commit. It sits beside `e2e` rather than inside it, and `ci-result` doesn't wait for it, so a slow Stripe, a busy merchant pair or a queued runner never holds the required check. Its `shards` job plans the run with `python -m e2e.stripe_plan`: the `api` job always, and the browser lane's two shards, `browser (1/2)` and `browser (2/2)`, on every `main` commit and on a pull request that touches payments code or a screen the lane drives (`BROWSER_PATHS` in that module covers the backend payments services, `app-core`, the web `ui` components, the web and Connect apps and the e2e helpers the lane shares). Each job leases its own pair, `(run number × 3 + slot) mod 6 + 1`, so one run never uses a pair twice, and a concurrency group per pair (`stripe-pool-ci-N`) makes a run on a busy pair wait. All of them run in parallel. `api` runs the sandbox suite (`make test-stripe-qa`) with the event drift check below in about three minutes. A browser shard waits for `e2e / prepare`'s `e2e-prepared` artifact the way the Android lanes do, restores its builds and seed from it (or builds and seeds its own after ten minutes without it), runs `python -m e2e.stripe stack --shard N/2`, which balances the lane's cases by their seconds in `backend/e2e/seconds.json` under `stripe` and ends each shard with the reconciliation case on its own pair, and uploads through `e2e-collect`; `result` merges the shards and requires every Stripe case, in every browser it names, with `python -m e2e.results --surface stripe --browsers`. Its jobs set `continue-on-error` and report only. Once the lane has run for two weeks without a failure caused by Stripe, making it required is two edits: add `stripe` to `ci-result`'s `needs` and drop the `continue-on-error` lines. Pull requests from forks get no secrets and skip it. On CI the browser shards trust DigiCert's High Assurance EV root (`.github/certs/`), because Linux WebKit otherwise rejects `api.stripe.com`'s cross-signed chain. Failed cases keep a screenshot and a trace in the shard's artifact, and the lane doesn't retry: a retried case charges Stripe again, and a retry would hide the flakes the report-only period is meant to find. A failing test is annotated `Stripe rate limit`, `Stripe outage` (a connection error or a 5xx) or `Test failure`, so a red run says whether to look at our code or at Stripe's status.

The sandbox suite also records the shape of every event Stripe sends it (field names and value types, never values) in `tests/fixtures/stripe_events/`. `stripe_event` in `tests/helpers.py` checks each fake webhook the default suite posts against that recording, and fails when the fake sends a field real Stripe doesn't send or sends it with another type. Each CI run (`--record check`) fails when an event it received no longer has something the recording has; `--record update` rewrites the recordings, which are reviewed and committed like any fixture. The check covers webhook payloads; the fake gateway's return values are typed and covered by the contract tier.

STR-E08, a manual payout, runs only with `--payout-case`: it pays out of the merchant's available balance, which cleanup refunds and lost disputes can drain, and Stripe's payouts component hides Pay out while an earlier payout is on its way, so it can run about once a day. Missed-event replay has no browser case, because Stripe lists an event as undelivered only when a registered endpoint failed, and a failing endpoint on the shared sandbox would affect staging.

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

### The shared test tier

Every suite runs on one long-lived set of services, the `clientbridge-test` compose project, which `make test-tier` starts or checks. It is separate from the dev stack, so tests never touch dev data, and a run never starts containers of its own.

| Service         | Port                    | Shared how                                                                                            |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Postgres        | 8760                    | `clientbridge_test_e2e` for browser, journey and native runs; one template per fingerprint for pytest |
| Redis           | 8761                    | One database index per run slot                                                                       |
| rustfs          | 8762                    | One bucket per run                                                                                    |
| Mailpit         | 8763 web, 8764 SMTP     | Runs find mail and texts by their own recipients                                                      |
| Kratos          | 8765 public, 8766 admin | One instance whose CORS and return URLs list every slot's origins                                     |
| PowerSync       | 8767                    | Replicates `clientbridge_test_e2e`                                                                    |
| stripe-mock     | 8768                    | Contract tests                                                                                        |
| Auth mail relay | 8769                    | Forwards each Kratos courier request to the API of the run that owns the recipient                    |
| Google stand-in | 8788                    | Signs in whatever address a test types, as Kratos's `google` provider                                  |

A run leases one of six slots, which fixes its web, pseudo-locale and admin origins (8770 to 8787) and its Redis index. Only the code under test runs per run: the API, the worker, the bundles and the browsers.

Each run has a short namespace (`RUN_NAMESPACE`, refused outside dev). Every ID the run's API creates ends in it, the seed writes the core demo businesses into it with run-specific emails such as `hannah+<namespace>@birchbark.example`, and the run's worker sees only that namespace's rows (`core/namespaces.py`). Cleanup purges the namespace's businesses, users, Kratos identities, bucket and Redis index, and a reaper clears namespaces whose run has no live process.

The tier records a fingerprint of the Alembic head, `sync-rules.yaml`, the Kratos configuration and the tier's own service configuration. A browser, journey, native or sync run from a checkout with a different fingerprint rebuilds the tier for that checkout when no other run holds it (`hold()` in `backend/e2e/tier.py`); when another run does, it stops before seeding, names the difference and asks you to retry once those runs finish. `make test-tier-reset` rebuilds the tier from scratch, and `make test-tier-logs` prints every tier service's log. Pytest copies a seeded template per fingerprint of the migrations, the seed and `FROZEN`, so each worker starts from a fresh database in a second or two. Because the suite brings its own schema, it checks only the tier's service configuration: worktrees on branches with different migrations or sync rules run their backend suites, and the pre-commit gate, side by side without waiting for each other or rebuilding the tier.

### What an e2e case proves

- A case acts through the real interface. API calls may create prerequisites or clean up what the run owns, but they never count as UI coverage.
- Expected effects come from the case's own arithmetic and from independent reads (read-only SQL, Mailpit, the Stripe sandbox), never from the production calculation under test.
- A lost response is simulated by forwarding the real request and dropping only its response after commit.
- Visible records use realistic names. IDs and email aliases carry the run's identity, and tests select by exact ID or recipient where names can collide.
- A run fails on a missing, skipped or retried required case, an empty report, a source change during the run, a failed cleanup, or a worker that wasn't alive at the start and the end with its scheduler firing a job on its own.

### How an e2e run starts

An e2e run works on its own copy of the core demo businesses in the shared tier, renamed into its namespace (`backend/e2e/namespace.py`). Seeding those businesses takes about a minute, so it happens once into a Postgres dump (`backend/e2e/snapshot.py`, under the tier's `snapshots/` folder) keyed by the migrations and the seed's code and assets. A run restores the dump into a scratch database, puts the demo assets in its own bucket, and copies the rows into the tier under its namespace, which takes seconds. A run with an explicit seed instant, such as filings with its quarter opening, needs a dump made at that instant. A real-time run takes one made in the last 15 minutes on the same local day in every core business's zone, since the suites derive their dates from today; otherwise it seeds a new one. Concurrent runs wait for the one that is seeding.

Browser lanes preview production builds of web, Connect and admin. The runner builds each app once per source fingerprint (the tracked frontend files other than tests, the mobile app and the site) into the tier's `builds/` folder, and every lane on that source serves the same build with `vite preview`, which answers `/config.js` with the run's URLs. The `en-XA` pass keeps a dev server, since the pseudo-locale is a development switch. `make test-prepare` does both ahead of time, which is what CI's prepare job runs.

### Running the suites locally

Every suite runs on the shared tier, so Docker has to be running; nothing else from `make up` is needed. `make test-functional` runs any lane through `python -m e2e.runner`, with its options in `FUNCTIONAL_ARGS`:

- `--surface web|connect|journeys|filings|native` picks the lane (web by default), and `--project pseudo|firefox|webkit` the browser project of a web or Connect run.
- `--shard N/M` runs one shard of a web, Connect or journeys lane, balanced the way CI balances it.
- `--seed-as-of <instant>` seeds at a fixed time instead of now; the filings lane picks its quarter's opening by itself.
- `--build-native ios|android` builds the `ca.clientbridge.app.e2e` release app the native lane installs.

`make test-web` and `make test-connect` are the web and Connect lanes with `ARGS` passed through, and `make test-sync` runs the sync verification on the tier with its own fixtures. Each run gets its own namespace and its own copy of the core seed, so lanes from several checkouts can run at once.

The native lane needs Maestro and a simulator or emulator that is already booted; it never starts a device. Build the app once per native change with `make test-functional FUNCTIONAL_ARGS="--build-native ios"` (or `android`), then run `make test-mobile PLATFORM=ios|android DEVICE=<id>`. Its ports are fixed (see [Ports](#ports--the-87xx-block)), so one native run holds them at a time. [`frontend/apps/mobile/e2e/README.md`](../frontend/apps/mobile/e2e/README.md) has the flows and their controls.

Two targets measure the suites rather than gate them. `make test-flakes` runs a lane with every case repeated `FLAKE_REPEAT` times (3 by default) in an order shuffled by `FLAKE_SEED`, and writes each case's first-attempt outcomes to the run's `flakes.json`; `FLAKE_ARGS` picks the lane (`--surface web` by default). `make test-mutations` applies each mutation in `backend/e2e/mutations.py`, such as skipping a deposit's application or loading a client without `scoped()`, to a temporary worktree of the committed revision, and fails unless the case that owns the invariant fails.

Offline regression coverage includes month rollover, cancellation after session timeout, access removal after an accepted hours edit, seven-day offline access expiry, static-only service-worker caching, and Android offline hours across a process restart (`offline.hours.yaml`). Run `make test-sync` with a stable source tree: Vite reloads the test page if a source edit lands mid-test.

### Recording a run

`E2E_RECORD=1` on any Playwright run keeps a video of every test, slowed so a person can follow it. `recorded()` in `packages/config/e2e/recording.ts` wraps each Playwright config: when the variable is set it records every context, draws a cursor and a label for each action, shows the test's title and current `test.step` in the corner, waits 500ms between actions (`E2E_RECORD_SLOWMO` changes it), and runs one test at a time with no retries and four times the timeout. Contexts a test opens itself record through `contextOptions`, without the title overlay.

After a recorded run, `backend/e2e/recordings.py` converts the videos to mp4 with ffmpeg and writes them with an `index.html` to the run's `recordings/` folder, matching a context's video to its test by time. The runner prints the index's path. For example:

```sh
E2E_RECORD=1 make test-connect ARGS="-- -g XB-E2E-09"
```

In CI, `gh workflow run ci.yml --ref <branch> -f record=true` runs the whole pipeline with recording on: the web, Connect and Stripe browser lanes set `E2E_RECORD=1`, get a longer timeout, and upload `recordings/` with each lane's run records for 7 days. The Stripe lane runs all its cases on a manual run.

Maestro flows record the same way. With `E2E_RECORD=1`, `e2e/native.py` runs each flow through a wrapper in the run's `native-flows/` folder that keeps the flow's name and tags, starts Maestro's `startRecording` and stops it in `onFlowComplete`, so a failed flow keeps its video too. Maestro runs at its normal pace, and the videos join the same `recordings/` index. The mobile lane uploads them on a recorded CI run.

### Where an e2e test goes

The browser and device suites follow the same one-name-per-concept rule as the rest of the code, so the file for a test is the one named after the concept you changed: the app-core domain file, the strings group, the service and the page share that name.

| What changed                                                       | File to extend                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One concept's provider behaviour (rules, states, rejections)       | `apps/web/e2e/<concept>.e2e.ts`, for example `clients`, `billing`, `pos`, `earnings` or `reports`                                                                                       |
| A public page                                                      | `apps/connect/e2e/<publicPage>.e2e.ts`, for example `publicBooking`, `publicPay` or `publicShop`                                                                                        |
| A mobile-only screen or native behaviour                           | `apps/mobile/e2e/<concept>.yaml`, or `<concept>.<aspect>.yaml` when the concept has more than one flow                                                                                  |
| Something whose consequences cross concepts, devices or the worker | the anchor journey in `apps/web/e2e/journeys/<flow>.journey.ts`: `visit`, `estimate`, `stock`, `client`, `documents`, `communication`, `entitlements`, `team`, `device` or `operations` |
| A new concept                                                      | a new `<concept>.e2e.ts`                                                                                                                                                                |

Pages named by their nav label use their concept's name here too, so Invoices tests live in `billing`, Inbox in `messaging`, Team in `staff` and Schedule in `bookings`. A few cross-cutting suites keep their own names, as the backend's `test_flows_*` do: `auth`, `offline`, `sync`, `security`, `shell` (the page-and-dialog walk), `accessibility` and `pseudo`, plus `embed` and `site` in Connect. A mobile flow may also take the name of a screen with no domain of its own, such as `setup`. The completed-quarter filing case is `remittances.filing.ts`.

Helpers live in `apps/web/e2e/support/<concept>.ts`, and their database checks are read-only SQL over the one connection in `support/db.ts`. Connect's `e2e/` holds only `<publicPage>.e2e.ts` cases, with helpers in `e2e/support/`. A lane with its own Playwright config has its own folder, with cases named `<case>.<lane>.ts` and helpers in that folder's `support/`: the Stripe lane is `apps/connect/e2e/stripe/<case>.stripe.ts` and the deployed smoke checks are `apps/connect/e2e/smoke/<case>.smoke.ts`. A lane that drives a screen the web suite also drives uses the web suite's helper for it, such as `paymentPanel` in `support/pos.ts` or `paymentDrawer` in `support/billing.ts`, so a change to that screen updates one locator for both. `check-structure.mjs` fails on a spec, journey or flow named any other way, or a helper outside `support/`; it reads the concepts from `app-core/src/domain/` and Connect's pages from `apps/connect/src/pages/`. A case's title starts with its ID, and each new case gets one entry in `backend/e2e/cases.json`: its lanes, whether Firefox and WebKit run it (`browsers`, which matches its `@browsers` tag), and its status. A lane requires every `implemented` or `verified` case registered for it and fails when one doesn't run. `test_harness.py` checks that every registered case is written in its lane's files and that every case ID in those files is registered. A measured time in `backend/e2e/seconds.json` is optional, since a case without one counts as the median.

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

Commits, comments, migrations and when to regenerate code follow the rules in [CLAUDE.md](../CLAUDE.md),
which the gate enforces where it can. Two more apply here:

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
services below use 8700–8716 and 8750–8751. The shared test tier uses 8760–8769 and 8788, and its run
slots' web, pseudo-locale and admin origins 8770–8787 (see [The shared test tier](#the-shared-test-tier)).
The native e2e lane fixes 8794 (API), 8795 (auth) and 8796 (PowerSync), which the e2e app has compiled in,
and 8797 for Maestro's driver. The storage bench defaults to 8795 and 8796 as well (`BENCH_PORT`,
`SAFARI_DRIVER_PORT`), so it can't run beside a native run without moving. Container-internal ports stay
conventional; only host mappings use 87xx.

| Port            | Service                                                                                  | Container   | Set in                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **8700**        | Web (Vite) — provider app                                                                | —           | `apps/web` vite (strictPort) · `make dev-web`                                                                            |
| **8701**        | Backend API (FastAPI/uvicorn)                                                            | —           | `make dev-api`                                                                                                           |
| **8702**        | Postgres (source + `powersync_storage`)                                                  | 5432        | docker-compose · `DATABASE_URL` (API role) · `MIGRATION_DATABASE_URL` (schema owner) · `ADMIN_DATABASE_URL` (role setup) |
| **8703**        | Redis                                                                                    | 6379        | docker-compose · `REDIS_URL`                                                                                             |
| **8704**        | PowerSync service                                                                        | 8080        | docker-compose · `POWERSYNC_URL`                                                                                         |
| **8705 / 8706** | S3 (RustFS): API / console                                                               | 9000 / 9001 | docker-compose · `S3_ENDPOINT`                                                                                           |
| **8707**        | Expo / Metro (mobile)                                                                    | —           | `make dev-mobile`                                                                                                        |
| **8708**        | stripe-mock, for a bare `pytest -m contract` (`make test-contract` uses the tier's 8768) | 12111       | docker-compose `profiles:[test]`                                                                                         |
| **8709**        | Connect (Vite) — customer app, on `book.`, `shop.`, `pay.` and `<slug>.localhost`        | —           | `apps/connect` vite (strictPort)                                                                                         |
| **8710**        | Marketing site (Vite, static build)                                                      | —           | `apps/site` vite (strictPort) · `make dev-site`                                                                          |
| **8711**        | Platform admin shell (Vite)                                                              | —           | `apps/admin` vite (strictPort) · `make dev-admin`                                                                        |
| **8713 / 8714** | The auth service (Ory Kratos): public / admin API (admin bound to 127.0.0.1)             | 4433 / 4434 | docker-compose · `AUTH_PUBLIC_URL` / `AUTH_ADMIN_URL`                                                                    |
| **8715 / 8716** | Mailpit: web UI and API / SMTP (the API's mail under `make dev-api`; 127.0.0.1 only)     | 8025 / 1025 | docker-compose                                                                                                           |
| **8750**        | Backend image: API (the `app` profile)                                                   | 8701        | docker-compose `profiles:[app]` · `make up-app`                                                                          |
| **8751**        | Web image: Caddy serving web, Connect and the site by host                               | 8080        | docker-compose `profiles:[app]` · `make up-app`                                                                          |

### Bring-up

```
cp .env.example backend/.env  # once: the local settings the API, worker and scripts read
make hooks                 # once per clone: install the pre-commit gate
make install               # uv sync + pnpm install
make up                    # Postgres (logical WAL), the database roles and the storage + auth DBs, then powersync/auth/mailpit/redis/s3
make migrate               # roles, unpublish, then Alembic as the migrator, then grants and the publication of synced tables
make seed                  # replace the demo businesses (needs the auth service from `make up`)
make stripe-setup ARGS="--project-name <profile> --apply --write-db"
                           # link the demo to the Stripe sandbox again after every seed (payments.md, Local sandbox setup)
# separate terminals:
make dev-api  dev-web  dev-connect  dev-admin  dev-mobile  worker
make dev-site              # marketing site from source on :8710
make build-site            # static build in frontend/apps/site/dist (pnpm --filter site preview serves it on :8710)
make test-site             # build + Playwright pass over every page (links, images, 390px, axe)
make test-web              # the web lane on the shared test tier, in its own namespace with its own copy of the core seed
make test-connect          # the Connect lane, the same way: booking, manage link, shop and every client page
make test-functional FUNCTIONAL_ARGS="--build-native ios"
                           # build the ca.clientbridge.app.e2e release app (or android) once per native change
make test-mobile PLATFORM=ios DEVICE=<id>
                           # Maestro flows on that build, on a simulator or emulator that is already booted
make test-staging-smoke    # read-only Playwright checks of deployed staging (SMOKE_* env vars pick another
                           # environment; see demo.md for the logins it uses)
make lighthouse-site       # Lighthouse budget (desktop >= 95 in every category) against the :8710 preview
make test-sync             # on the shared test tier: per-role replica rows and columns, revocation,
                           # hours uploads, the replica lifecycle in Chromium, Firefox and WebKit, the
                           # signing-key rotation drill, then the replication health check
make images                # build the backend and web prod images
make up-app                # the prod images on the local infra: API :8750, web :8751
make replication-health    # local PowerSync readiness, slot, retained WAL (1 GiB) and replay lag (60 s)
```

`make migrate` runs `db_access unpublish` before Alembic, which narrows the publication to the columns
the new sync rules keep so a migration can drop the others, and `grants` publishes the synced tables
again afterwards. Schema changes need explicit approval before a
model or migration is edited (see "Schema approval" in [CLAUDE.md](../CLAUDE.md)); `make revision
name=<change>` then autogenerates the increment.

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
the API's email, auth codes included, and its texts, since `SMTP_URL` points at it by default when `ENV=dev`; open :8715), `stripe-mock` (test profile only).
The compose auth service posts auth email to the API at `host.docker.internal:8701`; on Linux without Docker
Desktop that is the bridge address, so run the API with `--host 0.0.0.0` there (CI does).

### Database roles and the admin

`scripts/db_access.py` (the roles in [Database roles and replication](architecture.md#database-roles-and-replication)) runs as the admin in `ADMIN_DATABASE_URL`. Locally and in CI that is the `clientbridge` superuser. On Cloud SQL each environment has its own admin, `prod_admin` or `staging_admin`, a `CREATEROLE CREATEDB` user that is neither a superuser nor a member of `cloudsqlsuperuser`, so the script uses only what such an admin can do; the shared `postgres` user is not used by any workload. The admin needs `CREATEROLE` and `CREATEDB`, the owner's privileges on the application database, and the right to set `REPLICATION` on the PowerSync source role: on stock Postgres the admin must have `REPLICATION` itself, and on Cloud SQL the admin may need it granted, which we have not checked. When the application database does not exist, `roles` creates it as the admin (from the `postgres` database), so an environment's application database should not be created through the Cloud SQL API, which would make `cloudsqlsuperuser` its owner; the script stops with a clear message when the admin cannot act as the database's owner. Staging runs it against Cloud SQL as `staging_admin` in the migrate Job of every deploy; production has not been deployed yet.

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

Clients are reached by text only. Email is Clientbridge's own mail: auth codes, staff invites, the owner's alerts at the billing email, the waitlist confirmation and the admin email lab. It goes out through `integrations/resend.py`, posted to Resend's send endpoint with `EMAIL_FROM` as the sender. `business_email` and `account_email` in `services/notifications.py` build every message: mail to a business's own people carries a `business` tag and no reply-to, and auth mail from the auth service's courier is worded by the same module from the backend catalog and carries no tenant. The delivery queue sends each one with its delivery id as the idempotency key and a `delivery` tag. Without `RESEND_API_KEY` and `EMAIL_FROM` the console no-op sender is used; production refuses to boot without them and `RESEND_WEBHOOK_SECRET`. `SMTP_URL`, when set, takes precedence over Resend; with `ENV=dev` it defaults to Mailpit (`smtp://localhost:8716`), so a dev API delivers there even with Resend keys in `.env`, an empty `SMTP_URL=` turns Mailpit off and sends through Resend locally (so an older `.env` that still has that empty line must drop it to keep Mailpit), and production refuses to boot with `SMTP_URL` set. Texts follow the same rule: with `SMTP_URL` set, `integrations/twilio.py` mails each text to `<digits>@sms.test` (with the e2e run's `+<namespace>` before the `@`) instead of calling Twilio. In an e2e run a 555-0100 to 555-0199 number goes to `@sms.invalid` instead, which the test tier's Mailpit refuses as a carrier refuses a fictional number; outside a run it goes to `@sms.test` like any other, so the demo's texts land in the dev Mailpit. A text without the business's assigned number fails with `sms_unassigned` on every transport (`sender_number`). Outside production a message to a reserved recipient goes to the local sink when one is in use (Mailpit or the console sender) and is otherwise recorded as accepted without being sent; production fails it with `reserved_address`. The sender retries a 429 once, waiting for Resend's `retry-after` capped at two seconds since a send runs inside the caller's transaction, and raises on any other 4xx or 5xx, so an outage or an exhausted quota records a failed send.

Resend reports delivery to `POST /webhooks/email`, signed with Svix headers and checked by `valid_resend_signature` within a five-minute window. `process_email_event` in `services/deliveries.py` records each event once under `resend_<svix-id>` in `webhooks`. An event finds its delivery through the `delivery` tag Resend echoes back, falling back to the `provider_ref` lookup, and a delivery whose send timed out after Resend had accepted it gets its `provider_ref` backfilled from the event. `email.sent` marks the delivery accepted, `email.delivered` delivered, and `email.bounced`, `email.failed`, `email.suppressed` and `email.complained` failed. An event that names a delivery whose transaction has not committed yet is answered 503 for up to ten minutes so Svix retries it, and a signed event the schema cannot parse is acknowledged and recorded as a failed row rather than retried. `infra/pulumi/providers_init.py` subscribes the endpoint to `email.delivered` and the four failure events. Resend cannot reach localhost, so a local API is tested through a tunnel (`ngrok http <port>`) with its own webhook pointed at the tunnel host.

Production and staging setup of the sending domain, API key and webhook is in [operations](operations.md#resend).

### Previewing emails

`make preview-emails` renders the sample emails into `.scratchpad/emails/` as HTML, with the inline images embedded as data URLs so a browser shows them; Mailpit shows the real MIME message in dev. `ARGS="--list"` lists the samples and `ARGS="--email staff-invite"` previews one. To send a sample, name the recipient, the sample and the transport: `make preview-emails ARGS="--email staff-invite --send-to you@example.com --transport resend"`. Resend needs `RESEND_API_KEY` and `EMAIL_FROM`, and SMTP uses `SMTP_URL`. A sent sample carries a `[TEST]` subject and synthetic data, and changes no business records. The browser preview approximates an email client, so check a real delivery in the clients that matter before approving a design.

## The demo seed

[demo.md](demo.md) covers the demo businesses: their logins, what each one shows and the walkthroughs with seeded ids. This section covers how the seed builds and writes them.

Demo accounts are normal tenants in the main local `clientbridge` database, using the standard servers and provider integrations. Every `make seed` replaces the demo businesses' rows with a fresh scenario and keeps unrelated tenants, and it behaves the same way locally and on staging. Tests and CI seed only the core businesses (`make seed-core`, or `seed_demo --core`), which keeps their setup to about a quarter of the rows; this is the one deliberate difference between test data and the demo, and `make seed` and staging's nightly seed still write all 13 businesses. `make demo-check` validates their scenario and ledger. There is no demo runtime mode or separate presentation database.

### How the seed builds the businesses

The scenario is anchored to the current Vancouver date: `seed_demo.build_demo(as_of)` builds the fixture graph, the seed modules enrich it, and it is validated before it is written. Birchbark is built by hand in `scripts/seed_demo.py` and the modules it calls. The other twelve businesses are built on the demo engine: `scripts/demo_engine.py` turns a business's spec (`scripts/demo_spec.py`: its people and hours, catalog, forms, contracts, pacing and storyline stages) into rows, and each business's module, such as `scripts/demo_northlight.py` or `scripts/demo_cedar.py`, holds its spec and storyline. Every demo business is listed in `DEMO_BUSINESSES` in `scripts/demo_context.py`, which `demo_validate`, `connect_links`, `stripe_setup`, `demo_snapshot` and the e2e web fixtures read; the engine validates each business's graph and checks that every storyline stage has its client and rows before anything is written.

Assets in `backend/scripts/demo_assets/` upload to the configured bucket first. The seed creates (or finds) an auth identity for each demo user with the password `demo1234` and a verified email, so `make seed` needs the auth service running. Each run replaces every demo business and its rows, including those a core seed leaves out and any business no longer registered, and refuses when a seeded user also belongs to another business. It builds each business in its own process, then purges every demo business in a short transaction of its own (pausing the ledger's append-only trigger only where entries exist), and then writes, posts the ledger and validates each business in its own process, connection and transaction, largest first, with `--jobs` processes at a time (the CPU count, at most 8). If one business fails, the seed exits non-zero and names it, and that business is left empty while the others hold the new data, so rerun the seed.

Ledger rows are dated from the scenario's clock as they are written, and `python -m scripts.demo_fingerprint --compare URL URL` compares two seeded databases table by table, with the ledger's random ids replaced by their refs, to show a change to the seed left its rows unchanged.

### Seeding through a scratch copy

`--scratch URL` changes where the writes go: the seed creates and migrates that empty database, writes and validates every business there, and only then copies each one into the target in a transaction of its own, which purges the business and streams its rows table by table with binary `COPY`, parents first. Accounts arrive with their balances under the ledger's write mode (`clientbridge.ledger_write`), the entries' balance trigger is paused for that transaction, each journal's balance check runs before it ends, and the copy fails unless every account's balance equals the sum of its entries. The `payments.booking_id` cycle is filled in after bookings. The seed refuses to copy when scratch holds rows outside the demo businesses and their users. If any business fails in scratch, nothing is copied; if a copy fails, that business keeps its old rows.

Staging's Job runs this way against a Postgres sidecar in its own pod (the Cloud SQL version, on loopback port 5433, trusting local logins), because each statement through the Cloud SQL proxy costs about 10 ms and the direct seed makes about 197k of them. On October 21, 2026, when the demo had 11 businesses, a local run with 10.5 ms added to each round trip to the target made about 1,200 round trips and copied them in 67 seconds.

### Pruning retired logins

Auth identities are found by email or created, and the seed tags each one it creates or finds with `clientbridge_demo` in the identity's admin metadata. Only `make seed` against the dev `clientbridge` database and staging's seed Job pass `--prune-logins`, because test, scratch and other databases share the same auth service but hold only some of its users. With the flag, after the target's rows are in (after the copy, when `--scratch` is used), `scripts/demo_logins.py` deletes each tagged identity whose email the seed no longer writes and no user row references, first removing any empty user a sign-in with it provisioned, and prints the emails it deleted. The seed refuses the flag with `--core`, or when the target is anything but the environment's app database (`clientbridge` on dev, `staging_clientbridge` on staging) that `DATABASE_URL` also names. An identity without the tag is never deleted, whatever its domain, so one made before tagging existed has to be deleted by hand.

### Reserved addresses and where the seed runs

Demo contacts use reserved addresses (`.example` and `.test` domains, and 555-0100 to 555-0199 phone numbers), so the demo's reminders and notices never leave the app: locally texts and mail land in the dev Mailpit, which accepts reserved addresses, on staging the delivery job records them as sent without calling a provider, and in production it marks them `failed` with `reserved_address` (see [Delivery recovery](operations.md#delivery-recovery)). Historical provider references are fixture data, not usable Stripe objects: the fixture account reads as fully onboarded so Getting paid agrees with the seeded payment history, but new card payments and onboarding need the sandbox link below or test-provider credentials as for any account; without them use cash or manual payments. `make seed` refuses anything but a local database with `ENV=dev`; staging's deploy runs the same seed against `staging_clientbridge` with `ENV=staging`, and production is always refused.

Stripe sandbox provisioning and demo-account linking are documented in
[Local sandbox setup](payments.md#local-sandbox-setup). That guide covers plan/apply, onboarding,
webhook listeners, fixture versus real provider references, and relinking after a demo reset.

Which signing secret each Stripe event uses, the pinned API version and the staging and live endpoints are in [Payments and Stripe](payments.md#staging-and-production-setup).

`uv run python -m scripts.payment_accounts` (needs `STRIPE_SECRET_KEY`, test mode) audits one connected account's display name, support email, business URL and statement descriptor through Accounts v2, writing missing fields only with `--apply`. Integration tests use normal dependency-injected recording adapters and per-test rollback; CI databases use the `clientbridge_test*` prefix.

## PowerSync signing-key rotation

The signing key, its key ID and the rotation procedure are in [operations](operations.md#powersync-signing-keys).

## Platform admin workspace

The admin app (`apps/admin`) runs locally with `make dev-admin` on `http://localhost:8711`. Signed-out users go through the regular web login, and ordinary business roles don't grant platform access. To use it with the demo, run `make configure-demo-admin` after `make seed` and restart `make dev-api` to load the grant, then sign in as **hannah@birchbark.example** with **demo1234**. The command resolves the existing seeded `us_dev` identity and writes only `DEV_PLATFORM_ADMIN_IDENTITY_IDS` in `backend/.env`; it doesn't reseed, reset business data or change the password. Rerun it if the auth identity is recreated.

That grant is ignored unless `ENV=dev`; staging and production need `PLATFORM_ADMIN_IDENTITY_IDS` set explicitly (`make admin-identity ENV=staging EMAIL=<address>` prints the account ID to put there). Diego and Priya remain ordinary demo staff. The console uses an admin-scoped navy sidebar, `#142238`, with accent `#243f65`; the provider app theme is unchanged.

The workspace provides searchable businesses, user accounts and client records, payment, refund and ledger inspection, grouped audit records, webhook processing and applied and expected migration revisions. Access shows the current operator's grant; migrations and grant changes remain server and deployment workflows. List pages show 50 rows at a time, and related detail collections show at most 100 records.

Email lab uses the same four synthetic templates as `make preview-emails`. Select a template, enter one recipient, choose a configured SMTP or Resend transport, then confirm. The subject is marked `[TEST]`; demo links and codes are not live customer actions. Local SMTP is captured in Mailpit (`http://localhost:8715`). Provider acceptance is not proof of inbox delivery. The initial send guard is process-local with Resend provider idempotency; durable delivery history and multi-worker deduplication are not implemented.
