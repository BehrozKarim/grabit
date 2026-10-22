from typing import Literal

from pydantic import BaseModel, Field, PrivateAttr


class InspectRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


class FormatOption(BaseModel):
    id: str
    label: str
    extension: str
    height: int | None = None
    width: int | None = None
    filesize: int | None = None
    has_audio: bool = False


class MediaInfo(BaseModel):
    # Extractor details stay in the expiring cache, never in the metadata response.
    _browser_formats: list[dict] = PrivateAttr(default_factory=list)
    _source_url: str | None = PrivateAttr(default=None)
    id: str
    title: str
    platform: str
    uploader: str | None
    thumbnail: str | None
    duration: float | None
    formats: list[FormatOption]
    audio_available: bool


class CreateJobRequest(BaseModel):
    media_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    mode: Literal["video", "audio"] = "video"
    format_id: str | None = Field(default=None, max_length=80)
    audio_format: Literal["mp3", "m4a"] = "mp3"


class BrowserSource(BaseModel):
    url: str
    extension: str
    filesize: int | None = None


class BrowserPlan(BaseModel):
    route: Literal["direct", "merge", "convert", "server"]
    sources: list[BrowserSource] = Field(default_factory=list)
    extension: str | None = None
    reason: str | None = None


class JobStatus(BaseModel):
    id: str
    title: str
    status: Literal["queued", "downloading", "processing", "ready", "failed", "cancelled"]
    progress: float | None = None
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    filename: str | None = None
    error: str | None = None
    expires_at: float | None = None


class DownloadTicket(BaseModel):
    url: str
    expires_in: int
