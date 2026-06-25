.PHONY: help up down install web-install dev-api dev-web dev-mobile migrate revision gen-api gen-sync-schema test lint typecheck format format-check check
.DEFAULT_GOAL := help

help:
	@echo "up / down      docker compose infra (postgres+powersync+redis+minio, 87xx ports)"
	@echo "install        uv sync (backend deps)"
	@echo "web-install    pnpm install (frontend deps)"
	@echo "dev-api        run FastAPI on :8701 (reload)"
	@echo "dev-web        run web (Vite) on :8700"
	@echo "dev-mobile     run mobile (Expo/Metro) on :8707"
	@echo "migrate        alembic upgrade head"
	@echo "revision       alembic autogenerate         (name=...)"
	@echo "gen-api        regenerate frontend api-client from backend OpenAPI"
	@echo "gen-sync-schema  regenerate PowerSync client schema from models + sync-rules"
	@echo "test           backend pytest + frontend tests"
	@echo "lint           ruff + mypy (backend) · eslint + tsc (frontend)"
	@echo "typecheck      mypy (backend) · tsc (frontend)"
	@echo "format         ruff format · prettier --write"
	@echo "format-check   ruff format --check · prettier --check"
	@echo "check          lint + test"

up:
	docker compose up -d

down:
	docker compose down

install:
	cd backend && uv sync

web-install:
	cd frontend && pnpm install

dev-api:
	cd backend && uv run uvicorn clientbridge.main:app --reload --port 8701

dev-web:
	cd frontend && pnpm --filter web dev --port 8700

dev-mobile:
	cd frontend && pnpm --filter mobile start -- --port 8707

migrate:
	cd backend && uv run alembic upgrade head

revision:
	cd backend && uv run alembic revision --autogenerate -m "$(name)"

gen-api:
	cd backend && uv run python -m clientbridge.scripts.export_openapi > ../frontend/packages/api-client/openapi.json
	cd frontend && pnpm --filter @clientbridge/api-client generate

gen-sync-schema:
	cd backend && uv run python -m clientbridge.scripts.gen_sync_schema
	cd frontend && pnpm exec prettier --write packages/sync/src/schema.ts

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm test

lint:
	cd backend && uv run ruff check . && uv run mypy src
	cd frontend && pnpm lint && pnpm typecheck

typecheck:
	cd backend && uv run mypy src
	cd frontend && pnpm typecheck

format:
	cd backend && uv run ruff format .
	cd frontend && pnpm format

format-check:
	cd backend && uv run ruff format --check .
	cd frontend && pnpm format:check

check: lint test
