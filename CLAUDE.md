# Clientbridge — repo conventions

All-in-one business OS for solo/small service providers. All user-facing copy is centralized in one
place (see **Copy**).
Polyglot monorepo: `backend/` (Python · uv · FastAPI) · `frontend/` (pnpm + turbo: web + mobile) ·
`infra/` · `.docs/`.

## Commits
- **Single-line, concise, imperative subject. No body.** e.g. `Add Phase 1 auth: sessions, invites, OAuth`.
- Commit or push **only when asked**.

## Backend — layer-first, one file per concept
- **File naming:** `models/` is grouped by domain; every other layer (`api`, `schemas`, `services`, `tasks`,
  `tests`) holds one file per concept with the same plain plural name and no suffix (`api/bookings.py` →
  `schemas/bookings.py` → `services/bookings.py` → `tasks/bookings.py` → `tests/test_bookings.py`). A file
  may be long if it is one concept; split by concept, never by size. Folders stay one level deep.
- Flow: `api` (thin router + DTO, **never queries**) → `services` (logic, owns the
  transaction/commit) → `models`. Services own their queries and **always scope tenancy through
  `core/scoping.scoped(Model, business_id, soft_delete=…)`** (with `scoped_page`/`scoped_count` for
  list endpoints) — the one place the `business_id` (+ soft-delete) filter lives; never hand-write a
  `business_id` filter. Money / uniqueness / cross-tenant mutations additionally go through
  `run_command` (atomic + audited + idempotency-replay).
- **5 surfaces** — every capability is exactly one (see `.docs/architecture.md`): sync-read (PowerSync
  rules) · sync-write (`/sync/upload` + `WRITE_POLICY`) · command/RPC (FastAPI `POST`) · webhook/public ·
  job. A **server-only invariant** (uniqueness/numbering, capacity, money, secrets, cross-tenant) → a
  **command, NOT a sync write**.
- **Role gates** live in one of two places by shape: a router where *every* endpoint is admin-only
  gates once at the router (`require_role("owner","admin")` via an `AdminPrincipal` alias); a service
  whose methods *vary* in who may call them (e.g. POS order-create is staff, void is admin) gates
  per-method in the service via `assert_role(self.principal, …, message=…)` (`core/deps`). Don't
  hand-write `if principal.role not in (...)`.
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
- **Shared components** live in `@clientbridge/ui` (web + Connect) and `apps/mobile/src/ui` with the same props from `app-core/src/ui.ts` (`ListPage`, `DetailView`, `Modal`, `Empty`, `Money`, `ChargeSheet`, `CardForm`…); a screen composes them and never re-implements a list, detail, modal, checkout or card form.
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
- Gate: `ruff check . && ruff format --check . && mypy src scripts tests && python -m scripts.check_structure && pytest --cov…`.
- **Milestone audit (do this at every slice/phase boundary, before starting the next).** Review the
  changeset against these principles and fix High/Medium findings *then*, not later: layering (thin
  router → service; routers never query; every tenant query goes through
  `scoped()`/`scoped_page`/`scoped_count` — never a hand-written `business_id` filter); the **5
  surfaces** (sync-write vs
  command) chosen correctly; **role gates** match `WRITE_POLICY` + the **4-part test matrix** is cleared
  (happy · each 4xx · security/tenant-isolation · idempotency); **web↔mobile duplication** (share the
  UI-agnostic data layer via `@clientbridge/app-core`, keep only rendering platform-specific); stray
  comments. The Catalog & Tax audit (2026-06-26) caught an unguarded REST write + a router running raw
  queries — exactly the class of thing this pass exists to catch.
- **Comments: sparing — the default is no comment.** We are not fans of extensive commenting; prefer self-documenting code (clear names) over prose. Add a comment *only* for a non-obvious *why* or an invariant, and keep it to one line. Never narrate *what* the code does, restate types, summarize a function the name already conveys, write multi-clause block/file-header comments, or add decorative `──── section ────` divider banners — split a file before it needs sign-posting. In the backend, `scripts/check_structure.py` (part of `make lint`)
  fails on a docstring or comment block longer than one line, a `*_service.py`/`*_jobs.py` file name, and a
  folder deeper than `clientbridge/<layer>/<file>.py`. In the frontend, `packages/config/scripts/check-structure.mjs` (part of `pnpm lint`)
  fails on a multi-line comment, a lowercase component file, and a concept named differently across app-core, strings, web and mobile.
- Migrations live only in `backend/migrations/versions/` (timestamp-prefixed).
- **Regenerate `api-client` (`make gen-api`) whenever the API contract changes**; `make gen-sync-schema`
  after model/sync-rule changes (`make codegen-check` in the pre-commit hook, `make check` and CI fails on drift).
- Python import package = `clientbridge` (at `backend/src/clientbridge/`); the DB name + project are also `clientbridge`.

## Commands
`make up · migrate · seed · dev-api · dev-web · dev-mobile · gen-api · gen-sync-schema · test · lint · check`

## Docs (`.docs/`)
Three consolidated docs: **architecture** (system · data model · sync · authorization · frontend) ·
**engineering** (the gate · testing · shipping method · ports · demo · conventions) · **roadmap** (backlog ·
execution order · Connect), plus **launch-readiness** (the launch epics and stories tracked in Jira). Design system +
IA in `.docs/design/app-explorer.html` (screens · tokens · theme source).
