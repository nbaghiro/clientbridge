#!/usr/bin/env bash
# The auth service (Ory Kratos) on the host network, for CI jobs whose Postgres is a service container.
set -euo pipefail

config="$(cd "$(dirname "$0")" && pwd)"
# The pin lives in docker-compose.yml only, so CI and local always run the same Kratos build.
image="$(docker compose -f "$config/../../docker-compose.yml" config --images | grep '^oryd/kratos@' | sort -u)"
dsn="postgres://auth:${AUTH_DB_PASSWORD:-auth}@localhost:8702/auth?sslmode=disable"

docker run --rm --network host -e DSN="$dsn" "$image" migrate sql up -e --yes
docker run -d --name auth --network host \
    -v "$config:/etc/config/auth:ro" \
    -e DSN="$dsn" \
    -e SERVE_PUBLIC_PORT=8713 \
    -e SERVE_ADMIN_PORT=8714 \
    -e SERVE_ADMIN_BASE_URL=http://localhost:8714/ \
    -e COURIER_HTTP_REQUEST_CONFIG_URL=http://localhost:8701/webhooks/auth-email \
    -e COURIER_HTTP_REQUEST_CONFIG_AUTH_CONFIG_VALUE="${AUTH_EMAIL_HOOK_SECRET:-clientbridge-dev-courier-secret-do-not-use-in-prod}" \
    -e SECRETS_COOKIE="${AUTH_COOKIE_SECRET:-clientbridge-dev-cookie-secret-do-not-use-in-prod}" \
    -e SECRETS_CIPHER="${AUTH_CIPHER_SECRET:-clientbridge-dev-cipher-key-0032}" \
    -e SELFSERVICE_METHODS_PASSWORD_CONFIG_HAVEIBEENPWNED_ENABLED=false \
    "$image" serve -c /etc/config/auth/kratos.yml --dev
for _ in $(seq 1 60); do
    if curl -sf http://localhost:8714/admin/health/ready >/dev/null; then exit 0; fi
    sleep 1
done
docker logs auth
exit 1
