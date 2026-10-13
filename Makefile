.PHONY: help up down logs-sync logs-auth install stripe-listen dev-api worker dev-web dev-connect dev-site dev-mobile build build-site test-site test-web test-connect test-mobile lighthouse-site migrate revision seed gen-api gen-sync-schema gen-themes gen-messages gen-strings gen-zones codegen-check test test-backend test-frontend test-contract test-kratos kratos-standalone test-e2e stripe-mock lint lint-backend lint-frontend typecheck format format-check format-check-backend format-check-frontend precommit hooks check
.DEFAULT_GOAL := help

help:
	@echo "up / down        docker compose infra (postgres, powersync, kratos, mailpit, redis, s3 on 87xx ports)"
	@echo "logs-sync        follow the PowerSync logs"
	@echo "logs-auth        follow the Kratos logs (verification and recovery mail is on :8715)"
	@echo "install          uv sync (backend) and pnpm install (frontend)"
	@echo "stripe-listen    forward Stripe Connect webhooks to the local API"
	@echo "dev-api          run FastAPI on :8701 (reload)"
	@echo "worker           run the arq job worker"
	@echo "dev-web          run web (Vite) on :8700"
	@echo "dev-connect      run Connect, the client pages (Vite), on :8709"
	@echo "dev-site         run the marketing site (Vite) on :8710"
	@echo "dev-mobile       run mobile (Expo/Metro) on :8707"
	@echo "build            build every frontend app and package"
	@echo "build-site       build the marketing site to static HTML in frontend/apps/site/dist"
	@echo "test-site        build the site, then the browser pass (links, images, phone width, a11y)"
	@echo "test-web         web smoke test: every page and dialog (needs the local stack + seed)"
	@echo "test-connect     Connect e2e: booking, manage link, shop and every client page (needs the API + seed)"
	@echo "test-mobile      Maestro native walkthroughs (needs a development build, local stack + seed)"
	@echo "test-sync        disposable Postgres + PowerSync: replica rows per role, revocation, key rotation"
	@echo "replication-health  local PowerSync readiness, slot, retained WAL and replay lag"
	@echo "lighthouse-site  Lighthouse budget against the site preview on :8710"
	@echo "migrate          alembic upgrade head"
	@echo "revision         alembic autogenerate (name=...)"
	@echo "seed             load the Birchbark Pet Studio demo business (idempotent)"
	@echo "gen-api          regenerate the frontend api-client from the backend OpenAPI"
	@echo "gen-sync-schema  regenerate the PowerSync client schema from models + sync streams"
	@echo "gen-themes       regenerate the theme tokens from .docs/design/app-explorer.html"
	@echo "gen-messages     regenerate the backend messages.pot and en_XA.po from the code and en_CA.po"
	@echo "gen-strings      regenerate the strings accessors, en-XA pseudo-locales and Connect's embed.js"
	@echo "gen-zones        regenerate the frontend's zone table and parity cases from the backend tzdata"
	@echo "codegen-check    regenerate client, sync schema, themes, messages and strings; fail if stale"
	@echo "test             test-backend + test-frontend"
	@echo "test-backend     pytest with the 90% branch-coverage gate, on a freshly seeded database of its own"
	@echo "test-frontend    the frontend unit tests, with app-core again in three time zones"
	@echo "test-contract    real StripeGateway vs stripe-mock (starts it; skips locally and fails in CI if it is down)"
	@echo "test-kratos      KratosIdentityProvider vs the local Kratos (skips locally and fails in CI if it is down)"
	@echo "kratos-standalone Kratos on the host network for CI (Postgres as a service container)"
	@echo "test-e2e         Stripe and Resend test-mode flows (needs STRIPE_TEST_SECRET_KEY, RESEND_TEST_API_KEY and RESEND_TEST_FROM)"
	@echo "stripe-mock      start the stripe-mock contract-test service on :8708"
	@echo "lint             lint-backend + lint-frontend"
	@echo "lint-backend     ruff, mypy and the structure check"
	@echo "lint-frontend    eslint, the structure check, tsc and the site copy rules"
	@echo "typecheck        mypy (backend) and tsc (frontend)"
	@echo "format           ruff format and prettier --write"
	@echo "format-check     ruff format --check and prettier --check"
	@echo "precommit        format-check + lint + codegen-check + test (the pre-commit hook; e2e runs in CI)"
	@echo "hooks            install the versioned hooks (.githooks)"
	@echo "check            lint + codegen-check + test (the full local gate; CI runs the same targets)"

