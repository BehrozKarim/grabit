import json
import os
from pathlib import Path

import pytest
from yt_dlp.utils import match_str

from app.cookies import YouTubeSession
from app.downloader import YtDlpDownloader
from app.errors import MediaError
from app.models import CreateJobRequest


@pytest.fixture
def cookie_source(tmp_path):
    path = tmp_path / "mounted-secret.txt"
    path.write_text(
        "# Netscape HTTP Cookie File\n"
        ".youtube.com\tTRUE\t/\tTRUE\t2147483647\tGRABIT_TEST\tfake-youtube-cookie\n"
        ".example.com\tTRUE\t/\tTRUE\t2147483647\tUNRELATED\tother-site-secret\n",
        encoding="utf-8",
    )
    return path


def test_cookie_copy_is_youtube_only_writable_and_reused(cookie_source, tmp_path):
    original = cookie_source.read_bytes()
    session = YouTubeSession(cookie_source, tmp_path / "downloads")
    working = session.prepare()
    assert working is not None and working != cookie_source
    assert "fake-youtube-cookie" in working.read_text()
    assert "other-site-secret" not in working.read_text()
    if os.name != "nt":
        assert working.stat().st_mode & 0o777 == 0o600
    # yt-dlp may rotate cookies; preserve the updated working session between calls.
    working.write_text("updated-session")
    assert session.prepare().read_text() == "updated-session"
    assert cookie_source.read_bytes() == original


@pytest.mark.parametrize("contents", ["secret-invalid-format", "# Netscape HTTP Cookie File\n"])
def test_invalid_secret_is_reported_without_contents_or_path(tmp_path, contents):
    source = tmp_path / "private-cookie-path.txt"
    source.write_text(contents)
    with pytest.raises(MediaError) as captured:
        YouTubeSession(source, tmp_path / "downloads").prepare()
    assert "secret-invalid-format" not in str(captured.value)
    assert "private-cookie-path" not in str(captured.value)


def test_missing_cookie_secret_does_not_affect_other_platforms(settings, tmp_path):
    settings.youtube_cookies_file = tmp_path / "missing-secret.txt"
    engine = YtDlpDownloader(settings, None)
    assert "--cookies" not in engine.base_args("https://www.instagram.com/reel/test/")
    assert "--cookies" not in engine.base_args("https://www.facebook.com/watch/123")
    with pytest.raises(MediaError, match="could not read"):
        engine.base_args("https://youtu.be/test")


class CookieRunner:
    def __init__(self, availability="public", age_limit=0):
        self.availability = availability
        self.age_limit = age_limit
        self.calls = []

    async def run(self, args, **kwargs):
        self.calls.append(args)
        cookie_file = Path(args[args.index("--cookies") + 1])
        assert "other-site-secret" not in cookie_file.read_text()
        if "--output" in args:
            target = Path(args[args.index("--output") + 1].replace("%(ext)s", "mp4"))
            target.write_bytes(b"video")
            return ""
        return json.dumps(
            {
                "availability": self.availability,
                "age_limit": self.age_limit,
                "duration": 12,
                "title": "Public video",
                "formats": [
                    {
                        "format_id": "720",
                        "height": 720,
                        "vcodec": "avc1",
                        "acodec": "aac",
                        "ext": "mp4",
                        "protocol": "https",
                        "url": "https://rr1.googlevideo.com/file",
                    }
                ],
            }
        )


async def test_cookie_mode_keeps_source_urls_off_frontend_and_filters_downloads(
    settings, cookie_source, tmp_path
):
    settings.youtube_cookies_file = cookie_source
    runner = CookieRunner()
    engine = YtDlpDownloader(settings, runner)
    media = await engine.inspect("https://youtu.be/test", "YouTube", "a" * 32)
    assert len(media.formats) == 1
    assert media._browser_formats == []
    assert "fake-youtube-cookie" not in media.model_dump_json()
    directory = tmp_path / "job"
    directory.mkdir()
    await engine.download(
        "https://youtu.be/test",
        media,
        CreateJobRequest(media_id=media.id, format_id="720"),
        directory,
        lambda *_: None,
    )
    args = runner.calls[-1]
    policy = args[args.index("--match-filters") + 1]
    assert match_str(policy, {"availability": "public", "age_limit": 0, "duration": 12})
    assert match_str(policy, {"availability": "unlisted", "duration": 12})
    assert not match_str(policy, {"availability": "private", "duration": 12})
    assert not match_str(policy, {"availability": "subscriber_only", "duration": 12})
    assert not match_str(policy, {"availability": "public", "age_limit": 18, "duration": 12})


@pytest.mark.parametrize("availability", ["private", "subscriber_only", "premium_only", None])
async def test_cookie_mode_rejects_nonpublic_and_unknown_access(
    settings, cookie_source, availability
):
    settings.youtube_cookies_file = cookie_source
    engine = YtDlpDownloader(settings, CookieRunner(availability))
    with pytest.raises(MediaError, match="only supports public"):
        await engine.inspect("https://youtu.be/test", "YouTube", "a" * 32)


async def test_cookie_mode_rejects_age_restricted_content(settings, cookie_source):
    settings.youtube_cookies_file = cookie_source
    engine = YtDlpDownloader(settings, CookieRunner(age_limit=18))
    with pytest.raises(MediaError, match="only supports public"):
        await engine.inspect("https://youtu.be/test", "YouTube", "a" * 32)
