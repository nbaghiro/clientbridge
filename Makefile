.PHONY: help up down logs-sync install web-install dev-api dev-web dev-connect dev-mobile migrate revision seed gen-api gen-sync-schema gen-themes test test-contract test-e2e stripe-mock lint typecheck format format-check precommit hooks check worker
.DEFAULT_GOAL := help

help:
	@echo "up / down      docker compose infra (postgres+powersync+redis+minio, 87xx ports)"
	@echo "install        uv sync (backend deps)"
	@echo "web-install    pnpm install (frontend deps)"
	@echo "dev-api        run FastAPI on :8701 (reload)"
	@echo "dev-web        run web (Vite) on :8700"
	@echo "dev-connect    run Connect customer app (Vite) on :8709"
	@echo "dev-mobile     run mobile (Expo/Metro) on :8707"
	@echo "migrate        alembic upgrade head"
	@echo "revision       alembic autogenerate         (name=...)"
	@echo "seed           load the Birchbark Pet Studio demo business (idempotent)"
	@echo "gen-api        regenerate frontend api-client from backend OpenAPI"
	@echo "gen-sync-schema  regenerate PowerSync client schema from models + sync-rules"
	@echo "test           backend pytest + frontend tests"
	@echo "test-contract  real StripeGateway vs stripe-mock (starts it; auto-skips if down)"
	@echo "test-e2e       Stripe test-mode flows (needs STRIPE_TEST_SECRET_KEY)"
	@echo "stripe-mock    start the stripe-mock contract-test service on :8708"
	@echo "lint           ruff + mypy (backend) · eslint + tsc (frontend)"
	@echo "typecheck      mypy (backend) · tsc (frontend)"
	@echo "format         ruff format · prettier --write"
	@echo "format-check   ruff format --check · prettier --check"
	@echo "precommit      format-check + lint (the fast pre-commit gate)"
	@echo "hooks          install the versioned git hooks (.githooks)"
	@echo "check          lint + test (the full local CI gate)"

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

web-install:
	cd frontend && pnpm install

dev-api:
	cd backend && uv run uvicorn clientbridge.main:app --reload --port 8701

worker:
	cd backend && uv run arq clientbridge.tasks.worker.WorkerSettings

dev-web:
	cd frontend && pnpm --filter web dev --port 8700

dev-connect:
	cd frontend && pnpm --filter connect dev

dev-mobile:
	cd frontend && pnpm --filter mobile start -- --port 8707

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

test:
	cd backend && uv run pytest --cov=clientbridge --cov-branch --cov-fail-under=90 -q
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

lint:
	cd backend && uv run ruff check . && uv run mypy src scripts tests
	cd frontend && pnpm lint && pnpm typecheck

typecheck:
	cd backend && uv run mypy src scripts tests
	cd frontend && pnpm typecheck

format:
	cd backend && uv run ruff format .
	cd frontend && pnpm format

format-check:
	cd backend && uv run ruff format --check .
	cd frontend && pnpm format:check

# The fast gate the pre-commit hook runs (no tests).
precommit: format-check lint

# Point git at the versioned hooks (run once per clone).
hooks:
	git config core.hooksPath .githooks
	@echo "git hooks installed → .githooks (pre-commit = format-check + lint)"

check: lint test
