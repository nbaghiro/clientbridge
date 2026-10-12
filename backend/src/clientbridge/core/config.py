from functools import lru_cache
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_E2E_ORIGINS = ("http://localhost:8721", "http://localhost:8724")  # web e2e, en-CA and en-XA
_DEV_JWT_SECRET = "clientbridge-dev-secret-do-not-use-in-prod"
_DEV_COURIER_SECRET = "clientbridge-dev-courier-secret-do-not-use-in-prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    pseudo_locale: bool = False  # renders backend text in en_XA; development and tests only
    # the API reads and writes data; only migrations and the demo seed change the schema
    database_url: str = (
        "postgresql+asyncpg://clientbridge_api:clientbridge_api@localhost:8702/clientbridge"
    )
    migration_database_url: str = "postgresql+asyncpg://clientbridge_migrator:clientbridge_migrator@localhost:8702/clientbridge"

    jwt_secret: str = _DEV_JWT_SECRET  # matches infra/powersync jwks
    jwt_ttl_seconds: int = 300  # the PowerSync token

    auth_public_url: str = "http://localhost:8713"
    auth_admin_url: str = "http://localhost:8714"
    auth_session_cookie: str = "ory_kratos_session"
    identity_cache_ttl_seconds: float = 30
    # A session dies this long after its sign-in, however often it was extended.
    session_max_age_days: int = 90

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
    stripe_webhook_secret: str = ""
    stripe_connect_country: str = "CA"
    api_base_url: str = "http://127.0.0.1:8701"  # the public API origin, which Twilio signs
    web_base_url: str = "http://localhost:8700"
    connect_base_url: str = "http://localhost:8709"
    # Every invoice pay link uses this one host (production: https://pay.clientbridge.ca).
    pay_base_url: str = "http://localhost:8709"
    cors_allow_origins: str = ""
    platform_fee_bps: int = 200  # application fee per direct charge (basis points; 200 = 2%)
    auth_email_hook_secret: str = _DEV_COURIER_SECRET  # matches docker-compose.yml's kratos

    # Outreach channels; empty credentials select the no-op console senders.
    postmark_server_token: str = ""
    email_from: str = ""
    smtp_url: str = ""  # dev: smtp://localhost:8716 delivers to Mailpit when Postmark is unset
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_sms_from: str = ""
    expo_access_token: str = ""

    @model_validator(mode="after")
    def _require_prod_secrets(self) -> "Settings":
        """Refuse to boot outside dev without real webhook secrets and a private auth admin API."""
        if self.env != "dev":
            missing = []
            if self.jwt_secret == _DEV_JWT_SECRET:
                missing.append("JWT_SECRET")
            auth = urlsplit(self.auth_public_url)
            if auth.scheme != "https" or auth.hostname in ("localhost", "127.0.0.1"):
                missing.append("AUTH_PUBLIC_URL (https, not localhost)")
            if not self.auth_admin_url or self.auth_admin_url == self.auth_public_url:
                missing.append("AUTH_ADMIN_URL (private, distinct from the public URL)")
            if not self.stripe_webhook_secret:
                missing.append("STRIPE_WEBHOOK_SECRET")
            if not self.twilio_auth_token:
                missing.append("TWILIO_AUTH_TOKEN")
            if self.auth_email_hook_secret in ("", _DEV_COURIER_SECRET):
                missing.append("AUTH_EMAIL_HOOK_SECRET")
            if not self.powersync_use_rs256:
                missing.append("POWERSYNC_USE_RS256=true")
            if not self.powersync_private_key_pem:
                missing.append("POWERSYNC_PRIVATE_KEY_PEM")
            if not self.powersync_kid or self.powersync_kid == "clientbridge-dev":
                missing.append("POWERSYNC_KID (unique production key ID)")
            if missing:
                raise ValueError(f"{', '.join(missing)} must be set when ENV is not 'dev'")
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
        return self

    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    def allowed_origin_regex(self) -> str | None:
        return r"http://localhost:\d+" if self.env == "dev" else None

    def app_origins(self) -> list[str]:
        """The only origins that may send the Kratos cookie: the web app (and its e2e copy)."""
        return [self.web_base_url, *(_DEV_E2E_ORIGINS if self.env == "dev" else ())]


@lru_cache
def get_settings() -> Settings:
    return Settings()
