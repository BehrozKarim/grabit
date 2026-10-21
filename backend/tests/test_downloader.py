import json

import pytest

from app.downloader import YtDlpDownloader, format_options
from app.errors import MediaError
from app.platforms import validate_media_url


@pytest.mark.parametrize(
    "url",
    [
        "https://youtube.com.evil.example/watch?v=test",
        "https://evil.example/youtube.com",
        "https://user:pass@youtube.com/watch?v=test",
        "http://youtube.com/watch?v=test",
        "https://127.0.0.1/video",
        "file:///etc/passwd",
        "https://youtube.com:8000/video",
        "https://youtube.com/",
        "https://youtube.com:bad/video",
    ],
)
def test_url_allowlist_rejects_unsafe_input(url):
    with pytest.raises(MediaError):
        validate_media_url(url)


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://youtu.be/test", "YouTube"),
        ("https://m.facebook.com/reel/123", "Facebook"),
        ("https://www.instagram.com/reel/123", "Instagram"),
        ("https://vm.tiktok.com/test", "TikTok"),
        ("https://x.com/user/status/123", "X"),
    ],
)
def test_supported_share_links(url, platform):
    assert validate_media_url(url)[1] == platform


def test_format_selection_prefers_h264_and_excludes_drm():
    formats = format_options(
        {
            "formats": [
                {"format_id": "av1", "height": 720, "vcodec": "av01", "ext": "mp4", "tbr": 5000},
                {
                    "format_id": "h264",
                    "height": 720,
                    "vcodec": "avc1",
                    "ext": "mp4",
                    "acodec": "aac",
                },
                {
                    "format_id": "drm",
                    "height": 1080,
                    "vcodec": "avc1",
                    "ext": "mp4",
                    "has_drm": True,
                },
                {"format_id": "audio", "vcodec": "none", "acodec": "opus"},
                {"format_id": "a+b", "height": 480, "vcodec": "avc1", "ext": "mp4"},
            ]
        }
    )
    assert [f.id for f in formats] == ["h264"]
    assert formats[0].has_audio


class JsonRunner:
    def __init__(self, info):
        self.info = info

    async def run(self, args, **kwargs):
        assert "--no-playlist" in args
        return json.dumps(self.info)


@pytest.mark.parametrize(
    "info",
    [
        {"duration": 0},
        {"duration": None},
        {"duration": 30, "is_live": True},
        {"duration": 30, "_type": "playlist"},
    ],
)
async def test_unsupported_media_is_rejected_before_download(settings, info):
    engine = YtDlpDownloader(settings, JsonRunner(info))
    with pytest.raises(MediaError):
        await engine.inspect("https://youtu.be/test", "YouTube", "a" * 32)
