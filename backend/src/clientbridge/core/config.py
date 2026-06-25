from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    api_port: int = 8701  # Clientbridge 87xx block — see docs/ports.md
    database_url: str = "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge"

    jwt_secret: str = "clientbridge-dev-secret-do-not-use-in-prod"  # matches infra/powersync jwks
    jwt_issuer: str = "clientbridge"
    jwt_ttl_seconds: int = 3600  # PowerSync token TTL
    access_token_ttl_seconds: int = 900  # app access token — 15 min
    refresh_token_ttl_days: int = 30  # app refresh token

    redis_url: str = "redis://localhost:8703/0"
    powersync_url: str = "http://localhost:8704"
    powersync_audience: str = "powersync"
    powersync_kid: str = "clientbridge-dev"  # matches infra/powersync/powersync.yaml
    powersync_use_rs256: bool = False  # prod: sign PowerSync tokens with RS256, verified via JWKS
    powersync_private_key_pem: str = ""  # prod RSA private key (PEM); empty → ephemeral (dev/test)
    google_client_id: str = ""  # OAuth audience for verifying Google id_tokens

    # Dev-only: /sync/token mints a token for this user when the request is unauthenticated,
    # so the client apps can connect before real auth exists.
    dev_user_id: str = "us_dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
