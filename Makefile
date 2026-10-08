.PHONY: help up down logs-sync install stripe-listen dev-api worker dev-web dev-connect dev-site dev-playground dev-mobile build build-site test-site test-web test-connect test-playground test-mobile lighthouse-site migrate revision seed gen-api gen-sync-schema gen-themes codegen-check test test-backend test-frontend test-contract test-e2e stripe-mock lint lint-backend lint-frontend typecheck format format-check format-check-backend format-check-frontend precommit hooks check
.DEFAULT_GOAL := help

help:
	@echo "up / down        docker compose infra (postgres, powersync, redis, s3 on 87xx ports)"
	@echo "logs-sync        follow the PowerSync logs"
	@echo "install          uv sync (backend) and pnpm install (frontend)"
	@echo "stripe-listen    forward Stripe Connect webhooks to the local API"
	@echo "dev-api          run FastAPI on :8701 (reload)"
	@echo "worker           run the arq job worker"
	@echo "dev-web          run web (Vite) on :8700"
	@echo "dev-connect      run Connect, the client pages (Vite), on :8709"
	@echo "dev-site         run the marketing site (Vite) on :8710"
	@echo "dev-playground   run the component playground (Vite) on :8712"
	@echo "dev-mobile       run mobile (Expo/Metro) on :8707"
	@echo "build            build every frontend app and package"
	@echo "build-site       build the marketing site to static HTML in frontend/apps/site/dist"
	@echo "test-site        build the site, then the browser pass (links, images, phone width, a11y)"
	@echo "test-web         web smoke test: every page and dialog (needs the local stack + seed)"
	@echo "test-connect     Connect e2e: booking, manage link, shop and every client page (needs the API + seed)"
	@echo "test-playground  build the playground, then open every story on web, iPhone and Android"
	@echo "test-mobile      Maestro native walkthroughs (needs a development build, local stack + seed)"
	@echo "lighthouse-site  Lighthouse budget against the site preview on :8710"
	@echo "migrate          alembic upgrade head"
	@echo "revision         alembic autogenerate (name=...)"
	@echo "seed             load the Birchbark Pet Studio demo business (idempotent)"
	@echo "gen-api          regenerate the frontend api-client from the backend OpenAPI"
	@echo "gen-sync-schema  regenerate the PowerSync client schema from models + sync-rules"
	@echo "gen-themes       regenerate the theme tokens from .docs/design/app-explorer.html"
	@echo "codegen-check    regenerate client, sync schema and themes; fail if they were stale"
	@echo "test             test-backend + test-frontend"
	@echo "test-backend     pytest with the 90% branch-coverage gate"
	@echo "test-frontend    the frontend unit tests (app-core, site)"
	@echo "test-contract    real StripeGateway vs stripe-mock (starts it; auto-skips if down)"
	@echo "test-e2e         Stripe test-mode flows (needs STRIPE_TEST_SECRET_KEY)"
	@echo "stripe-mock      start the stripe-mock contract-test service on :8708"
	@echo "lint             lint-backend + lint-frontend"
	@echo "lint-backend     ruff, mypy and the structure check"
	@echo "lint-frontend    eslint, the structure check, tsc and the site copy rules"
	@echo "typecheck        mypy (backend) and tsc (frontend)"
	@echo "format           ruff format and prettier --write"
	@echo "format-check     ruff format --check and prettier --check"
	@echo "precommit        format-check + lint + codegen-check (the pre-commit hook)"
	@echo "hooks            install the versioned hooks (.githooks)"
	@echo "check            lint + codegen-check + test (the full local gate; CI runs the same targets)"

up:
	docker compose up -d postgres
	@echo "waiting for postgres..."; until docker compose exec -T postgres pg_isready -U clientbridge -d clientbridge >/dev/null 2>&1; do sleep 1; done
	@# PowerSync needs a WAL publication on the source DB + a separate bucket-storage DB (idempotent).
	-@docker compose exec -T postgres psql -U clientbridge -d clientbridge -c "CREATE PUBLICATION powersync FOR ALL TABLES;" 2>/dev/null || true
	-@docker compose exec -T postgres psql -U clientbridge -d postgres -c "CREATE DATABASE powersync_storage;" 2>/dev/null || true
	docker compose up -d
	@echo "infra up. PowerSync on :8704 (run 'make migrate seed' if the DB is fresh)."

down:
	docker compose down

logs-sync:
	docker compose logs -f powersync

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

dev-playground:
	cd frontend && pnpm --filter playground dev

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

# Every story page and phone frame on a fresh build, failing on any console error.
test-playground:
	cd frontend && pnpm --filter playground build && pnpm --filter playground e2e

# Lighthouse budget (desktop >= 95 per category); needs the built site served on :8710 (make dev-site
# serves source, so run `cd frontend && pnpm --filter site preview` first).
lighthouse-site:
	cd frontend && pnpm --filter site lighthouse

dev-mobile:
	cd frontend && pnpm --filter mobile start -- --port 8707

test-mobile:
	cd frontend && pnpm --filter mobile e2e

migrate:
	cd backend && uv run alembic upgrade head

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

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest --cov=clientbridge --cov-branch --cov-fail-under=90 -q

test-frontend:
	cd frontend && pnpm test

stripe-mock:
	docker compose --profile test up -d stripe-mock
	@echo "stripe-mock on http://localhost:8708"

# Contract tier: real StripeGateway vs the OpenAPI mock. Auto-skips if stripe-mock isn't reachable.
test-contract: stripe-mock
	cd backend && STRIPE_MOCK_URL=http://localhost:8708 uv run pytest -m contract -q

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
	frontend/packages/tokens/src/themes.css frontend/packages/tokens/src/themes.ts

# Regenerates the backend-derived client, sync schema and themes, and fails if any differ from git.
codegen-check: gen-api gen-sync-schema gen-themes
	@git diff --quiet -- $(GENERATED) || { git --no-pager diff --stat -- $(GENERATED); \
		echo "generated files were stale and have been regenerated: review and stage them"; exit 1; }

precommit: format-check lint codegen-check

# Point git at the versioned hooks (run once per clone).
hooks:
	git config core.hooksPath .githooks
	@echo "git hooks installed → .githooks (pre-commit = format-check + lint + codegen-check)"

check: lint codegen-check test

.PHONY: demo-seed demo-reset demo-check demo-snapshot

demo-seed: seed

demo-reset:
	cd backend && uv run python -m scripts.seed_demo --reset-demo

demo-check:
	cd backend && uv run python -m scripts.demo_validate

demo-snapshot:
	cd backend && uv run python -m scripts.demo_snapshot
