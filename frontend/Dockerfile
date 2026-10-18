# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f frontend/Dockerfile .
FROM node:24.21.0-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/.npmrc ./
RUN corepack install
COPY frontend ./
# The hoisted linker ignores --filter, so the mobile importer is dropped to skip its native packages.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    awk '/^  apps\/mobile:/{skip=1;next} skip&&/^(  )?[^ ]/{skip=0} !skip' pnpm-lock.yaml > /tmp/lock && \
    mv /tmp/lock pnpm-lock.yaml && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts
# The site ships static HTML, so it is built for a placeholder domain that `serve` replaces at start.
ARG BASE_DOMAIN=base.invalid
ARG VITE_API_URL=https://api.${BASE_DOMAIN}
ARG VITE_AUTH_URL=https://api.${BASE_DOMAIN}/auth
ARG VITE_POWERSYNC_URL=https://sync.${BASE_DOMAIN}
ARG VITE_PAY_URL=https://pay.${BASE_DOMAIN}
ARG VITE_STRIPE_PUBLISHABLE_KEY
ENV BASE_DOMAIN=base.invalid \
    VITE_SITE_URL=https://base.invalid \
    VITE_APP_URL=https://app.base.invalid \
    VITE_BOOK_URL=https://book.base.invalid \
    VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL \
    VITE_POWERSYNC_URL=$VITE_POWERSYNC_URL \
    VITE_PAY_URL=$VITE_PAY_URL
RUN pnpm exec turbo run build --concurrency=1 --filter=web --filter=connect --filter=site --filter=admin

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS prod
RUN addgroup -S -g 10001 web && adduser -S -D -H -u 10001 -G web web
# the image grants caddy cap_net_bind_service, which a pod that drops every capability cannot exec; :8080 needs none
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
COPY --from=build /app/frontend/apps/site/dist /srv/site
COPY --from=build /app/frontend/apps/web/dist /srv/web
COPY --from=build /app/frontend/apps/admin/dist /srv/admin
COPY --from=build /app/frontend/apps/connect/dist /srv/connect
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 <<'EOF' /usr/local/bin/serve
#!/bin/sh
set -eu
: "${BASE_DOMAIN:?set BASE_DOMAIN, for example clientbridge.ca}"
export ENVIRONMENT="${ENVIRONMENT:-development}"
export STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"
export CONTACT_UPSTREAM="${CONTACT_UPSTREAM:-http://api:8701}"
export SITE_HOST="${SITE_HOST:-$BASE_DOMAIN}"
export ADMIN_HOST="${ADMIN_HOST:-admin.$BASE_DOMAIN}"
export APP_HOST="${APP_HOST:-app.$BASE_DOMAIN}"
export BOOK_HOST="${BOOK_HOST:-book.$BASE_DOMAIN}"
export PAY_HOST="${PAY_HOST:-pay.$BASE_DOMAIN}"
export SHOP_HOST="${SHOP_HOST:-shop.$BASE_DOMAIN}"
export SITE_URL="${SITE_URL:-https://$SITE_HOST}"
export APP_URL="${APP_URL:-https://$APP_HOST}"
export ADMIN_URL="${ADMIN_URL:-https://$ADMIN_HOST}"
export BOOK_URL="${BOOK_URL:-https://$BOOK_HOST}"
export PAY_URL="${PAY_URL:-https://$PAY_HOST}"
# Empty means the app derives them from BASE_DOMAIN; the compose app profile sets local ones.
export API_URL="${API_URL:-}"
export AUTH_URL="${AUTH_URL:-}"
export SYNC_URL="${SYNC_URL:-}"
MOBILE_APP_ID="${MOBILE_APP_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
ANDROID_CERT_FINGERPRINTS="${ANDROID_CERT_FINGERPRINTS:-}"
# config.js and the association files quote these values as JSON strings
for value in "$APP_URL" "$ADMIN_URL" "$BASE_DOMAIN" "$API_URL" "$AUTH_URL" "$SYNC_URL" "$PAY_URL" "$BOOK_URL" "$STRIPE_PUBLISHABLE_KEY" \
             "$MOBILE_APP_ID" "$APPLE_TEAM_ID" "$ANDROID_CERT_FINGERPRINTS"; do
    case "$value" in *'"'* | *'\'*) echo "serve: $value holds a quote or a backslash" >&2; exit 1 ;; esac
done
# app.<base> vouches for the mobile app's passwords and passkeys; no link opens the app yet
rm -rf /tmp/well-known && mkdir -p /tmp/well-known
apps=""
if [ -n "$APPLE_TEAM_ID" ] && [ -n "$MOBILE_APP_ID" ]; then apps="\"$APPLE_TEAM_ID.$MOBILE_APP_ID\""; fi
printf '{"applinks":{"details":[]},"webcredentials":{"apps":[%s]}}\n' "$apps" \
    > /tmp/well-known/apple-app-site-association
fingerprints=$(printf '%s' "$ANDROID_CERT_FINGERPRINTS" | sed 's/[^,][^,]*/"&"/g')
if [ -n "$fingerprints" ] && [ -n "$MOBILE_APP_ID" ]; then
    printf '[{"relation":["delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":[%s]}}]\n' \
        "$MOBILE_APP_ID" "$fingerprints"
else
    printf '[]\n'
fi > /tmp/well-known/assetlinks.json
# The image filesystem may be read-only, so the site is rewritten into /tmp.
rm -rf /tmp/site && cp -R /srv/site /tmp/site
find /tmp/site -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' \) -exec sed -i \
    -e "s#https://app\.base\.invalid#$APP_URL#g" \
    -e "s#https://book\.base\.invalid#$BOOK_URL#g" \
    -e "s#https://base\.invalid#$SITE_URL#g" \
    -e "s#base\.invalid#$BASE_DOMAIN#g" {} +
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF
USER 10001:10001
EXPOSE 8080
CMD ["serve"]
