from functools import lru_cache

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_JWT_SECRET = "clientbridge-dev-secret-do-not-use-in-prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge"

    jwt_secret: str = _DEV_JWT_SECRET  # matches infra/powersync jwks
    jwt_issuer: str = "clientbridge"
    jwt_ttl_seconds: int = 300  # the PowerSync token, not the app access token
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_days: int = 30
    refresh_replay_key: str = ""

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
    powersync_previous_public_keys: dict[str, str] = Field(default_factory=dict)
    google_client_id: str = ""

    # Stripe Connect; an empty secret key answers every Stripe call with payments_not_configured.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_connect_country: str = "CA"
    api_base_url: str = "http://127.0.0.1:8701"
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

    @model_validator(mode="after")
    def _require_prod_secrets(self) -> "Settings":
        """Refuse to boot outside dev without real JWT and Stripe webhook secrets."""
        if self.env != "dev":
            missing = []
            if self.jwt_secret == _DEV_JWT_SECRET:
                missing.append("JWT_SECRET")
            if not self.refresh_replay_key:
                missing.append("REFRESH_REPLAY_KEY")
            if not self.stripe_webhook_secret:
                missing.append("STRIPE_WEBHOOK_SECRET")
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
        if self.refresh_replay_key:
            Fernet(self.refresh_replay_key.encode())
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
