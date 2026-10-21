import asyncio
import contextlib
import logging
import re
import secrets
import shutil
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from app.config import Settings
from app.errors import MediaError
from app.media import MediaService
from app.models import CreateJobRequest, JobStatus, MediaInfo

logger = logging.getLogger(__name__)


class Downloader(Protocol):
    async def download(
        self,
        url: str,
        media: MediaInfo,
        request: CreateJobRequest,
        directory: Path,
        on_progress: Callable[[int, int | None], None],
    ) -> Path: ...


@dataclass
class Job:
    state: JobStatus
    directory: Path
    created_at: float = field(default_factory=time.time)
    path: Path | None = None
    task: asyncio.Task | None = None
    active_transfers: int = 0
    ticket: str | None = None
    ticket_expires: float = 0


class JobService:
    """Single-process job queue; all file paths are server-owned and short-lived."""

    def __init__(
        self,
        settings: Settings,
        media: MediaService,
        downloader: Downloader,
        gate: asyncio.Lock,
    ):
        self.settings = settings
        self.media = media
        self.downloader = downloader
        self.gate = gate
        self.jobs: dict[str, Job] = {}

    def create(self, request: CreateJobRequest) -> JobStatus:
        cached = self.media.get(request.media_id)
        if request.mode == "audio" and not cached.info.audio_available:
            raise MediaError("No audio track is available for this video.")
        if request.mode == "video" and request.format_id not in [f.id for f in cached.info.formats]:
            raise MediaError("Choose one of the available video resolutions.")
        active = sum(
            j.state.status in ("queued", "downloading", "processing") for j in self.jobs.values()
        )
        if active >= self.settings.max_jobs:
            raise MediaError(
                "The download queue is full. Try again after a download finishes.", 429
            )
        if len(self.jobs) >= 50:
            raise MediaError("Too many recent downloads. Wait for older files to expire.", 429)
        job_id = uuid.uuid4().hex
        directory = self.settings.download_dir.resolve() / job_id
        directory.mkdir(parents=True, exist_ok=False)
        job = Job(JobStatus(id=job_id, title=cached.info.title, status="queued"), directory)
        self.jobs[job_id] = job
        job.task = asyncio.create_task(self._run(job, cached.url, cached.info, request))
        return job.state.model_copy(deep=True)

    def get(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if not job:
            raise MediaError(
                "This download expired or the server restarted. Fetch the video again.", 410
            )
        return job

    async def _run(self, job: Job, url: str, info: MediaInfo, request: CreateJobRequest) -> None:
        try:
            async with self.gate:
                job.state.status = "downloading"

                def progress(downloaded: int, total: int | None) -> None:
                    job.state.downloaded_bytes = downloaded
                    job.state.total_bytes = total
                    job.state.progress = min(100, downloaded / total * 100) if total else None
                    job.state.status = (
                        "processing" if total and downloaded >= total else "downloading"
                    )

                job.path = await self.downloader.download(
                    url, info, request, job.directory, progress
                )
                stem = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', "", info.title).strip(" .")[:100]
                job.state.filename = f"{stem or 'grabit-video'}{job.path.suffix}"
                job.state.progress = 100
                job.state.status = "ready"
                job.state.expires_at = time.time() + self.settings.file_ttl_seconds
        except asyncio.CancelledError:
            job.state.status = "cancelled"
            self._remove_files(job)
            raise
        except MediaError as error:
            job.state.status = "failed"
            job.state.error = error.message
            self._remove_files(job)
        except Exception:
            # Avoid logging downloader URLs, credentials, or platform responses.
            logger.error("Unexpected download failure for job %s", job.state.id)
            job.state.status = "failed"
            job.state.error = "The download failed unexpectedly. Try again."
            self._remove_files(job)

    async def cancel(self, job_id: str) -> JobStatus:
        job = self.get(job_id)
        if job.task and not job.task.done():
            job.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await job.task
            # Cancellation before _run starts cannot reach its exception handler.
            job.state.status = "cancelled"
        if not job.active_transfers:
            self._remove_files(job)
        if job.state.status == "ready":
            job.state.status = "cancelled"
        return job.state

    def issue_ticket(self, job_id: str) -> str:
        job = self.get(job_id)
        if job.state.status != "ready" or not job.path or not job.path.is_file():
            raise MediaError("This file is not ready to download.", 409)
        if not job.state.expires_at or time.time() >= job.state.expires_at:
            raise MediaError("This download expired. Prepare it again.", 410)
        job.ticket = secrets.token_urlsafe(32)
        job.ticket_expires = time.time() + 60
        return job.ticket

    def acquire_file(self, job_id: str, ticket: str) -> Job:
        job = self.get(job_id)
        if (
            not job.ticket
            or not secrets.compare_digest(job.ticket, ticket)
            or time.time() >= job.ticket_expires
        ):
            raise MediaError("This download link expired. Tap Save file to create a new one.", 401)
        if job.state.status != "ready" or not job.path or not job.path.is_file():
            raise MediaError("This file is no longer available. Prepare it again.", 410)
        if not job.state.expires_at or time.time() >= job.state.expires_at:
            raise MediaError("This file expired. Prepare it again.", 410)
        job.active_transfers += 1
        return job

    @staticmethod
    def release_file(job: Job) -> None:
        job.active_transfers = max(0, job.active_transfers - 1)

    @staticmethod
    def _remove_files(job: Job) -> None:
        shutil.rmtree(job.directory, ignore_errors=True)

    async def cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            self.cleanup()

    def cleanup(self) -> None:
        now = time.time()
        for job_id, job in list(self.jobs.items()):
            if job.state.status in ("queued", "downloading", "processing") or job.active_transfers:
                continue
            expires = (
                job.state.expires_at
                if job.state.expires_at is not None
                else job.created_at + self.settings.file_ttl_seconds
            )
            if now >= expires:
                self._remove_files(job)
                del self.jobs[job_id]

    async def close(self) -> None:
        for job_id in list(self.jobs):
            await self.cancel(job_id)
