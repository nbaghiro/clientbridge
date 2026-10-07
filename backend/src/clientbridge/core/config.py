from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_JWT_SECRET = "clientbridge-dev-secret-do-not-use-in-prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge"

    jwt_secret: str = _DEV_JWT_SECRET  # matches infra/powersync jwks
    jwt_issuer: str = "clientbridge"
    jwt_ttl_seconds: int = 3600  # the PowerSync token, not the app access token
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_days: int = 30

    redis_url: str = "redis://localhost:8703/0"

    # Object storage: RustFS in dev, S3 in prod; clients upload and download via presigned URLs.
    s3_endpoint: str = "http://localhost:8705"
    s3_bucket: str = "clientbridge"
    s3_access_key: str = "minio"
    s3_secret_key: str = "minio12345"
    s3_region: str = "us-east-1"
    s3_presign_ttl_seconds: int = 3600

    powersync_audience: str = "powersync"
    powersync_kid: str = "clientbridge-dev"  # matches infra/powersync/powersync.yaml
    powersync_use_rs256: bool = False  # prod: sign PowerSync tokens with RS256, verified via JWKS
    powersync_private_key_pem: str = ""  # prod RSA private key (PEM); empty → ephemeral (dev/test)
    google_client_id: str = ""

    # Stripe Connect; an empty secret key answers every Stripe call with payments_not_configured.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_connect_country: str = "CA"
    api_base_url: str = "http://localhost:8701"
    web_base_url: str = "http://localhost:8700"
    connect_base_url: str = "http://localhost:8709"
    # Every invoice pay link uses this one host (production: https://pay.clientbridge.ca).
    pay_base_url: str = "http://localhost:8709"
    cors_allow_origins: str = ""
    platform_fee_bps: int = 200  # application fee per direct charge (basis points; 200 = 2%)
    interac_webhook_secret: str = ""
    sms_webhook_secret: str = ""

    # Outreach channels; empty credentials select the no-op console senders.
    postmark_server_token: str = ""
    email_from: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_sms_from: str = ""
    expo_access_token: str = ""

    # Dev only: an unauthenticated /sync/token call mints a token for this user.
    dev_user_id: str = "us_dev"

    @model_validator(mode="after")
    def _require_prod_secrets(self) -> "Settings":
        """Refuse to boot outside dev without real JWT and Stripe webhook secrets."""
        if self.env != "dev":
            missing = []
            if self.jwt_secret == _DEV_JWT_SECRET:
                missing.append("JWT_SECRET")
            if not self.stripe_webhook_secret:
                missing.append("STRIPE_WEBHOOK_SECRET")
            if missing:
                raise ValueError(f"{', '.join(missing)} must be set when ENV is not 'dev'")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
