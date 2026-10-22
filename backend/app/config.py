from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GRABIT_", env_file=".env", extra="ignore")

    env: Literal["development", "production"] = "production"
    api_key: str = ""
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    download_dir: Path = Path(".downloads")
    youtube_cookies_file: Path | None = None
    # Zero disables these owner-controlled limits. Render sets bounded values explicitly.
    max_duration_seconds: int = Field(0, ge=0)
    max_file_mb: int = Field(0, ge=0)
    job_timeout_seconds: int = Field(0, ge=0)
    inspections_per_minute: int = Field(0, ge=0)
    file_ttl_seconds: int = Field(900, ge=60, le=3600)
    metadata_ttl_seconds: int = Field(600, ge=1)
    max_jobs: int = Field(5, ge=1, le=20)

    @model_validator(mode="after")
    def require_production_key(self) -> "Settings":
        if self.env == "production" and len(self.api_key) < 24:
            raise ValueError("Set GRABIT_API_KEY to at least 24 characters in production.")
        if "*" in self.allowed_origins:
            raise ValueError("Use exact frontend origins instead of a wildcard.")
        return self
