"""Validated environment configuration for local and hosted deployments."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Application settings loaded from environment-specific dotenv files."""

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AI Racing Telemetry Analysis Platform API"
    app_env: Literal["development", "test", "production"] = "development"
    app_mode: Literal["local", "cloud"] = "local"
    app_version: str = "0.2.0"
    api_v1_prefix: str = "/api/v1"
    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = "INFO"
    docs_enabled: bool = True

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    allowed_hosts: str = "localhost,127.0.0.1,testserver"

    database_url: str = f"sqlite:///{PROJECT_ROOT / 'storage' / 'sessions.sqlite3'}"
    storage_backend: Literal["local", "s3", "r2"] = "local"
    task_queue_backend: Literal["inline", "redis"] = "inline"
    redis_url: str | None = None
    object_storage_bucket: str | None = None
    object_storage_endpoint: str | None = None
    object_storage_region: str = "auto"

    racing_video_roots: str | None = None
    video_cache_ttl_seconds: int = Field(default=24 * 60 * 60, ge=60)
    max_video_source_bytes: int = Field(default=10 * 1024**3, ge=1)
    max_csv_upload_bytes: int = Field(default=20 * 1024**2, ge=1024)
    max_xrk_upload_bytes: int = Field(default=50 * 1024**2, ge=1024)
    xrk_parse_timeout_seconds: int = Field(default=60, ge=5, le=300)
    xrk_max_concurrent_imports: int = Field(default=2, ge=1, le=8)
    xrk_rate_limit_per_hour: int = Field(default=10, ge=1, le=1000)
    xrk_max_response_rows: int = Field(default=30_000, ge=1000, le=250_000)

    @property
    def cors_origin_list(self) -> list[str]:
        """Return normalized CORS origins."""
        return _split_csv(self.cors_origins)

    @property
    def allowed_host_list(self) -> list[str]:
        """Return normalized trusted hosts."""
        return _split_csv(self.allowed_hosts)

    @property
    def local_video_enabled(self) -> bool:
        """Whether this process may scan and stream local filesystem videos."""
        return self.app_mode == "local" and self.storage_backend == "local"

    @property
    def sqlite_path(self) -> Path:
        """Resolve the current SQLite URL to a filesystem path."""
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            raise RuntimeError(
                "This MVP storage adapter currently supports SQLite only. "
                "Use the documented repository migration before enabling PostgreSQL."
            )
        raw_path = self.database_url.removeprefix(prefix)
        path = Path(raw_path)
        return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()


def _split_csv(value: str) -> list[str]:
    """Split a comma-separated setting while removing empty values."""
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_files() -> tuple[Path, ...]:
    """Return dotenv files from general to environment-specific."""
    environment = os.getenv("APP_ENV", "development").lower()
    return (
        PROJECT_ROOT / ".env",
        PROJECT_ROOT / f".env.{environment}",
        PROJECT_ROOT / ".env.local",
    )


@lru_cache
def get_settings() -> Settings:
    """Return one cached settings object for the process."""
    return Settings(_env_file=_env_files(), _env_file_encoding="utf-8")


def reset_settings_cache() -> None:
    """Clear cached settings for tests that alter environment variables."""
    get_settings.cache_clear()
