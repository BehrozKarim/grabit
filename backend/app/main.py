import asyncio
import contextlib
import mimetypes
import secrets
import shutil
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from app.browser import browser_plan
from app.config import Settings
from app.downloader import YtDlpDownloader
from app.errors import MediaError
from app.jobs import JobService
from app.media import MediaService
from app.models import (
    BrowserPlan,
    CreateJobRequest,
    DownloadTicket,
    InspectRequest,
    JobStatus,
    MediaInfo,
)
from app.process import ProcessRunner


def create_app(settings: Settings | None = None, downloader=None) -> FastAPI:
    config = settings or Settings()
    gate = asyncio.Lock()
    engine = downloader or YtDlpDownloader(config, ProcessRunner())
    media = MediaService(config, engine, gate)
    jobs = JobService(config, media, engine, gate)
    inspections: deque[float] = deque()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        root = config.download_dir.resolve()
        root.mkdir(parents=True, exist_ok=True)
        # Only delete directories matching this service's generated job IDs.
        for directory in root.iterdir():
            if directory.is_dir() and len(directory.name) == 32:
                with contextlib.suppress(ValueError):
                    int(directory.name, 16)
                    shutil.rmtree(directory)
        cleanup = asyncio.create_task(jobs.cleanup_loop())
        yield
        cleanup.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cleanup
        await jobs.close()

    app = FastAPI(title="Grabit API", version="0.1.0", lifespan=lifespan)
    app.state.media = media
    app.state.jobs = jobs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > 8192:
            return JSONResponse({"detail": "Request body is too large."}, status_code=413)
        # Also bound chunked bodies without trusting the Content-Length header.
        if request.method in ("POST", "PUT", "PATCH"):
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 8192:
                    return JSONResponse({"detail": "Request body is too large."}, status_code=413)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(MediaError)
    async def media_error_handler(request: Request, error: MediaError):
        return JSONResponse(status_code=error.status_code, content={"detail": error.message})

    async def authorize(request: Request, authorization: str | None = Header(default=None)):
        if config.env == "development" and not config.api_key:
            if not request.client or request.client.host not in ("127.0.0.1", "::1", "testclient"):
                raise HTTPException(403, "Development access is restricted to this computer.")
            return
        expected = f"Bearer {config.api_key}"
        if not authorization or not secrets.compare_digest(
            authorization.encode(), expected.encode()
        ):
            raise HTTPException(401, "Connect with your personal access key in Settings.")

    protected = [Depends(authorize)]

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/config", dependencies=protected)
    async def public_config():
        return {
            "max_duration_seconds": config.max_duration_seconds,
            "max_file_mb": config.max_file_mb,
            "file_ttl_seconds": config.file_ttl_seconds,
            "platforms": ["YouTube", "Facebook", "Instagram", "TikTok", "X"],
        }

    @app.post("/api/media", response_model=MediaInfo, dependencies=protected)
    async def inspect_media(body: InspectRequest):
        now = time.monotonic()
        while inspections and now - inspections[0] >= 60:
            inspections.popleft()
        if config.inspections_per_minute and len(inspections) >= config.inspections_per_minute:
            raise MediaError("Too many link lookups. Wait a minute, then try again.", 429)
        if config.inspections_per_minute:
            inspections.append(now)
        return await media.inspect(body.url)

    @app.post("/api/plan", response_model=BrowserPlan, dependencies=protected)
    async def device_plan(body: CreateJobRequest):
        return browser_plan(media.get(body.media_id).info, body)

    @app.post("/api/jobs", status_code=202, response_model=JobStatus, dependencies=protected)
    async def create_job(body: CreateJobRequest):
        return jobs.create(body)

    @app.get("/api/jobs/{job_id}", response_model=JobStatus, dependencies=protected)
    async def get_job(job_id: str):
        return jobs.get(job_id).state

    @app.delete("/api/jobs/{job_id}", response_model=JobStatus, dependencies=protected)
    async def cancel_job(job_id: str):
        return await jobs.cancel(job_id)

    @app.post("/api/jobs/{job_id}/ticket", response_model=DownloadTicket, dependencies=protected)
    async def download_ticket(job_id: str):
        ticket = jobs.issue_ticket(job_id)
        return DownloadTicket(url=f"/api/files/{job_id}?ticket={ticket}", expires_in=60)

    @app.get("/api/files/{job_id}")
    async def download_file(job_id: str, ticket: str):
        job = jobs.acquire_file(job_id, ticket)
        assert job.path
        content_type = (
            mimetypes.guess_type(job.state.filename or "")[0] or "application/octet-stream"
        )
        return FileResponse(
            job.path,
            filename=job.state.filename,
            media_type=content_type,
            background=BackgroundTask(jobs.release_file, job),
        )

    return app
