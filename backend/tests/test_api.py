import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeDownloader

URL = "https://www.youtube.com/watch?v=test"


def create_download(client, **overrides):
    response = client.post("/api/media", json={"url": URL})
    assert response.status_code == 200
    media = response.json()
    request = {"media_id": media["id"], "format_id": "720", **overrides}
    response = client.post("/api/jobs", json=request)
    assert response.status_code == 202
    job_id = response.json()["id"]
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "ready":
            return job
    pytest.fail("Test download did not complete")


def test_production_requires_strong_key():
    with pytest.raises(ValueError, match="API_KEY"):
        Settings(_env_file=None, env="production", api_key="short")


def test_protected_api_and_health(settings):
    settings.env = "production"
    settings.api_key = "test-personal-access-key-with-length"
    with TestClient(create_app(settings, FakeDownloader())) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/config").status_code == 401
        assert (
            client.get("/api/config", headers={"Authorization": "Bearer wrong"}).status_code == 401
        )
        response = client.get(
            "/api/config", headers={"Authorization": f"Bearer {settings.api_key}"}
        )
        assert response.status_code == 200
        assert "api_key" not in response.text


def test_inspect_rejects_unsupported_urls(client):
    response = client.post("/api/media", json={"url": "http://127.0.0.1/secrets"})
    assert response.status_code == 422


def test_video_download_requires_ticket_and_has_attachment_header(client):
    job = create_download(client)
    job_id = job["id"]
    assert client.get(f"/api/files/{job_id}?ticket=wrong").status_code == 401
    ticket = client.post(f"/api/jobs/{job_id}/ticket").json()
    response = client.get(ticket["url"])
    assert response.status_code == 200
    assert response.content == b"fixture-media-bytes"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["cache-control"] == "no-store"
    assert "test-personal" not in ticket["url"]


def test_audio_job_returns_mp3(client):
    job = create_download(client, mode="audio", audio_format="mp3")
    assert job["filename"].endswith(".mp3")


def test_rejects_arbitrary_format_expression(client):
    media = client.post("/api/media", json={"url": URL}).json()
    response = client.post(
        "/api/jobs", json={"media_id": media["id"], "format_id": "bestvideo+bestaudio"}
    )
    assert response.status_code == 422


def test_expired_media_cannot_create_job(client):
    media = client.post("/api/media", json={"url": URL}).json()
    client.app.state.media.cache[media["id"]].created_at = 0
    response = client.post("/api/jobs", json={"media_id": media["id"], "format_id": "720"})
    assert response.status_code == 410


def test_ticket_and_file_expiry(client):
    job = create_download(client)
    job_id = job["id"]
    ticket = client.post(f"/api/jobs/{job_id}/ticket").json()
    record = client.app.state.jobs.get(job_id)
    record.ticket_expires = 0
    assert client.get(ticket["url"]).status_code == 401
    record.state.expires_at = 0
    assert client.post(f"/api/jobs/{job_id}/ticket").status_code == 410
    client.app.state.jobs.cleanup()
    assert not record.directory.exists()
    assert client.get(f"/api/jobs/{job_id}").status_code == 410


def test_cors_only_allows_configured_frontend(client):
    headers = {"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"}
    assert client.options("/api/media", headers=headers).status_code == 400
    headers["Origin"] = "http://localhost:5173"
    assert client.options("/api/media", headers=headers).status_code == 200


def test_lookup_rate_limit(client):
    for _ in range(6):
        assert client.post("/api/media", json={"url": URL}).status_code == 200
    assert client.post("/api/media", json={"url": URL}).status_code == 429


def test_body_size_limit(client):
    assert client.post("/api/media", content=b"x" * 8193).status_code == 413


def test_cancel_removes_ready_file(client):
    job = create_download(client)
    record = client.app.state.jobs.get(job["id"])
    assert client.delete(f"/api/jobs/{job['id']}").json()["status"] == "cancelled"
    assert not record.directory.exists()
