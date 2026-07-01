# Clientbridge — repo conventions

Bilingual (EN/FR) all-in-one business OS for solo/small service providers (a PocketSuite analog).
Polyglot monorepo: `backend/` (Python · uv · FastAPI) · `frontend/` (pnpm + turbo: web + mobile) ·
`infra/` · `.docs/`.

## Commits
- **Single-line, concise, imperative subject. No body.** e.g. `Add Phase 1 auth: sessions, invites, OAuth`.
- Commit or push **only when asked**.

## Backend — layer-first, domain-as-filename
- Flow: `api/v1` (thin router + DTO, **never queries**) → `services` (logic, owns the
  transaction/commit) → `models`. Services own their queries and **always scope tenancy through
  `core/scoping.scoped(Model, business_id, soft_delete=…)`** (with `scoped_page`/`scoped_count` for
  list endpoints) — the one place the `business_id` (+ soft-delete) filter lives; never hand-write a
  `business_id` filter. Money / uniqueness / cross-tenant mutations additionally go through
  `run_command` (atomic + audited + idempotency-replay).
- **5 surfaces** — every capability is exactly one (see `.docs/backend-plan.md`): sync-read (PowerSync
  rules) · sync-write (`/sync/upload` + `WRITE_POLICY`) · command/RPC (FastAPI `POST`) · webhook/public ·
  job. A **server-only invariant** (uniqueness/numbering, capacity, money, secrets, cross-tenant) → a
  **command, NOT a sync write**.
- Data: prefixed-ULID PKs (`core/ids.py`) · integer cents + currency · text+CHECK enums (`enum_check`) ·
  `business_id` on scoped rows · `created_at/updated_at` · soft-delete `deleted_at`.
- Models declare **no `relationship()`s** → the unit-of-work can't FK-order inserts; **flush the parent
  before its FK-dependent children**.
- External services = an **adapter interface + `get_*` dependency** (e.g. `EmailSender`, `OAuthVerifier`);
  prod implements it, tests override with a recording fake.
- Server-only tables (`auth_*`) are **not** in `sync-rules.yaml` → excluded from the client AppSchema.

## Frontend — share the view-model, render per-platform
- Web (React/Vite/Tailwind) + mobile (Expo RN) share everything UI-agnostic via `@clientbridge/app-core`; only rendering, navigation, and platform APIs differ.
- **Every feature's view-model is an app-core hook** — the form (`useXForm`: field state + validation + submit, built on the `useAsyncAction` primitive), the list (`useSearch`), the lifecycle actions, and the status→`Intent` decision. A new screen is thin rendering over a shared hook, never re-implemented glue (mirror `useBookingForm` / `useClientForm` / `useDocForm`).
- Reads = `useQuery` over the local replica (SQL lives in app-core); writes = shared fns taking `ApiLike` (each app builds its concrete `api` from `createSession`). The only platform seams are the **SQLite driver, the token store, and rendering**. Design tokens come from `@clientbridge/tokens` (one source → Tailwind preset + RN theme); per-platform token maps key off the neutral `Intent` type. No cross-platform UI framework (it would rewrite the idiomatic web UI to dedupe the cheapest layer).

## Testing — the feedback loop (`.docs/testing.md`)
- **Integration-first**: `httpx` → real app → real Postgres. Unit-test pure logic only. Don't mock our code.
- **Transactional rollback per test** (`tests/conftest.py`): the seed is the baseline; every write rolls back.
- Boundary fakes (`FakeEmailSender`, `FakeOAuthVerifier`); auth clients `as_owner` / `as_staff` / `unauth`;
  factories (`Factory`).
- Every feature clears the 4-part matrix: **happy · each 4xx · security invariants · idempotency/edge**.
- CI gate: `pytest --cov=clientbridge --cov-branch --cov-fail-under=90`.

## Tooling — run the gate before "done"
- Backend: **ruff** (4-space · double quotes · line 100 · ANN bans `Any`) + **mypy strict** (no `Any`).
  Frontend: eslint strictTypeChecked + tsc strict + prettier (4-space · double · 100).
- Gate: `ruff check . && ruff format --check . && mypy src scripts tests && pytest --cov…`.
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
- **Comments: sparing — the default is no comment.** We are not fans of extensive commenting; prefer self-documenting code (clear names) over prose. Add a comment *only* for a non-obvious *why* or an invariant, and keep it to one line. Never narrate *what* the code does, restate types, summarize a function the name already conveys, write multi-clause block/file-header comments, or add decorative `──── section ────` divider banners — split a file before it needs sign-posting.
- Migrations live only in `backend/migrations/versions/` (timestamp-prefixed).
- **Regenerate `api-client` (`make gen-api`) whenever the API contract changes**; `make gen-sync-schema`
  after model/sync-rule changes (CI has a drift gate).
- Python import package = `clientbridge` (at `backend/src/clientbridge/`); the DB name + project are also `clientbridge`.

## Commands
`make up · migrate · seed · dev-api · dev-web · dev-mobile · gen-api · gen-sync-schema · test · lint · check`

## Docs (`.docs/`)
architecture · data-model · schema · sync · authorization · backend-plan · testing · repo-structure · ports · code-style · demo.
