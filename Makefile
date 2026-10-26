.PHONY: infra-bootstrap infra-providers infra-mobile help up down images up-app logs-sync logs-auth install stripe-listen stripe-setup dev-api worker dev-web dev-connect dev-site dev-mobile build build-apps build-site test-site test-web test-connect test-mobile test-staging-smoke lighthouse-site migrate revision seed seed-core gen-api gen-sync-schema gen-themes gen-messages gen-strings gen-zones gen-taxes codegen-check test test-backend test-frontend test-contract test-auth test-e2e lint lint-backend lint-frontend lint-infra test-infra typecheck format format-check format-check-backend format-check-frontend format-check-infra precommit hooks check gen-waitlist-email preview-emails configure-demo-admin dev-admin
.DEFAULT_GOAL := help

help:
	@echo "up / down        docker compose infra (postgres, powersync, auth, mailpit, redis, s3 on 87xx ports)"
	@echo "infra-bootstrap  PROJECT=… BILLING=…: create the Google Cloud project, its Pulumi state and the cloud stack"
	@echo "infra-providers  PROJECT=… ENV=staging: set up the environment's providers from .env.<ENV>"
	@echo "infra-mobile     PROJECT=… ENV=staging: set up the environment's app on EAS, Firebase, Apple and Play"
	@echo "images           build the backend and web prod images (backend/Dockerfile, frontend/Dockerfile)"
	@echo "up-app           run the prod images on the local infra: API on :8750, web on :8751 (profile app)"
	@echo "logs-sync        follow the PowerSync logs"
	@echo "logs-auth        follow the auth service logs (verification and recovery mail is on :8715)"
	@echo "install          uv sync (backend) and pnpm install (frontend)"
	@echo "stripe-listen    forward our Stripe webhook events to the local API (sandbox only)"
	@echo "stripe-setup     plan the Stripe sandbox objects the demo needs (ARGS=--apply to create)"
	@echo "dev-api          run FastAPI on :8701 (reload)"
	@echo "worker           run the arq job worker"
	@echo "dev-web          run web (Vite) on :8700"
	@echo "dev-connect      run Connect, the client pages (Vite), on :8709"
	@echo "dev-admin        run the platform admin app on :8711"
	@echo "configure-demo-admin  grant the seeded Hannah account development-only platform access"
	@echo "dev-site         run the marketing site (Vite) on :8710"
	@echo "dev-mobile       run mobile (Expo/Metro) on :8707"
	@echo "build            build every frontend app and package"
	@echo "build-apps       build every frontend app but the marketing site (what CI's build job runs)"
	@echo "build-site       build the marketing site to static HTML in frontend/apps/site/dist"
	@echo "test-site        build the site, then the browser pass (links, images, phone width, a11y)"
	@echo "test-tier        start or check the shared test tier every suite and e2e run uses (:8760-8769)"
	@echo "test-tier-reset  rebuild the shared test tier from scratch"
	@echo "test-tier-logs   print every test tier service's log"
	@echo "test-web         the web lane on the test tier (ARGS adds runner options, e.g. --project pseudo)"
	@echo "test-connect     the Connect lane on the test tier: booking, manage link, shop, client pages"
	@echo "test-functional  any lane on the test tier, isolated by its own namespace (FUNCTIONAL_ARGS)"
	@echo "test-stripe-browser  isolated sandbox checkout (STRIPE_BROWSER_ARGS selects credentials mode)"
	@echo "test-flakes      a functional lane shuffled by FLAKE_SEED and repeated FLAKE_REPEAT times; fails on any flake"
	@echo "test-mutations   break a few invariants in a throwaway worktree and require their cases to fail"
	@echo "test-mobile      the native lane on a started device (PLATFORM=ios|android DEVICE=<id>; build it first)"
	@echo "test-sync        sync streams on the test tier: replica rows per role, revocation, key rotation"
	@echo "replication-health  local PowerSync readiness, slot, retained WAL and replay lag"
	@echo "lighthouse-site  Lighthouse budget against the site preview on :8710"
	@echo "migrate          alembic upgrade head"
	@echo "revision         alembic autogenerate (name=...)"
	@echo "seed             replace the demo businesses' rows; other tenants are kept"
	@echo "seed-core        the same with only the core businesses that tests and CI run against"
	@echo "gen-api          regenerate the frontend api-client from the backend OpenAPI"
	@echo "gen-sync-schema  regenerate the PowerSync client schema from models + sync streams"
	@echo "gen-themes       regenerate the theme tokens from .docs/design/app-explorer.html"
	@echo "gen-messages     regenerate the backend messages.pot and en_XA.po from the code and en_CA.po"
	@echo "preview-emails   render every email design with demo data into .scratchpad/emails"
	@echo "gen-waitlist-email write the waitlist confirmation the site server sends, from the email layout"
	@echo "gen-strings      regenerate the strings accessors, en-XA pseudo-locales and Connect's embed.js"
	@echo "gen-zones        regenerate the frontend's zone table and parity cases from the backend tzdata"
	@echo "gen-taxes        regenerate the frontend's tax rate table and engine parity cases from the backend"
	@echo "codegen-check    regenerate client, sync schema, themes, messages and strings; fail if stale"
	@echo "test             test-backend + test-frontend"
	@echo "test-backend     pytest with the 90% branch-coverage gate, on a freshly seeded database of its own"
	@echo "test-frontend    the frontend unit tests, with app-core again in three time zones"
	@echo "test-contract    real StripeGateway vs the test tier's stripe-mock"
	@echo "test-auth        KratosIdentityProvider vs the test tier's auth service"
	@echo "test-e2e         Stripe and Resend test-mode flows (needs STRIPE_TEST_SECRET_KEY, RESEND_TEST_API_KEY and RESEND_TEST_FROM)"
	@echo "lint             lint-backend + lint-frontend"
	@echo "lint-backend     ruff, pyright and the structure check"
	@echo "lint-frontend    eslint, the structure check, tsc and the site copy rules"
	@echo "typecheck        pyright (backend) and tsc (frontend)"
	@echo "format           ruff format and prettier --write"
	@echo "format-check     ruff format --check and prettier --check"
	@echo "precommit        format-check + lint + codegen-check + test (the pre-commit hook; e2e runs in CI)"
	@echo "hooks            install the versioned hooks (.githooks)"
	@echo "check            lint + codegen-check + test (the full local gate; CI runs the same targets)"

