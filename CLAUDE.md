# Clientbridge — repo conventions

All-in-one business OS for solo/small service providers. All user-facing copy lives in message catalogs
and every displayed value goes through one formatter (see **Copy and formatting**).
Polyglot monorepo: `backend/` (Python · uv · FastAPI) · `frontend/` (pnpm + turbo: web + mobile) ·
`infra/` · `.docs/`.

## Commits
- **Single-line, concise, imperative subject. No body.** e.g. `Add Phase 1 auth: sessions, invites, OAuth`.
- Commit or push **only when asked**.

## Schema approval and early-development scope
- Obtain explicit user approval for each concrete database schema change before editing schema/model definitions or creating/applying migrations, including local and disposable test databases. Present the exact change, purpose, data impact and rollback first; a general instruction to execute a plan is not schema approval.
- The app is in early development. Use one current implementation; do not add old-client compatibility paths, legacy adapters or migration bridges without an explicit requirement. Removing compatibility code does not authorize deleting existing data or reverting applied database changes.

## Backend — layer-first, one file per concept
- **File naming:** `models/` is grouped by domain; every other layer (`api`, `schemas`, `services`, `tests`)
  holds one file per concept with the same plain plural name and no suffix (`api/bookings.py` →
  `schemas/bookings.py` → `services/bookings.py` → `tests/test_bookings.py`). Job bodies (`run_*`) live in
  their concept's service; `tasks/worker.py` holds only the cron schedule. A file
  may be long if it is one concept; split by concept, never by size. Folders stay one level deep. Test
  files are `test_<concept>[_<aspect>].py` (`test_payments_refunds.py`); only cross-cutting suites
  (`test_flows_*`, `test_sync_*`, `test_derived`, `test_integrity`…) are exempt.
- `models` = tables, `schemas` = API shapes; a column reaches the API only through a schema. Models are
  the source of truth for column types: a schema that copies a table subclasses `core/mirrors.Mirror`
  (`mirrors = Model`, plus `derived` for same-named computed fields) and takes vocabularies from the
  model, and `test_integrity` fails when a mirrored field is wider than its column.
- Flow: `api` (thin router + DTO, **never queries**) → `services` (logic, owns the
  transaction/commit) → `models`. Services own their queries and **always scope tenancy through
  `core/scoping.scoped(Model, business_id, soft_delete=…)`** — the one place the `business_id` (+ soft-delete) filter lives; never hand-write a
  `business_id` filter. Money / uniqueness / cross-tenant mutations additionally go through
  `run_command` (atomic + audited + idempotency-replay).
- **5 surfaces** — every capability is exactly one (see `.docs/architecture.md`): sync-read (PowerSync
  rules) · offline command (durable local-only outbox → typed `/v1` command) · command/RPC (FastAPI `POST`) · webhook/public ·
  job. A **server-only invariant** (uniqueness/numbering, capacity, money, secrets, cross-tenant) → a
  **command, NOT an offline edit of the replica**.
- **Role gates** live where the method lives: the service method that does the work gates itself with
  `assert_role(self.principal, …, message=…)` (`core/deps`), because jobs and public flows call services
  too. A router gates only when it has no service to call. Use `is_manager(role)` for a bare role
  string; never hand-write a role tuple check.
- Data: prefixed-ULID PKs (`core/ids.py`) · integer cents + currency · text+CHECK enums (a `Literal`
  alias in the model file, rendered by `enum_check`) · `business_id` on scoped rows ·
  `created_at/updated_at` · soft-delete `deleted_at`.
- **Money balances live only in the ledger** (`services/ledger.py`): every money movement posts a
  balanced, append-only journal through `ledger.post` (idempotent on `ref`). Never add a stored balance /
  amount-paid / fee column; derive it from `accounts` + `entries`.
- Models declare **no `relationship()`s** → the unit-of-work can't FK-order inserts; **flush the parent
  before its FK-dependent children**.
