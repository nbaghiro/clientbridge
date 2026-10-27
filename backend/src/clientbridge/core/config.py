import base64
import re
from email.utils import parseaddr
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from clientbridge.core.deployment import SESSION_COOKIE, public_urls

_DEV_E2E_ORIGINS = ("http://localhost:8721", "http://localhost:8724")  # web e2e, en-CA and en-XA
_DEV_JWT_SECRET = "clientbridge-dev-secret-do-not-use-in-prod"
_DEV_COURIER_SECRET = "clientbridge-dev-courier-secret-do-not-use-in-prod"
_DEV_SMTP_URL = "smtp://localhost:8716"  # Mailpit in docker-compose.yml
_STRIPE_LIVE_KEYS = ("sk_live_", "rk_live_")
_DOMAIN = re.compile(r"[a-z0-9-]+(\.[a-z0-9-]+)+")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"})
# reserved names (RFC 2606, 6761) and the web image's build placeholder base.invalid
_RESERVED_TLDS = frozenset({"localhost", "invalid", "test", "example", "local", "internal"})
# reached across the cluster; only the database is served on localhost, by the Cloud SQL proxy
_REMOTE = ("redis_url", "s3_endpoint", "auth_admin_url", "auth_internal_url")
# outside dev each must be set to something other than its local default
_DEPLOYED = (
    "database_url",
    "redis_url",
    "s3_endpoint",
    "s3_bucket",
    "s3_access_key",
    "s3_secret_key",
    "stripe_secret_key",
    "stripe_webhook_secret",
    "stripe_thin_webhook_secret",
    "stripe_platform_webhook_secret",
    "stripe_portal_configuration",
    "twilio_auth_token",
    "resend_api_key",
    "resend_webhook_secret",
    "email_from",
    "powersync_private_key_pem",
)

Environment = Literal["dev", "staging", "prod"]