up:
	docker compose up -d --wait --wait-timeout 60 postgres
	cd backend && uv run python -m scripts.db_access roles
	docker compose up -d
	docker compose up -d --wait --wait-timeout 120 auth
	@echo "infra up. PowerSync on :8704, auth on :8713, Mailpit on :8715 (run 'make migrate seed' if the DB is fresh)."

down:
	docker compose down

images:
	docker compose --profile app build migrate web

# The prod images against the local services; the migrate service runs `make migrate`'s three steps first.
up-app:
	docker compose --profile app up --build

logs-sync:
	docker compose logs -f powersync

logs-auth:
	docker compose logs -f auth

install:
	cd backend && uv sync
	cd frontend && pnpm install

stripe-listen:
	cd backend && uv run python -m scripts.stripe_setup --listen

stripe-setup:
	cd backend && uv run python -m scripts.stripe_setup $(ARGS)

dev-api:
	cd backend && uv run uvicorn clientbridge.main:app --reload --port 8701

worker:
	cd backend && uv run arq clientbridge.tasks.worker.WorkerSettings

dev-web:
	cd frontend && pnpm --filter web dev --port 8700

configure-demo-admin:
	cd backend && uv run python -m scripts.configure_demo_admin

dev-admin:
	cd frontend && pnpm --filter admin dev

dev-connect:
	cd frontend && pnpm --filter connect dev

dev-site:
	cd frontend && pnpm --filter site dev

build:
	cd frontend && pnpm build

build-apps:
	cd frontend && pnpm exec turbo run build --filter='!site'

build-site:
	cd frontend && pnpm --filter site build

# The site's browser pass (every page, links, images, phone width, accessibility) on a fresh build.
test-site:
	cd frontend && pnpm --filter site build && pnpm --filter site e2e

# The shared test tier every suite and e2e run uses: its own compose project on :8760-8769.
.PHONY: test-tier test-tier-reset test-tier-logs
test-tier:
	cd backend && uv run python -m scripts.tier up

test-tier-reset:
	cd backend && uv run python -m scripts.tier reset

test-tier-logs:
	docker compose -p clientbridge-test logs --no-color --timestamps

.PHONY: test-functional
test-functional:
	cd backend && uv run python -m scripts.e2e_stack $(FUNCTIONAL_ARGS)