- External services = an **adapter interface + `get_*` dependency** (e.g. `EmailSender`, `OAuthVerifier`);
  prod implements it, tests override with a recording fake.
- Server-only tables (`commands`, `webhooks`, `audits`, `devices`, `sync_receipts`, `payment_setup_links`, `returning_challenges`, `visit_records`) are **not** in `sync-rules.yaml` → excluded from the client AppSchema. `users` syncs only `id` and `name`, for users with a staff row in the business.
- Sync config is edition 3 Sync Streams. Tables that grow with time (messages, slots, bookings) sync through
  the `history_*` streams for a window of months and need a timestamp column of their own; older rows come
  from keyset-paged `GET` reads. Money tables sync in full. Review `tests/fixtures/sync_projections.json`
  whenever a stream's columns change.
- Database roles come from `scripts/db_access.py`: the API runs as `clientbridge_api` (`DATABASE_URL`),
  Alembic and the seed as `clientbridge_migrator` (`MIGRATION_DATABASE_URL`), and the `powersync`
  publication lists only synced tables.
- A file counts as attached only after its complete command confirms the bytes in storage (`uploaded_at`);
  readers ignore pending rows.

## Frontend — share the view-model, render per-platform
- Web (React/Vite/Tailwind) + mobile (Expo RN) share everything UI-agnostic via `@clientbridge/app-core`; only rendering, navigation, and platform APIs differ.
- **Shared components** live in one package, `@clientbridge/ui`: `src/web/` (DOM + Tailwind, used by web and Connect) and `src/mobile/` (React Native) each implement the props from `app-core/src/ui.ts` under the same file name (`ListPage`, `DetailView`, `Modal`, `Tabs`, `Empty`, `Money`, `ChargeSheet`, `CardForm`…). Every app imports `@clientbridge/ui`; the `react-native` export condition gives mobile the native entry. This is not a cross-platform UI framework: each platform keeps its own idiomatic rendering, the two just live side by side. App screens compose these components and never hand-style a control: buttons, fields, selects, toggles, choices, notices, panels, loading/empty states, badges, stats, stars, steppers, confirm dialogs and page headers all come from `@clientbridge/ui`, and the frontend structure check fails on a raw `<button>`/`<input>`/`<select>`/`<textarea>` with a `className`, or a `Pressable`/`TextInput` with local styles, outside a short allowlist of layout-specific files (calendar grid, tile grids, line rows, nav chrome, debug tools). Status colours come from one palette, `INTENT_COLORS` in `@clientbridge/tokens`.
- **Every shared component** is a twin (`src/web/<Name>.tsx` and `src/mobile/<Name>.tsx`, same props) with its contract in `app-core/src/ui.ts`, its copy in `strings.ui` and its glyphs in `app-core/icons.ts`; colours come only from `@clientbridge/tokens`. Props use one vocabulary: `variant` (visual form), `layout` (how items are arranged), `size`, `density`, `intent` (status colour), `tone` (text colour of a figure or message), `label` (accessible name), `value`/`defaultValue`/`onChange` (controlled or not), `onPress`, `selected`/`pressed`/`disabled`/`busy`, and slots (`children`, `leading`, `trailing`, `actions`, `footer`, `icon`) rather than boolean flags. Web takes `className` and mobile `style` as an escape hatch merged last; focusable controls take `ref`. The structure check fails when either twin is missing.
- **One name per concept** across `app-core/src/domain/<concept>.ts`, `strings.<concept>`, the web page and the mobile screen (`hours.ts` · `strings.hours` · `Hours.tsx`). App-core stays flat: `domain/` plus `api`, `hooks`, `format`, `datetime`, `locale`, `ui`, `strings`, `zones`, `icons`, `debug` at the root. Mobile exports `XScreen` for navigator screens and a bare name for embedded sections.
- **Every feature's view-model is an app-core hook** — the form (`useXForm`: field state + validation + submit, built on the `useAsyncAction` primitive), the list (`useSearch`), the lifecycle actions, and the status→`Intent` decision. A new screen is thin rendering over a shared hook, never re-implemented glue (mirror `useBookingForm` / `useClientForm` / `useDocForm`).
- Reads = `useQuery` over the local replica (SQL lives in app-core); writes = shared fns taking `ApiLike` (each app builds its concrete `api` from `createSession`). The only platform seams are the **SQLite driver, the token store, and rendering**. Design tokens come from `@clientbridge/tokens` (one source → Tailwind theme + RN theme); per-platform token maps key off the neutral `Intent` type. No cross-platform UI framework (it would rewrite the idiomatic web UI to dedupe the cheapest layer).

