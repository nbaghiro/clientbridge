# Clientbridge — repo conventions

Canada-first, bilingual (EN/FR) all-in-one business OS for solo/small service providers (a PocketSuite
analog). Polyglot monorepo: `backend/` (Python · uv · FastAPI) · `frontend/` (pnpm + turbo: web +
mobile) · `infra/` · `.docs/`.

## Commits
- **Single-line, concise, imperative subject. No body.** e.g. `Add Phase 1 auth: sessions, invites, OAuth`.
- End every commit message with this trailer (after a blank line):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Commit or push **only when asked**.

## Backend — layer-first, domain-as-filename
- Flow: `api/v1` (thin router + DTO) → `services` (logic, owns the transaction/commit) →
  `repositories` (the base repo enforces `business_id` scoping + soft-delete) → `models`.
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
- Migrations live only in `backend/migrations/versions/` (timestamp-prefixed).
- **Regenerate `api-client` (`make gen-api`) whenever the API contract changes**; `make gen-sync-schema`
  after model/sync-rule changes (CI has a drift gate).
- Python import package = `clientbridge` (at `backend/src/clientbridge/`); the DB name + project are also `clientbridge`.

## Commands
`make up · migrate · seed · dev-api · dev-web · dev-mobile · gen-api · gen-sync-schema · test · lint · check`

## Docs (`.docs/`)
architecture · data-model · schema · sync · authorization · backend-plan · testing · repo-structure · ports · code-style · demo.