FLAKE_REPEAT ?= 3
FLAKE_SEED ?= $(shell date +%s)
FLAKE_ARGS ?= --surface web

# Measures flakes, never qualifies a lane: the report is in the run's flakes.json.
.PHONY: test-flakes
test-flakes:
	cd backend && uv run python -m scripts.e2e_stack --repeat-each $(FLAKE_REPEAT) --shuffle-seed $(FLAKE_SEED) $(FLAKE_ARGS)

# Works on a committed revision in a temporary worktree, so the checkout is never changed.
.PHONY: test-mutations
test-mutations:
	cd backend && uv run python -m scripts.e2e_mutations $(MUTATION_ARGS)

test-web:
	cd backend && uv run python -m scripts.e2e_stack --surface web $(ARGS)

test-connect:
	cd backend && uv run python -m scripts.e2e_stack --surface connect $(ARGS)

# Lighthouse budget (desktop >= 95 per category); needs the built site served on :8710 (make dev-site
# serves source, so run `cd frontend && pnpm --filter site preview` first).
lighthouse-site:
	cd frontend && pnpm --filter site lighthouse

dev-mobile:
	cd frontend && pnpm --filter mobile start -- --port 8707

# The e2e build comes first: make test-functional FUNCTIONAL_ARGS="--build-native ios".
test-mobile:
	@test -n "$(PLATFORM)" -a -n "$(DEVICE)" || { echo "usage: make test-mobile PLATFORM=ios|android DEVICE=<id>"; exit 1; }
	cd backend && uv run python -m scripts.e2e_stack --surface native --platform $(PLATFORM) --device $(DEVICE) $(ARGS)

migrate:
	cd backend && uv run python -m scripts.db_access roles
	cd backend && uv run alembic upgrade head
	cd backend && uv run python -m scripts.db_access grants

revision:
	cd backend && uv run alembic revision --autogenerate -m "$(name)"

seed:
	cd backend && uv run python -m scripts.seed_demo --prune-logins

seed-core:
	cd backend && uv run python -m scripts.seed_demo --core

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

preview-emails:
	cd backend && uv run python -m scripts.preview_emails $(ARGS)

gen-waitlist-email:
	cd backend && uv run python -m scripts.gen_waitlist_email
	cd frontend && pnpm exec prettier --write apps/site/server/waitlist-email.json

gen-zones:
	cd backend && uv run python -m scripts.gen_zones
	cd frontend && pnpm exec prettier --write packages/app-core/src/zones.ts \
		packages/app-core/src/zones.cases.json

gen-taxes:
	cd backend && uv run python -m scripts.gen_taxes
	cd frontend && pnpm exec prettier --write packages/app-core/src/taxRates.ts \
		packages/app-core/src/taxes.cases.json

gen-strings:
	node frontend/packages/config/scripts/gen-strings.mjs
	cd frontend && pnpm exec prettier --write packages/app-core/src/strings.ts \
		packages/app-core/locales/en-XA.json apps/site/src/strings.ts apps/site/locales/en-XA.json \
		apps/connect/public/embed.js

test: test-backend test-frontend test-infra

test-backend:
	cd backend && uv run python -m scripts.fresh_database \
		pytest --cov=clientbridge --cov-branch --cov-fail-under=90 -q

# App-core runs again in three time zones, since displays must follow the business zone, not the device's.
test-frontend:
	cd frontend && pnpm test
	cd frontend && for tz in America/Vancouver America/Halifax Asia/Tokyo; do \
		TZ=$$tz pnpm --filter @clientbridge/app-core test || exit 1; done

# Contract tier: real StripeGateway vs the OpenAPI mock; skips locally and fails in CI when it is down.
test-contract:
	cd backend && uv run python -m scripts.fresh_database pytest -m contract -q

# Contract tier: the real KratosIdentityProvider vs the local auth service; skips locally, fails in CI when it is down.
test-auth:
	cd backend && uv run python -m scripts.fresh_database pytest -m kratos -q

# E2E tier: real Stripe test mode. Skips unless STRIPE_TEST_SECRET_KEY is exported.
test-e2e:
	cd backend && uv run pytest -m e2e -q

.PHONY: test-stripe-qa
# Real sandbox API flows; missing prerequisites and skipped tests fail this target.
test-stripe-qa:
	cd backend && uv run python -m scripts.stripe_qa $(STRIPE_QA_ARGS)

