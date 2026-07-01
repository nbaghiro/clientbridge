from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge"

    jwt_secret: str = "clientbridge-dev-secret-do-not-use-in-prod"  # matches infra/powersync jwks
    jwt_issuer: str = "clientbridge"
    jwt_ttl_seconds: int = 3600  # PowerSync token TTL
    access_token_ttl_seconds: int = 900  # app access token — 15 min
    refresh_token_ttl_days: int = 30  # app refresh token

    redis_url: str = "redis://localhost:8703/0"

    # Object storage — the dev stack runs MinIO (docker-compose `minio`, S3 API on 8705); prod
    # points at S3. Presigned PUT/GET URLs let clients upload/download directly, off the API path.
    s3_endpoint: str = "http://localhost:8705"
    s3_bucket: str = "clientbridge"
    s3_access_key: str = "minio"
    s3_secret_key: str = "minio12345"  # dev-only MinIO default, overridden in prod
    s3_region: str = "us-east-1"
    s3_presign_ttl_seconds: int = 3600

    powersync_audience: str = "powersync"
    powersync_kid: str = "clientbridge-dev"  # matches infra/powersync/powersync.yaml
    powersync_use_rs256: bool = False  # prod: sign PowerSync tokens with RS256, verified via JWKS
    powersync_private_key_pem: str = ""  # prod RSA private key (PEM); empty → ephemeral (dev/test)
    google_client_id: str = ""  # OAuth audience for verifying Google id_tokens

    # Stripe Connect — platform account + custom connected accounts. Empty in dev/test → the fake
    # gateway is used; prod sets the live/test keys.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_connect_country: str = "CA"
    web_base_url: str = "http://localhost:8601"  # onboarding return/refresh targets
    platform_fee_bps: int = 200  # application fee per direct charge (basis points; 200 = 2%)
    interac_webhook_secret: str = ""  # shared secret for the inbound e-Transfer auto-match webhook
    sms_webhook_secret: str = ""  # shared secret for the inbound SMS (Twilio-style) webhook

    # Outreach channels — empty → the no-op Console sender (tests use recording fakes); set creds in
    # prod to swap in real Twilio/Expo. SMS + email reach clients, push reaches staff devices.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_sms_from: str = ""
    expo_access_token: str = ""  # optional; Expo push accepts device tokens without it

    # Dev-only: /sync/token mints a token for this user when the request is unauthenticated,
    # so the client apps can connect before real auth exists.
    dev_user_id: str = "us_dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
