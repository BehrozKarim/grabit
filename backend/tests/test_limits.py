import json
from pathlib import Path

import pytest

from app.config import Settings
from app.downloader import YtDlpDownloader
from app.errors import MediaError
from app.models import CreateJobRequest, FormatOption, MediaInfo


class FileRunner:
    def __init__(self, size):
        self.size = size
        self.args = []
        self.timeout = "unset"

    async def run(self, args, *, timeout, on_line=None):
        self.args = args
        self.timeout = timeout
        output = Path(args[args.index("--output") + 1].replace("%(ext)s", "mp4"))
        output.write_bytes(b"x" * self.size)
        if on_line:
            on_line(f"GRABIT_PROGRESS {self.size} {self.size} NA")
        return ""


def media_info():
    return MediaInfo(
        id="a" * 32,
        title="Video",
        platform="YouTube",
        uploader=None,
        thumbnail=None,
        duration=9999,
        formats=[FormatOption(id="720", label="720p", extension="mp4", has_audio=True)],
        audio_available=True,
    )


async def test_local_defaults_disable_size_duration_and_download_timeout(tmp_path):
    settings = Settings(_env_file=None, env="development", download_dir=tmp_path)
    runner = FileRunner(1024)
    result = await YtDlpDownloader(settings, runner).download(
        "https://youtu.be/test",
        media_info(),
        CreateJobRequest(media_id="a" * 32, format_id="720"),
        tmp_path,
        lambda *_: None,
    )
    assert result.stat().st_size == 1024
    assert "--max-filesize" not in runner.args
    assert runner.args[runner.args.index("--match-filters") + 1] == "!is_live"
    assert runner.timeout is None
    assert settings.inspections_per_minute == 0


async def test_bounded_backend_still_rejects_oversized_output(settings, tmp_path):
    settings.max_file_mb = 1
    runner = FileRunner(2 * 1024 * 1024)
    with pytest.raises(MediaError, match="finished file exceeds"):
        await YtDlpDownloader(settings, runner).download(
            "https://youtu.be/test",
            media_info(),
            CreateJobRequest(media_id="a" * 32, format_id="720"),
            tmp_path,
            lambda *_: None,
        )
    assert runner.args[runner.args.index("--max-filesize") + 1] == "1M"
    assert runner.timeout == 600


async def test_bounded_backend_still_rejects_excessive_temporary_storage(settings, tmp_path):
    settings.max_file_mb = 1
    with pytest.raises(MediaError, match="temporary storage"):
        await YtDlpDownloader(settings, FileRunner(4 * 1024 * 1024)).download(
            "https://youtu.be/test",
            media_info(),
            CreateJobRequest(media_id="a" * 32, format_id="720"),
            tmp_path,
            lambda *_: None,
        )


async def test_local_backend_accepts_long_recorded_videos():
    class MetadataRunner:
        async def run(self, *args, **kwargs):
            return json.dumps(
                {
                    "duration": 9999,
                    "formats": [
                        {
                            "format_id": "720",
                            "height": 720,
                            "ext": "mp4",
                            "vcodec": "avc1",
                            "acodec": "aac",
                        },
                    ],
                }
            )

    settings = Settings(_env_file=None, env="development")
    result = await YtDlpDownloader(settings, MetadataRunner()).inspect(
        "https://youtu.be/test",
        "YouTube",
        "a" * 32,
    )
    assert result.duration == 9999


def test_size_limit_can_exceed_previous_500_mib_ceiling():
    assert Settings(_env_file=None, env="development", max_file_mb=5000).max_file_mb == 5000


@pytest.mark.parametrize("actual_duration", [12, 9999])
async def test_unknown_metadata_duration_is_checked_on_the_finished_hosted_file(
    settings, tmp_path, actual_duration
):
    class ProbeRunner(FileRunner):
        async def run(self, args, *, timeout, on_line=None):
            if args[0] == "ffprobe":
                return json.dumps({"format": {"duration": str(actual_duration)}})
            return await super().run(args, timeout=timeout, on_line=on_line)

    media = media_info()
    media.duration = None
    runner = ProbeRunner(1024)
    download = YtDlpDownloader(settings, runner).download(
        "https://www.instagram.com/reel/test/",
        media,
        CreateJobRequest(media_id=media.id, format_id="720"),
        tmp_path,
        lambda *_: None,
    )
    if actual_duration > settings.max_duration_seconds:
        with pytest.raises(MediaError, match="duration limit"):
            await download
    else:
        assert (await download).stat().st_size == 1024
    assert "duration <=? 1200" in runner.args[runner.args.index("--match-filters") + 1]