lint: lint-backend lint-frontend lint-infra

# One config at the repo root (pyrightconfig.json), shared with the editor.
PYRIGHT := PYRIGHT_PYTHON_IGNORE_WARNINGS=1 uv run pyright -p ../pyrightconfig.json

lint-backend:
	cd backend && uv run ruff check --ignore-noqa . && $(PYRIGHT) && uv run python -m scripts.check_structure

lint-frontend:
	cd frontend && pnpm lint && pnpm typecheck && pnpm --filter site lint:content

lint-infra:
	cd infra/pulumi && uv run ruff check --ignore-noqa . && PYRIGHT_PYTHON_IGNORE_WARNINGS=1 uv run pyright

test-infra:
	cd infra/pulumi && uv run pytest -q

typecheck:
	cd backend && $(PYRIGHT)
	cd frontend && pnpm typecheck

format:
	cd backend && uv run ruff format .
	cd infra/pulumi && uv run ruff format .
	cd frontend && pnpm format

format-check: format-check-backend format-check-frontend format-check-infra

format-check-backend:
	cd backend && uv run ruff format --check .

format-check-frontend:
	cd frontend && pnpm format:check

format-check-infra:
	cd infra/pulumi && uv run ruff format --check .

# The fast gate the pre-commit hook runs (no tests).
GENERATED := frontend/packages/api-client/src/generated.ts frontend/packages/sync/src/schema.ts \
	frontend/packages/tokens/src/themes.css frontend/packages/tokens/src/themes.ts \
	backend/src/clientbridge/locales/messages.pot backend/src/clientbridge/locales/en_XA.po \
	frontend/packages/app-core/src/strings.ts frontend/packages/app-core/locales/en-XA.json \
	frontend/apps/site/src/strings.ts frontend/apps/site/locales/en-XA.json \
	frontend/apps/site/server/waitlist-email.json \
	frontend/apps/connect/public/embed.js frontend/packages/app-core/src/zones.ts \
	frontend/packages/app-core/src/zones.cases.json frontend/packages/app-core/src/taxRates.ts \
	frontend/packages/app-core/src/taxes.cases.json

# Regenerates the client, sync schema, themes, messages, strings, zones and taxes; fails if any differ.
codegen-check: gen-api gen-sync-schema gen-themes gen-messages gen-strings gen-zones gen-taxes \
		gen-waitlist-email
	@git diff --quiet -- $(GENERATED) || { git --no-pager diff --stat -- $(GENERATED); \
		echo "generated files were stale and have been regenerated: review and stage them"; exit 1; }

precommit: format-check lint codegen-check test

# Point git at the versioned hooks (run once per clone).
hooks:
	git config core.hooksPath .githooks
	@echo "git hooks installed → .githooks (pre-commit = format-check + lint + codegen-check)"

check: lint codegen-check test

.PHONY: demo-check demo-snapshot

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

# The first deploy's infrastructure (.docs/operations.md, First deploy); each is safe to rerun.
infra-bootstrap:
	@test -n "$(PROJECT)" -a -n "$(BILLING)" || { echo "usage: make infra-bootstrap PROJECT=<id> BILLING=<account>"; exit 1; }
	cd infra/pulumi && uv run python bootstrap.py --project $(PROJECT) --billing-account $(BILLING)

infra-providers:
	@test -n "$(PROJECT)" -a -n "$(ENV)" || { echo "usage: make infra-providers PROJECT=<id> ENV=staging"; exit 1; }
	cd infra/pulumi && uv run python providers_init.py --env $(ENV) --project $(PROJECT) --env-file ../../.env.$(ENV)

infra-mobile:
	@test -n "$(PROJECT)" -a -n "$(ENV)" || { echo "usage: make infra-mobile PROJECT=<id> ENV=staging"; exit 1; }
	cd infra/pulumi && uv run python mobile_init.py --env $(ENV) --project $(PROJECT) --env-file ../../.env.$(ENV)

.PHONY: test-stripe-browser
test-stripe-browser:
	cd backend && uv run python -m scripts.e2e_stripe_stack $(STRIPE_BROWSER_ARGS)

# Read-only browser checks of a deployed environment (staging unless SMOKE_* say otherwise).
test-staging-smoke:
	cd frontend && pnpm --filter connect exec playwright test --config=playwright.smoke.config.ts $(SMOKE_ARGS)