up:
	docker compose up -d --wait --wait-timeout 60 postgres
	cd backend && uv run python -m scripts.db_access roles
	docker compose up -d
	docker compose up -d --wait --wait-timeout 120 kratos
	@echo "infra up. PowerSync on :8704, Kratos on :8713, Mailpit on :8715 (run 'make migrate seed' if the DB is fresh)."

down:
	docker compose down

logs-sync:
	docker compose logs -f powersync

logs-auth:
	docker compose logs -f kratos

install:
	cd backend && uv sync
	cd frontend && pnpm install

stripe-listen:
	stripe listen --forward-connect-to localhost:8701/webhooks/stripe

dev-api:
	cd backend && uv run uvicorn clientbridge.main:app --reload --port 8701

worker:
	cd backend && uv run arq clientbridge.tasks.worker.WorkerSettings

dev-web:
	cd frontend && pnpm --filter web dev --port 8700

dev-connect:
	cd frontend && pnpm --filter connect dev

dev-site:
	cd frontend && pnpm --filter site dev

build:
	cd frontend && pnpm build

build-site:
	cd frontend && pnpm --filter site build

# The site's browser pass (every page, links, images, phone width, accessibility) on a fresh build.
test-site:
	cd frontend && pnpm --filter site build && pnpm --filter site e2e

test-web:
	cd backend && uv run python -m scripts.web_fixtures
	cd frontend && pnpm --filter web e2e

test-connect:
	links="$$(cd backend && uv run python -m scripts.connect_links)" && \
		cd frontend && CONNECT_LINKS="$$links" pnpm --filter connect e2e

# Lighthouse budget (desktop >= 95 per category); needs the built site served on :8710 (make dev-site
# serves source, so run `cd frontend && pnpm --filter site preview` first).
lighthouse-site:
	cd frontend && pnpm --filter site lighthouse

dev-mobile:
	cd frontend && pnpm --filter mobile start -- --port 8707

test-mobile:
	cd frontend && pnpm --filter mobile e2e

migrate:
	cd backend && uv run python -m scripts.db_access roles
	cd backend && uv run alembic upgrade head
	cd backend && uv run python -m scripts.db_access grants

revision:
	cd backend && uv run alembic revision --autogenerate -m "$(name)"

seed:
	cd backend && uv run python -m scripts.seed_demo

gen-api:
	cd backend && uv run python -m scripts.export_openapi > ../frontend/packages/api-client/openapi.json
	cd frontend && pnpm --filter @clientbridge/api-client generate

gen-sync-schema:
	cd backend && uv run python -m scripts.gen_sync_schema
	cd frontend && pnpm exec prettier --write packages/sync/src/schema.ts

gen-themes:
	node frontend/packages/tokens/scripts/gen-themes.cjs
	cd frontend && pnpm exec prettier --write packages/tokens/src/themes.css packages/tokens/src/themes.ts

gen-messages:
	cd backend && uv run python -m scripts.gen_messages

gen-zones:
	cd backend && uv run python -m scripts.gen_zones
	cd frontend && pnpm exec prettier --write packages/app-core/src/zones.ts \
		packages/app-core/src/zones.cases.json

gen-strings:
	node frontend/packages/config/scripts/gen-strings.mjs
	cd frontend && pnpm exec prettier --write packages/app-core/src/strings.ts \
		packages/app-core/locales/en-XA.json apps/site/src/strings.ts apps/site/locales/en-XA.json \
		apps/connect/public/embed.js

