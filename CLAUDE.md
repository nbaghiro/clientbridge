# Clientbridge — repo conventions

All-in-one business OS for solo/small service providers. All user-facing copy is centralized in one
place (see **Copy**).
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
- `models` = tables, `schemas` = API shapes; a column reaches the API only through a schema.
- Flow: `api` (thin router + DTO, **never queries**) → `services` (logic, owns the
  transaction/commit) → `models`. Services own their queries and **always scope tenancy through
  `core/scoping.scoped(Model, business_id, soft_delete=…)`** — the one place the `business_id` (+ soft-delete) filter lives; never hand-write a
  `business_id` filter. Money / uniqueness / cross-tenant mutations additionally go through
  `run_command` (atomic + audited + idempotency-replay).
- **5 surfaces** — every capability is exactly one (see `.docs/architecture.md`): sync-read (PowerSync
  rules) · offline command (durable local-only outbox → typed `/v1` command) · command/RPC (FastAPI `POST`) · webhook/public ·
  job. A **server-only invariant** (uniqueness/numbering, capacity, money, secrets, cross-tenant) → a
  **command, NOT a sync write**.
- **Role gates** live where the method lives: the service method that does the work gates itself with
  `assert_role(self.principal, …, message=…)` (`core/deps`), because jobs and public flows call services
  too. A router gates only when it has no service to call. Use `is_manager(role)` for a bare role
  string; never hand-write a role tuple check.
- Data: prefixed-ULID PKs (`core/ids.py`) · integer cents + currency · text+CHECK enums (`enum_check`) ·
  `business_id` on scoped rows · `created_at/updated_at` · soft-delete `deleted_at`.
- **Money balances live only in the ledger** (`services/ledger.py`): every money movement posts a
  balanced, append-only journal through `ledger.post` (idempotent on `ref`). Never add a stored balance /
  amount-paid / fee column; derive it from `accounts` + `entries`.
- Models declare **no `relationship()`s** → the unit-of-work can't FK-order inserts; **flush the parent
  before its FK-dependent children**.
- External services = an **adapter interface + `get_*` dependency** (e.g. `EmailSender`, `OAuthVerifier`);
  prod implements it, tests override with a recording fake.
- Server-only tables (`sessions`, `tokens`, `commands`, `webhooks`, `audits`) are **not** in `sync-rules.yaml` → excluded from the client AppSchema.

## Frontend — share the view-model, render per-platform
- Web (React/Vite/Tailwind) + mobile (Expo RN) share everything UI-agnostic via `@clientbridge/app-core`; only rendering, navigation, and platform APIs differ.
- **Shared components** live in one package, `@clientbridge/ui`: `src/web/` (DOM + Tailwind, used by web and Connect) and `src/mobile/` (React Native) each implement the props from `app-core/src/ui.ts` under the same file name (`ListPage`, `DetailView`, `Modal`, `Tabs`, `Empty`, `Money`, `ChargeSheet`, `CardForm`…). Every app imports `@clientbridge/ui`; the `react-native` export condition gives mobile the native entry. This is not a cross-platform UI framework: each platform keeps its own idiomatic rendering, the two just live side by side. App screens compose these components and never hand-style a control: buttons, fields, selects, toggles, choices, notices, panels, loading/empty states, badges, stats, stars, steppers, confirm dialogs and page headers all come from `@clientbridge/ui`, and the frontend structure check fails on a raw `<button>`/`<input>`/`<select>`/`<textarea>` with a `className`, or a `Pressable`/`TextInput` with local styles, outside a short allowlist of layout-specific files (calendar grid, tile grids, line rows, nav chrome, debug tools). Status colours come from one palette, `INTENT_COLORS` in `@clientbridge/tokens`.
- **Every shared component** is a twin (`src/web/<Name>.tsx` and `src/mobile/<Name>.tsx`, same props) with its contract in `app-core/src/ui.ts`, its copy in `strings.ui` and its glyphs in `app-core/icons.ts`; colours come only from `@clientbridge/tokens`. Props use one vocabulary: `variant` (visual form), `layout` (how items are arranged), `size`, `density`, `intent` (status colour), `tone` (text colour of a figure or message), `label` (accessible name), `value`/`defaultValue`/`onChange` (controlled or not), `onPress`, `selected`/`pressed`/`disabled`/`busy`, and slots (`children`, `leading`, `trailing`, `actions`, `footer`, `icon`) rather than boolean flags. Web takes `className` and mobile `style` as an escape hatch merged last; focusable controls take `ref`. Each component has a story in `apps/playground/src/stories/<Name>.tsx` (`make dev-playground`, :8712); the structure check fails without the twin or the story.
- **One name per concept** across `app-core/src/domain/<concept>.ts`, `strings.<concept>`, the web page and the mobile screen (`hours.ts` · `strings.hours` · `Hours.tsx`). App-core stays flat: `domain/` plus `api`, `hooks`, `format`, `datetime`, `ui`, `strings`, `icons`, `debug` at the root. Mobile exports `XScreen` for navigator screens and a bare name for embedded sections.
- **Every feature's view-model is an app-core hook** — the form (`useXForm`: field state + validation + submit, built on the `useAsyncAction` primitive), the list (`useSearch`), the lifecycle actions, and the status→`Intent` decision. A new screen is thin rendering over a shared hook, never re-implemented glue (mirror `useBookingForm` / `useClientForm` / `useDocForm`).
- Reads = `useQuery` over the local replica (SQL lives in app-core); writes = shared fns taking `ApiLike` (each app builds its concrete `api` from `createSession`). The only platform seams are the **SQLite driver, the token store, and rendering**. Design tokens come from `@clientbridge/tokens` (one source → Tailwind theme + RN theme); per-platform token maps key off the neutral `Intent` type. No cross-platform UI framework (it would rewrite the idiomatic web UI to dedupe the cheapest layer).

