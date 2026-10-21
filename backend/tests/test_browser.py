import pytest

from app.browser import browser_formats, browser_plan, safe_source_url
from app.downloader import YtDlpDownloader
from app.models import CreateJobRequest
from tests.test_downloader import JsonRunner


def metadata(**changes):
    return {
        "duration": 9999,
        "formats": [
            {
                "format_id": "720",
                "height": 720,
                "ext": "mp4",
                "vcodec": "avc1",
                "acodec": "none",
                "url": "https://rr1.googlevideo.com/video",
                "protocol": "https",
                "filesize": 300 * 1024 * 1024,
            },
            {
                "format_id": "audio",
                "ext": "m4a",
                "vcodec": "none",
                "acodec": "aac",
                "url": "https://rr1.googlevideo.com/audio",
                "protocol": "https",
            },
        ],
        **changes,
    }


async def test_hosted_inspection_and_device_merge_ignore_server_caps(settings):
    media = await YtDlpDownloader(settings, JsonRunner(metadata())).inspect(
        "https://youtu.be/test", "YouTube", "a" * 32
    )
    plan = browser_plan(media, CreateJobRequest(media_id=media.id, format_id="720"))
    assert media.duration == 9999
    assert plan.route == "merge"
    assert plan.extension == "mp4"
    assert len(plan.sources) == 2
    assert plan.sources[0].filesize > settings.max_file_mb * 1024 * 1024
    assert "googlevideo" not in media.model_dump_json()


async def test_complete_file_and_existing_m4a_use_direct_route(settings):
    info = metadata()
    info["formats"][0]["acodec"] = "aac"
    media = await YtDlpDownloader(settings, JsonRunner(info)).inspect(
        "https://youtu.be/test", "YouTube", "a" * 32
    )
    assert (
        browser_plan(media, CreateJobRequest(media_id=media.id, format_id="720")).route == "direct"
    )
    plan = browser_plan(
        media, CreateJobRequest(media_id=media.id, mode="audio", audio_format="m4a")
    )
    assert plan.route == "direct"
    mp3 = browser_plan(media, CreateJobRequest(media_id=media.id, mode="audio", audio_format="mp3"))
    assert mp3.route == "convert"
    assert mp3.sources[0].extension == "m4a"


@pytest.mark.parametrize(
    "url",
    [
        "http://rr1.googlevideo.com/video",
        "https://googlevideo.com.evil.test/video",
        "https://127.0.0.1/video",
        "https://localhost/video",
        "https://user:pass@video.twimg.com/x",
        "https://video.twimg.com:8000/x",
        "https://video.twimg.com/x#fragment",
        "https://video.twimg.com\\@evil.test/x",
        "https://video.twimg.com/x\n",
    ],
)
def test_unsafe_source_urls_are_never_exposed(url):
    assert not safe_source_url(url)


@pytest.mark.parametrize(
    "changes",
    [
        {"protocol": "m3u8_native"},
        {"protocol": "http_dash_segments"},
        {"has_drm": True},
        {"http_headers": {"Cookie": "secret"}},
        {"http_headers": {"Authorization": "secret"}},
        {"fragments": [{"url": "https://video.twimg.com/part"}]},
    ],
)
def test_browser_sources_exclude_manifests_credentials_and_drm(changes):
    info = metadata()
    info["formats"] = [{**info["formats"][0], **changes}]
    assert browser_formats(info) == []


def test_device_plan_does_not_create_jobs_and_fallback_enforces_limits(client):
    response = client.post("/api/media", json={"url": "https://youtu.be/test"})
    media_id = response.json()["id"]
    cached = client.app.state.media.get(media_id)
    cached.info._browser_formats = browser_formats(metadata())
    cached.info.formats[0].has_audio = False
    cached.info.duration = 9999
    request = {"media_id": media_id, "format_id": "720"}
    plan = client.post("/api/plan", json=request)
    assert plan.status_code == 200
    assert plan.json()["route"] == "merge"
    assert not client.app.state.jobs.jobs
    assert not list(client.app.state.jobs.settings.download_dir.iterdir())
    denied = client.post("/api/jobs", json=request)
    assert denied.status_code == 422
    assert "duration" in denied.json()["detail"]
    cached.info.duration = 12
    cached.info.formats[0].filesize = 300 * 1024 * 1024
    denied = client.post("/api/jobs", json=request)
    assert "size limit" in denied.json()["detail"]
    assert not client.app.state.jobs.jobs


def test_missing_browser_source_offers_server_and_expired_plan_requests_refresh(client):
    media_id = client.post("/api/media", json={"url": "https://youtu.be/test"}).json()["id"]
    request = {"media_id": media_id, "format_id": "720"}
    assert client.post("/api/plan", json=request).json()["route"] == "server"
    client.app.state.media.cache.clear()
    assert client.post("/api/plan", json=request).status_code == 410
