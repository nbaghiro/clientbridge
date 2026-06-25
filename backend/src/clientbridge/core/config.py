from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    api_port: int = 8701  # Clientbridge 87xx block — see docs/ports.md
    database_url: str = "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge"

    jwt_secret: str = "dev-change-me"
    jwt_issuer: str = "clientbridge"
    jwt_ttl_seconds: int = 3600

    redis_url: str = "redis://localhost:8703/0"
    powersync_url: str = "http://localhost:8704"


@lru_cache
def get_settings() -> Settings:
    return Settings()