## Copy — one catalog
- **Every user-facing UI string lives in `frontend/packages/app-core/src/strings.ts`** — a single
  `strings` object grouped by concept (the same name as the app-core domain file), shared by web + mobile. Screens/components render
  `strings.<domain>.<key>` (values are literals or functions for interpolation) and **never hold inline
  copy**. This includes validation/error messages and shared descriptor labels (weekdays, nav, roles,
  recurrence, account fields) that used to sit inline in the app-core view-model hooks. Non-copy — SQL,
  class names, test ids, route/enum values, icon names — stays out.
- **Backend notification copy** is the server-side equivalent: the builder functions in
  `services/notifications.py` return `(subject, body[, push])` per event, all in one place.

## Testing — the feedback loop (`.docs/engineering.md`)
- **Integration-first**: `httpx` → real app → real Postgres. Unit-test pure logic only. Don't mock our code.
- **Transactional rollback per test** (`tests/conftest.py`): the seed is the baseline; every write rolls back.
- Boundary fakes (`FakeEmailSender`, `FakeOAuthVerifier`); auth clients `as_owner` / `as_staff` / `unauth`;
  factories (`Factory`).
- Every feature clears the 4-part matrix: **happy · each 4xx · security invariants · idempotency/edge**.
- CI gate: `pytest --cov=clientbridge --cov-branch --cov-fail-under=90`.

## Tooling — run the gate before "done"
- Backend: **ruff** (4-space · double quotes · line 100 · ANN bans `Any`) + **mypy strict** (no `Any`).
  Frontend: eslint strictTypeChecked + tsc strict + prettier (4-space · double · 100).
- Gate: `make check` (lint + codegen-check + test). CI's jobs call the same make targets
  (`lint-backend`, `test-backend`, `lint-frontend`, `test-frontend`, `build`, `test-site`, `codegen-check`), so
  the two can't drift.
- **Milestone audit (do this at every slice/phase boundary, before starting the next).** Review the
  changeset against these principles and fix High/Medium findings *then*, not later: layering (thin
  router → service; routers never query; every tenant query goes through
  `scoped()` — never a hand-written `business_id` filter); the **5
  surfaces** (sync-write vs
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
  (`20261005_000000_baseline.py`, squashed before launch) plus linear increments after it. Hand-written
  SQL that autogenerate can't see (the `btree_gist` extension, slot exclusion constraints, ledger
  triggers) lives in the migration, so add it there when a new one is needed. `make migrate` alone brings any
  local database to head; the baseline keeps the last pre-squash revision id so older databases upgrade too.
- **Regenerate `api-client` (`make gen-api`) whenever the API contract changes**; `make gen-sync-schema`
  after model/sync-rule changes (`make codegen-check` in the pre-commit hook, `make check` and CI fails on drift).
- Python import package = `clientbridge` (at `backend/src/clientbridge/`); the DB name + project are also `clientbridge`.

## Commands
`make up · migrate · seed · dev-api · dev-web · dev-mobile · gen-api · gen-sync-schema · test · lint · check`

## Docs (`.docs/`)
Keep only the documentation index and main docs at the root: **architecture** (system · data model ·
sync · authorization · frontend), **engineering** (gate · testing · shipping · ports · demo · conventions),
and **launch-readiness** (launch work and deferred scope). Use `.docs/reviews/<area>/` for dated audits,
`.docs/explorations/<topic>/` for investigations, and `.docs/executions/<name>/` for each execution's plan,
task queue and progress. Keep raw logs and temporary artifacts in `.scratchpad/`. Update links after
moves. See `.docs/README.md`; design system and IA remain in `.docs/design/app-explorer.html`.