class Settings(BaseSettings):
    # errors would otherwise echo the inputs, database passwords and provider secrets included
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    env: Environment = "dev"
    # production clientbridge.ca, staging staging.clientbridge.ca; derives every public URL
    base_domain: str = ""
    # proxies in front of the API that append to X-Forwarded-For (Google's load balancer adds 2)
    trusted_proxy_hops: int = Field(default=0, ge=0)
    pseudo_locale: bool = False  # renders backend text in en_XA; development and tests only
    # an e2e run's four digits: they end every id this process writes and confine its jobs
    run_namespace: str = Field(default="", pattern=r"^(\d{4})?$")
    # the API reads and writes data; only migrations and the demo seed change the schema
    database_url: str = (
        "postgresql+asyncpg://clientbridge_api:clientbridge_api@localhost:8702/clientbridge"
    )
    migration_database_url: str = "postgresql+asyncpg://clientbridge_migrator:clientbridge_migrator@localhost:8702/clientbridge"
    # per process: Cloud SQL's max_connections is shared by every pod of both environments
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)

    jwt_secret: str = _DEV_JWT_SECRET  # matches infra/powersync jwks
    jwt_ttl_seconds: int = 300  # the PowerSync token

    auth_public_url: str = "http://localhost:8713"
    # the auth public API as the API reaches it (in the cluster, its Service); empty: the public URL
    auth_internal_url: str = ""
    auth_admin_url: str = "http://localhost:8714"
    auth_session_cookie: str = "cb_session"
    identity_cache_ttl_seconds: float = 30
    # A session dies this long after its sign-in, however often it was extended.
    session_max_age_days: int = 90

    google_business_enabled: bool = False
    google_business_client_id: str = ""
    google_business_client_secret: str = Field(default="", repr=False)
    google_business_redirect_uri: str = ""
    google_business_kms_key: str = ""

    redis_url: str = "redis://localhost:8703/0"

    # Object storage: RustFS in dev, S3 in prod; clients upload and download via presigned URLs.
    s3_endpoint: str = "http://localhost:8705"
    s3_bucket: str = "clientbridge"
    s3_access_key: str = "rustfs"
    s3_secret_key: str = "rustfs-dev-secret"
    s3_region: str = "us-east-1"
    s3_presign_ttl_seconds: int = 3600

    powersync_audience: str = "powersync"
    powersync_kid: str = "clientbridge-dev"  # matches infra/powersync/powersync.yaml
    powersync_use_rs256: bool = False  # prod: sign PowerSync tokens with RS256, verified via JWKS
    powersync_private_key_pem: str = ""  # prod RSA private key (PEM); empty → ephemeral (dev/test)
    powersync_previous_public_keys: dict[str, str] = Field(default_factory=dict)

    # Stripe Connect; an empty secret key answers every Stripe call with payments_not_configured.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""  # the Connect endpoint's (snapshot events) signing secret
    stripe_thin_webhook_secret: str = ""  # the account event destination's (thin events) secret
    stripe_platform_webhook_secret: str = ""  # the platform endpoint's (plan subscriptions) secret
    stripe_portal_configuration: str = ""  # the Billing Portal configuration owners manage plans in
    stripe_connect_country: str = "CA"
    api_base_url: str = "http://127.0.0.1:8701"  # the public API origin, which Twilio signs
    web_base_url: str = "http://localhost:8700"
    admin_base_url: str = ""
    platform_admin_identity_ids: str = ""
    dev_platform_admin_identity_ids: str = ""
    # each business's public page is its own subdomain, so the slug fills the template
    business_page_url: str = "http://{slug}.localhost:8709"
    book_base_url: str = "http://book.localhost:8709"
    shop_base_url: str = "http://shop.localhost:8709"
    pay_base_url: str = "http://pay.localhost:8709"
    cors_allow_origins: str = ""
    # our application fee keeps Stripe's percentage plus ours at or under the ceiling, capped at max
    platform_fee_ceiling_bps: int = 320
    platform_fee_max_bps: int = 200
    # Stripe's Canadian percentage rates (stripe.com/en-ca/pricing); fixed amounts come on top
    stripe_card_bps: int = 290
    stripe_card_present_bps: int = 270
    stripe_acss_debit_bps: int = 100
    stripe_conversion_bps: int = 200
    auth_email_hook_secret: str = _DEV_COURIER_SECRET  # matches docker-compose.yml's auth

    # Outreach channels; empty credentials select the no-op console senders.
    resend_api_key: str = ""
    resend_webhook_secret: str = ""  # signs /webhooks/email (Svix)
    contact_to: str = "hello@clientbridge.ca"
    email_from: str = ""
    # dev transport (Mailpit unless set, "" turns it off); when set it takes precedence over Resend
    smtp_url: str | None = None
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_sms_from: str = ""
    expo_access_token: str = ""

    @model_validator(mode="after")
    def _require_prod_secrets(self) -> "Settings":
        """Derive the public URLs, and refuse to boot outside dev without real deployed settings."""
        explicit = set(self.model_fields_set)
        if self.base_domain and not _DOMAIN.fullmatch(self.base_domain):
            raise ValueError("BASE_DOMAIN must be a bare lowercase domain such as clientbridge.ca")
        derived = (
            {**public_urls(self.base_domain), "auth_session_cookie": SESSION_COOKIE}
            if self.base_domain
            else {}
        )
        for name, url in derived.items():
            if name not in explicit:
                setattr(self, name, url)
        self.auth_internal_url = self.auth_internal_url or self.auth_public_url
        if self.smtp_url is None:
            self.smtp_url = _DEV_SMTP_URL if self.env == "dev" else ""
        if self.env == "dev":
            return self
        if self.run_namespace:
            raise ValueError("RUN_NAMESPACE is for e2e runs; unset it when ENV is not 'dev'")
        if self.smtp_url:
            raise ValueError("SMTP_URL is a development transport; unset it when ENV is not 'dev'")
        defaults = {name: Settings.model_fields[name].default for name in _DEPLOYED}
        missing = [
            name.upper()
            for name, default in defaults.items()
            if name not in explicit or getattr(self, name) in ("", default)
        ]
        if not self.base_domain:
            missing.append("BASE_DOMAIN")
        if self.jwt_secret == _DEV_JWT_SECRET:
            missing.append("JWT_SECRET")
        if not self.auth_admin_url or self.auth_admin_url == self.auth_public_url:
            missing.append("AUTH_ADMIN_URL (private, distinct from the public URL)")
        if self.auth_email_hook_secret in ("", _DEV_COURIER_SECRET):
            missing.append("AUTH_EMAIL_HOOK_SECRET")
        if self.trusted_proxy_hops == 0:
            missing.append("TRUSTED_PROXY_HOPS (2 behind Google's load balancer)")
        if not self.powersync_use_rs256:
            missing.append("POWERSYNC_USE_RS256=true")
        if not self.powersync_kid or self.powersync_kid == "clientbridge-dev":
            missing.append("POWERSYNC_KID (unique production key ID)")
        if missing:
            raise ValueError(f"{', '.join(missing)} must be set when ENV is not 'dev'")
        if self.base_domain.rsplit(".", 1)[-1] in _RESERVED_TLDS:
            raise ValueError(
                f"BASE_DOMAIN {self.base_domain} is a reserved name, not a real domain"
            )
        local = [name.upper() for name in _REMOTE if _is_local(getattr(self, name))]
        if local:
            raise ValueError(
                f"{', '.join(local)} must not point at this machine when ENV is not 'dev'"
            )
        if parseaddr(self.email_from)[1].rpartition("@")[2].lower() != self.base_domain:
            raise ValueError(f"EMAIL_FROM must be an address at BASE_DOMAIN {self.base_domain}")
        disagreeing = [
            name.upper()
            for name, url in derived.items()
            if _normalized(getattr(self, name)) != _normalized(url)
        ]
        if disagreeing:
            raise ValueError(
                f"{', '.join(disagreeing)} must match BASE_DOMAIN {self.base_domain}; unset them"
            )
        return self

    @model_validator(mode="after")
    def _check_keys(self) -> "Settings":
        live = self.stripe_secret_key.startswith(_STRIPE_LIVE_KEYS)
        if self.env == "prod" and not live:
            raise ValueError("STRIPE_SECRET_KEY must be a live key (sk_live_ or rk_live_) in prod")
        if self.env != "prod" and live:
            raise ValueError("STRIPE_SECRET_KEY must not be a live key when ENV is not 'prod'")
        if self.powersync_private_key_pem:
            key = serialization.load_pem_private_key(
                self.powersync_private_key_pem.encode(), password=None
            )
            if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
                raise ValueError("POWERSYNC_PRIVATE_KEY_PEM must be RSA with at least 2048 bits")
        for kid, pem in self.powersync_previous_public_keys.items():
            if not kid or kid == self.powersync_kid:
                raise ValueError(
                    "Previous PowerSync key IDs must be nonempty and distinct from the signing key"
                )
            public = serialization.load_pem_public_key(pem.encode())
            if not isinstance(public, rsa.RSAPublicKey) or public.key_size < 2048:
                raise ValueError(
                    "Previous PowerSync keys must be RSA public keys with at least 2048 bits"
                )
        if self.resend_webhook_secret:
            try:
                base64.b64decode(self.resend_webhook_secret.removeprefix("whsec_"), validate=True)
            except ValueError as error:
                raise ValueError(
                    "RESEND_WEBHOOK_SECRET must be whsec_ followed by base64"
                ) from error
        return self

    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    def allowed_origin_regex(self) -> str:
        pages = re.escape(self.business_page_url).replace(re.escape("{slug}"), "[a-z0-9-]+")
        return rf"http://([a-z0-9-]+\.)?localhost:\d+|{pages}" if self.env == "dev" else pages

    def page_url(self, slug: str) -> str:
        return self.business_page_url.format(slug=slug)

    def public_rate_limit(self) -> int:
        """Requests per minute from one IP on each unauthenticated endpoint group."""
        # in dev one browser plays every visitor of the e2e suites, all from one address
        return 1000 if self.env == "dev" else 30

    def app_origins(self) -> list[str]:
        """The only origins that may send the session cookie: the web app (and its e2e copy)."""
        return [
            self.web_base_url,
            *([self.admin_base_url] if self.admin_base_url else []),
            *(["http://localhost:8711", *_DEV_E2E_ORIGINS] if self.env == "dev" else []),
        ]


def _is_local(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host in _LOCAL_HOSTS or host.endswith(".localhost")


def _normalized(urls: str) -> set[str]:
    return {url.strip().rstrip("/") for url in urls.split(",") if url.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
