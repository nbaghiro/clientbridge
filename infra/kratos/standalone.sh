#!/usr/bin/env bash
# Kratos on the host network for CI jobs whose Postgres is a service container (not docker compose).
set -euo pipefail

image="oryd/kratos@sha256:2a13bb8d362c7a7ae33bd7c0f5168aee46921f15c916a06346db91c06dc76643"
config="$(cd "$(dirname "$0")" && pwd)"
dsn="postgres://kratos:${KRATOS_DB_PASSWORD:-kratos}@localhost:8702/kratos?sslmode=disable"

docker run --rm --network host -e DSN="$dsn" "$image" migrate sql up -e --yes
docker run -d --name kratos --network host \
    -v "$config:/etc/config/kratos:ro" \
    -e DSN="$dsn" \
    -e SERVE_PUBLIC_PORT=8713 \
    -e SERVE_ADMIN_PORT=8714 \
    -e SERVE_ADMIN_BASE_URL=http://localhost:8714/ \
    -e COURIER_SMTP_CONNECTION_URI="smtp://localhost:8716/?disable_starttls=true" \
    "$image" serve -c /etc/config/kratos/kratos.yml --dev
for _ in $(seq 1 60); do
    if curl -sf http://localhost:8714/admin/health/ready >/dev/null; then exit 0; fi
    sleep 1
done
docker logs kratos
exit 1