## Copy and formatting
- Every user-facing UI string comes from the app catalog, `frontend/packages/app-core/locales/en-CA.json`.
  Each entry is keyed by concept (`"billing.overdueBy"`, the same group name as the app-core domain file)
  and holds an ICU message, an optional `description` for translators and, when the message takes values,
  its ordered `args`. `make gen-strings` checks the catalogs (ICU syntax, `args` against the placeholders,
  unused keys) and generates `src/strings.ts`, the `en-XA` pseudo-locale and Connect's `public/embed.js`, so
  edit the catalog and never those files. Screens and hooks render `strings.<domain>.<key>` (a string, or a
  function of the args) and never hold inline copy, including validation and error messages and shared
  labels (weekdays, nav, roles). Plurals are ICU `plural` messages, never `n === 1` checks; word order and
  punctuation live in a message, or in `formatParts`/`formatList` for lists of parts; catalog text is read
  inside a function or getter, never at module scope. Non-copy (SQL, class names, test ids, route and enum
  values, icon names) stays out. The marketing site has its own catalog, `apps/site/locales/en-CA.json`,
  generated the same way.
- Every displayed amount, number, percentage, date, time, range, list and duration goes through the
  formatter in app-core `format.ts` and `datetime.ts`. It reads the locale from `activeLocale()` and takes
  the currency and the time zone explicitly; staff screens and Connect show times in the business time zone
  (`useBusinessZone()`, the public payload's `timezone`), never the device's. Zone offsets come only from
  the backend's pinned `tzdata` through `core/zones.py`: `make gen-zones` writes app-core `zones.ts`,
  `GET /v1/zones` serves the same table, and `datetime.ts` formats in UTC after applying it, so no
  client's own zone data is used. Nothing else calls
  `toLocale*`, `new Intl.*`, `toFixed` for display or names a locale.
- Clients render an API error from its stable `error` code (`failureMessage(e, fallback)`); the response's
  `message` is English developer text and is never shown.
- `en-XA` (accented, bracketed, about 35% longer) is a development and test locale, never offered to
  users: `VITE_PSEUDO_LOCALE=1` on the web and Connect dev servers,
  `EXPO_PUBLIC_PSEUDO_LOCALE=1` in a mobile development build and `PSEUDO_LOCALE=1` on the backend.
- Backend text (email, SMS and push from the builders in `services/notifications.py`, CSV headers, tax
  names, client-visible Stripe text) comes from `backend/src/clientbridge/locales/en_CA.po` through
  `core/locale.py`: `locale_for(...)` picks the locale, `message` and `plural` read the catalog, and
  `format_money` and `format_day_and_time` format with Babel in the business time zone. `make gen-messages`
  regenerates `messages.pot` and `en_XA.po` and fails on missing, unused or empty messages.
- The gate holds this: the eslint rules `local/no-inline-ui-string`, `no-composed-copy`, `no-raw-format`,
  `no-hand-plural`, `no-module-scope-copy` and `no-error-message-copy` (`packages/config`; in rendering code
  `no-inline-ui-string` rejects any prose literal whose type is not a string-literal union, so identifiers
  such as routes and variants need one), the backend structure check (text reaching senders, CSV writers and
  stored or Stripe-visible descriptions through variables, `+=` and helper functions, plus any capitalized
  sentence outside a raise, docstring or OpenAPI description, since developer text starts in lowercase),
  `make codegen-check` on every generated
  catalog file, and the `en-XA` passes in `make test-web` and `make test-connect`.

## Testing — the feedback loop (`.docs/engineering.md`)
- **Integration-first**: `httpx` → real app → real Postgres. Unit-test pure logic only. Don't mock our code.
- **Transactional rollback per test** (`tests/conftest.py`): the seed is the baseline; every write rolls back.
- Boundary fakes (`FakeEmailSender`, `FakeOAuthVerifier`); auth clients `as_owner` / `as_staff` / `unauth`;
  factories (`Factory`).
- Every feature clears the 4-part matrix: **happy · each 4xx · security invariants · idempotency/edge**.
- Time comes only from `core/clock.py` (`clock.now()`, `clock.today(zone)`; `clock.wall()` only for an
  external clock such as the auth service, PowerSync tokens or webhook signatures). Pytest and vitest start at
  `FROZEN` (2026-10-13T17:00Z) over a database seeded at that instant; e2e suites stay at real time with
  dates derived from today.
- Tests and CI seed only the core demo businesses (`core=True` in `DEMO_BUSINESSES`, `make seed-core`);
  `make seed` and staging seed all of them, and the other editions are checked in memory.
- CI gate: `pytest --cov=clientbridge --cov-branch --cov-fail-under=90`.
- E2e files are named by concept; "Where an e2e test goes" in `.docs/engineering.md` says which file a test
  belongs in, and `check-structure.mjs` rejects any other name.

## Tooling — run the gate before "done"
- Backend: **ruff** (4-space · double quotes · line 100 · ANN bans `Any`) + **pyright strict**
  (`pyrightconfig.json`, pinned 1.1.408; no `Any`, and no `# noqa`, `# type: ignore` or `# pyright:`
  comments, nor `# fmt:`, `# isort:` or coverage `# pragma`: the structure check rejects them and ruff runs
  with `--ignore-noqa`). The structure check
  also fails if `pyrightconfig.json` leaves strict mode or turns off a rule beyond the four
  `reportUnknown*` rules and `reportMissingTypeStubs`.
  Frontend: eslint strictTypeChecked (`--max-warnings 0`, inline config ignored, JS and config files
  included) + tsc strict + prettier (4-space · double · 100). No `@ts-*`, `eslint-disable`,
  `prettier-ignore`, `istanbul`/`c8`/`biome` ignore or `tslint:` comments, and every tsconfig extends
  `tsconfig.base.json` without turning a strict flag off or excluding files: `check-structure.mjs` rejects
  both. Change a rule only in `packages/config/eslint.mjs`, scoped to its files.
- Gate: `make check` (lint + codegen-check + test); the pre-commit hook runs `make precommit`
  (format-check + the same gate). CI's jobs call the same make targets (`lint-backend`, `test-backend`,
  `lint-frontend`, `test-frontend`, `build-apps`, `lint-infra`, `test-infra`, `test-site`, `codegen-check`), so the two can't drift.