test: test-backend test-frontend

test-backend:
	cd backend && uv run python -m scripts.fresh_database \
		pytest --cov=clientbridge --cov-branch --cov-fail-under=90 -q

# App-core runs again in three time zones, since displays must follow the business zone, not the device's.
test-frontend:
	cd frontend && pnpm test
	cd frontend && for tz in America/Vancouver America/Halifax Asia/Tokyo; do \
		TZ=$$tz pnpm --filter @clientbridge/app-core test || exit 1; done

stripe-mock:
	docker compose --profile test up -d stripe-mock
	@echo "stripe-mock on http://localhost:8708"

# Contract tier: real StripeGateway vs the OpenAPI mock; skips locally and fails in CI when it is down.
test-contract: stripe-mock
	cd backend && uv run pytest -m contract -q

# Contract tier: the real KratosIdentityProvider vs the local Kratos; skips locally and fails in CI when it is down.
test-kratos:
	cd backend && uv run pytest -m kratos -q

# CI only: Kratos without docker compose, for jobs whose Postgres is a service container.
kratos-standalone:
	./infra/kratos/standalone.sh

# E2E tier: real Stripe test mode. Skips unless STRIPE_TEST_SECRET_KEY is exported.
test-e2e:
	cd backend && uv run pytest -m e2e -q

lint: lint-backend lint-frontend

lint-backend:
	cd backend && uv run ruff check . && uv run mypy src scripts tests && uv run python -m scripts.check_structure

lint-frontend:
	cd frontend && pnpm lint && pnpm typecheck && pnpm --filter site lint:content

typecheck:
	cd backend && uv run mypy src scripts tests
	cd frontend && pnpm typecheck

format:
	cd backend && uv run ruff format .
	cd frontend && pnpm format

format-check: format-check-backend format-check-frontend

format-check-backend:
	cd backend && uv run ruff format --check .

format-check-frontend:
	cd frontend && pnpm format:check

# The fast gate the pre-commit hook runs (no tests).
GENERATED := frontend/packages/api-client/src/generated.ts frontend/packages/sync/src/schema.ts \
	frontend/packages/tokens/src/themes.css frontend/packages/tokens/src/themes.ts \
	backend/src/clientbridge/locales/messages.pot backend/src/clientbridge/locales/en_XA.po \
	frontend/packages/app-core/src/strings.ts frontend/packages/app-core/locales/en-XA.json \
	frontend/apps/site/src/strings.ts frontend/apps/site/locales/en-XA.json \
	frontend/apps/connect/public/embed.js frontend/packages/app-core/src/zones.ts \
	frontend/packages/app-core/src/zones.cases.json

# Regenerates the client, sync schema, themes, messages, strings and zones; fails if any differ.
codegen-check: gen-api gen-sync-schema gen-themes gen-messages gen-strings gen-zones
	@git diff --quiet -- $(GENERATED) || { git --no-pager diff --stat -- $(GENERATED); \
		echo "generated files were stale and have been regenerated: review and stage them"; exit 1; }

precommit: format-check lint codegen-check test

# Point git at the versioned hooks (run once per clone).
hooks:
	git config core.hooksPath .githooks
	@echo "git hooks installed → .githooks (pre-commit = format-check + lint + codegen-check)"

check: lint codegen-check test

.PHONY: demo-reset demo-check demo-snapshot

demo-reset:
	cd backend && uv run python -m scripts.seed_demo --reset-demo

demo-check:
	cd backend && uv run python -m scripts.demo_validate

demo-snapshot:
	cd backend && uv run python -m scripts.demo_snapshot

.PHONY: test-sync replication-health
test-sync:
	cd backend && uv run python -m scripts.verify_sync

# Readiness, an active replication slot, retained WAL (alert above 1 GiB) and lag (above 60 s).
replication-health:
	cd backend && uv run python -m scripts.replication_health
