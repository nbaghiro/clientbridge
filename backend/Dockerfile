# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f backend/Dockerfile --target prod .
FROM ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 AS uv

FROM python:3.14.8-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS base
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app/backend/src \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/.python-version,target=.python-version \
    uv sync --frozen --no-dev --no-install-project

# Mount the repo at /app (docker run -v "$PWD:/app"); the venv stays in /opt/venv.
FROM base AS dev
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/.python-version,target=.python-version \
    uv sync --frozen --no-install-project
EXPOSE 8701
CMD ["uvicorn", "clientbridge.main:app", "--reload", "--reload-dir", "src", "--host", "0.0.0.0", "--port", "8701"]

FROM base AS prod
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/scripts ./scripts
COPY backend/src ./src
# scripts/gen_sync_schema.py reads it from the repo root, which is /app here
COPY infra/powersync/sync-rules.yaml /app/infra/powersync/sync-rules.yaml
# `make migrate`'s three steps, except that a database ahead of this image (a rollback) is left alone.
COPY --chmod=755 <<'EOF' /usr/local/bin/migrate
#!/bin/sh
set -eu
exec python -m scripts.migrate
EOF
USER 10001:10001
EXPOSE 8701
# The API reads X-Forwarded-For itself (core/ratelimit.py), so uvicorn leaves the client address alone.
CMD ["uvicorn", "clientbridge.main:app", "--host", "0.0.0.0", "--port", "8701", "--workers", "2", "--no-proxy-headers"]