- **Milestone audit (do this at every slice/phase boundary, before starting the next).** Review the
  changeset against these principles and fix High/Medium findings *then*, not later: layering (thin
  router → service; routers never query; every tenant query goes through
  `scoped()` — never a hand-written `business_id` filter); the **5
  surfaces** (offline command vs
  command) chosen correctly; **role gates** match the typed command contract + the **4-part test matrix** is cleared
  (happy · each 4xx · security/tenant-isolation · idempotency); **web↔mobile duplication** (share the
  UI-agnostic data layer via `@clientbridge/app-core`, keep only rendering platform-specific); stray
  comments. The Catalog & Tax audit (2026-06-26) caught an unguarded REST write + a router running raw
  queries — exactly the class of thing this pass exists to catch.
- **Comments: sparing — the default is no comment.** We are not fans of extensive commenting; prefer self-documenting code (clear names) over prose. Add a comment *only* for a non-obvious *why* or an invariant, and keep it to one line. Never narrate *what* the code does, restate types, summarize a function the name already conveys, write multi-clause block/file-header comments, or add decorative `──── section ────` divider banners — split a file before it needs sign-posting. In the backend, `scripts/check_structure.py` (part of `make lint`)
  fails on a docstring or comment block longer than one line or a divider banner (in `src`, `tests` and
  `scripts`), a `*_service.py`/`*_jobs.py` file name, a folder deeper than `clientbridge/<layer>/<file>.py`,
  and a test file not named after a concept. In the frontend, `packages/config/scripts/check-structure.mjs` (part of `pnpm lint`)
  fails on a multi-line comment in any tracked JS/TS file, a lowercase component file, and a concept named differently across app-core, strings, web and mobile (pages named by their nav label map to their concept: Invoices → billing, Inbox → messaging, Team → staff, Schedule → bookings, Gift cards → entitlements, Onboarding → business), and a package export used only in its own file. `knip` (also
  in `pnpm lint`, config in `frontend/knip.json`) fails on unused files, dependencies and exports.
