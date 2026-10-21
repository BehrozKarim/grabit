import asyncio

import pytest

from app.errors import MediaError
from app.jobs import JobService
from app.media import MediaService
from app.models import CreateJobRequest
from tests.conftest import FakeDownloader


class WaitingDownloader(FakeDownloader):
    def __init__(self):
        self.started = asyncio.Event()
        self.finish = asyncio.Event()
        self.concurrent = 0
        self.peak = 0

    async def download(self, url, media, request, directory, on_progress):
        self.concurrent += 1
        self.peak = max(self.peak, self.concurrent)
        self.started.set()
        try:
            await self.finish.wait()
            path = directory / "media.mp4"
            path.write_bytes(b"media")
            return path
        finally:
            self.concurrent -= 1


async def test_queue_serializes_jobs_and_cancellation_cleans_files(settings):
    gate = asyncio.Lock()
    engine = WaitingDownloader()
    media = MediaService(settings, engine, gate)
    info = await media.inspect("https://youtu.be/test")
    jobs = JobService(settings, media, engine, gate)
    first = jobs.create(CreateJobRequest(media_id=info.id, format_id="720"))
    second = jobs.create(CreateJobRequest(media_id=info.id, format_id="720"))
    await engine.started.wait()
    assert jobs.get(second.id).state.status == "queued"
    with pytest.raises(MediaError, match="preparing"):
        await media.inspect("https://youtu.be/another")
    await jobs.cancel(first.id)
    assert not jobs.get(first.id).directory.exists()
    engine.finish.set()
    await jobs.get(second.id).task
    assert engine.peak == 1
    assert jobs.get(second.id).state.status == "ready"
    await jobs.close()


async def test_cancel_before_task_starts(settings):
    gate = asyncio.Lock()
    engine = FakeDownloader()
    media = MediaService(settings, engine, gate)
    info = await media.inspect("https://youtu.be/test")
    jobs = JobService(settings, media, engine, gate)
    job = jobs.create(CreateJobRequest(media_id=info.id, format_id="720"))
    await jobs.cancel(job.id)
    assert jobs.get(job.id).state.status == "cancelled"
    assert not jobs.get(job.id).directory.exists()


async def test_queue_limit(settings):
    settings.max_jobs = 1
    gate = asyncio.Lock()
    engine = WaitingDownloader()
    media = MediaService(settings, engine, gate)
    info = await media.inspect("https://youtu.be/test")
    jobs = JobService(settings, media, engine, gate)
    jobs.create(CreateJobRequest(media_id=info.id, format_id="720"))
    with pytest.raises(MediaError, match="queue is full"):
        jobs.create(CreateJobRequest(media_id=info.id, format_id="720"))
    await jobs.close()
