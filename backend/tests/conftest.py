import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import FormatOption, MediaInfo


class FakeDownloader:
    def __init__(self):
        self.downloads = 0

    async def inspect(self, url, platform, media_id):
        return MediaInfo(
            id=media_id,
            title="A test video",
            platform=platform,
            uploader="Test creator",
            thumbnail=None,
            duration=12,
            formats=[
                FormatOption(id="720", label="720p", height=720, extension="mp4", has_audio=True)
            ],
            audio_available=True,
        )

    async def download(self, url, media, request, directory: Path, on_progress):
        self.downloads += 1
        on_progress(50, 100)
        await asyncio.sleep(0)
        extension = request.audio_format if request.mode == "audio" else "mp4"
        path = directory / f"media.{extension}"
        path.write_bytes(b"fixture-media-bytes")
        on_progress(100, 100)
        return path


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        env="development",
        download_dir=tmp_path / "files",
        max_file_mb=150,
        max_duration_seconds=1200,
        job_timeout_seconds=600,
        inspections_per_minute=6,
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, FakeDownloader())) as client:
        yield client