- Migrations live only in `backend/migrations/versions/` (timestamp-prefixed): one baseline
  (`20261010_000000_baseline.py`, squashed before launch) plus linear increments after it. Hand-written
  SQL that autogenerate can't see (the `btree_gist` extension, slot exclusion constraints, ledger
  triggers) lives in the migration, so add it there when a new one is needed. `make migrate` alone brings any
  local database to head.
- **Regenerate `api-client` (`make gen-api`) whenever the API contract changes**; `make gen-sync-schema`
  after model/sync-rule changes, `make gen-strings` after an app or site catalog edit, `make gen-messages`
  after a backend catalog edit and `make gen-zones` after a `tzdata` upgrade or a `core/zones.py` change (`make codegen-check` in the pre-commit hook, `make check` and CI fails on drift).
- Python import package = `clientbridge` (at `backend/src/clientbridge/`); the DB name + project are also `clientbridge`.

## Commands
`make up · migrate · seed · dev-api · dev-web · dev-mobile · gen-api · gen-sync-schema · gen-strings · gen-messages · test · lint · check`

## Docs (`.docs/`)
Keep only the documentation index and main docs at the root: **architecture** (system · data model ·
sync · authorization · frontend), **engineering** (gate · testing · shipping · ports · demo · conventions),
**launch-readiness** (launch work and deferred scope), **demo** (demo businesses, logins and what each shows), and **operations** (environments · secrets ·
providers · deploys · jobs · alerts · restore). Use `.docs/reviews/<area>/` for dated audits,
`.docs/explorations/<topic>/` for investigations, and `.docs/executions/<name>/` for each execution's plan,
task queue and progress; delete an execution's folder once it is implemented, after moving anything durable
into the main docs. Keep raw logs and temporary artifacts in `.scratchpad/`. Update links after
moves. See `.docs/README.md`; design system and IA remain in `.docs/design/app-explorer.html`.

## Tickets (Linear)
The launch plan is `.docs/launch-readiness.md` together with Linear's Launch QA initiative (workspace
`clientbridgeca`, team Engineering, key `CB`): 9 areas and 63 tickets, each one user outcome tested on its own.
Read "How tickets work" there before touching Linear. Don't create small tickets: work on a capability updates
the ticket that covers it (its steps, Automated by or To automate lines), and a failure stays on its ticket (back to In progress, then through review and staging again).
A new ticket is only for a new user outcome no ticket covers, agreed first. Change a ticket's text in the doc
first, then copy it to Linear word for word; status lives only in Linear.
