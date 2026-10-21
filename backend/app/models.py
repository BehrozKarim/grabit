from typing import Literal

from pydantic import BaseModel, Field


class InspectRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


class FormatOption(BaseModel):
    id: str
    label: str
    extension: str
    height: int | None = None
    filesize: int | None = None
    has_audio: bool = False


class MediaInfo(BaseModel):
    id: str
    title: str
    platform: str
    uploader: str | None
    thumbnail: str | None
    duration: float
    formats: list[FormatOption]
    audio_available: bool


class CreateJobRequest(BaseModel):
    media_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    mode: Literal["video", "audio"] = "video"
    format_id: str | None = Field(default=None, max_length=80)
    audio_format: Literal["mp3", "m4a"] = "mp3"


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
