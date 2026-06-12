import os

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT_MARKER = "change-me-in-production"


def _is_production_runtime() -> bool:
    return os.getenv("NODE_ENV") == "production" or os.getenv("APP_ENV") == "production"


def _allows_development_defaults() -> bool:
    return (
        os.getenv("APP_ENV") == "development"
        or os.getenv("ALLOW_INSECURE_DEV_DEFAULTS") == "1"
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql://orchestrator:change-me-in-production@localhost:5432/sandbox_orchestrator",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")
    storage_root: str = Field(default="/app/storage", alias="STORAGE_ROOT")
    engine_port: int = Field(default=8000, alias="ENGINE_PORT")
    pending_message_idle_ms: int = Field(default=60000, alias="PENDING_MESSAGE_IDLE_MS")

    @model_validator(mode="after")
    def validate_production_config(self) -> "Settings":
        if not _is_production_runtime() or _allows_development_defaults():
            return self
        if INSECURE_DEFAULT_MARKER in self.database_url:
            raise ValueError("DATABASE_URL_uses_insecure_default")
        if os.getenv("DATABASE_URL") is None:
            raise ValueError("DATABASE_URL_required_in_production")
        if os.getenv("REDIS_URL") is None:
            raise ValueError("REDIS_URL_required_in_production")
        return self


settings = Settings()
