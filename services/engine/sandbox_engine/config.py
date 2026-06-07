from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql://orchestrator:change-me-in-production@localhost:5432/sandbox_orchestrator",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")
    storage_root: str = Field(default="/app/storage", alias="STORAGE_ROOT")
    engine_port: int = Field(default=8000, alias="ENGINE_PORT")


settings = Settings()
