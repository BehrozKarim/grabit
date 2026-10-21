import json
import math
import sys
from collections.abc import Callable
from pathlib import Path

from app.config import Settings
from app.errors import MediaError
from app.models import CreateJobRequest, FormatOption, MediaInfo
from app.process import ProcessRunner


def positive_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return float(value)
    return None


def format_options(info: dict) -> list[FormatOption]:
    """Offer one source format per resolution, favoring broadly playable H.264 MP4."""
    choices: dict[int, tuple[tuple, FormatOption]] = {}
    for item in info.get("formats") or [info]:
        height = positive_number(item.get("height"))
        video_codec = item.get("vcodec") or "none"
        if not height or video_codec == "none" or item.get("has_drm"):
            continue
        format_id = str(item.get("format_id", ""))
        # IDs are used in yt-dlp's format expression, so exclude expression syntax.
        if not format_id or not all(c.isalnum() or c in "_.-" for c in format_id):
            continue
        ext = item.get("ext", "mp4")
        if ext not in ("mp4", "webm", "mov", "mkv"):
            continue
        size = positive_number(item.get("filesize")) or positive_number(item.get("filesize_approx"))
        option = FormatOption(
            id=format_id,
            label=f"{int(height)}p",
            height=int(height),
            extension=ext,
            filesize=int(size) if size else None,
            has_audio=item.get("acodec") not in (None, "none"),
        )
        rank = (
            video_codec.startswith(("avc", "h264")),
            ext == "mp4",
            positive_number(item.get("tbr")) or 0,
        )
        if int(height) not in choices or rank > choices[int(height)][0]:
            choices[int(height)] = (rank, option)
    return [choices[height][1] for height in sorted(choices, reverse=True)]


class YtDlpDownloader:
    def __init__(self, settings: Settings, runner: ProcessRunner):
        self.settings = settings
        self.runner = runner

    @staticmethod
    def base_args() -> list[str]:
        return [
            sys.executable,
            "-m",
            "yt_dlp",
            "--ignore-config",
            "--no-cache-dir",
            "--no-playlist",
            "--socket-timeout",
            "15",
            "--retries",
            "2",
            "--extractor-retries",
            "1",
            "--no-warnings",
            "--js-runtimes",
            "node",
            "--use-extractors",
            "youtube.*,facebook.*,instagram.*,tiktok.*,twitter.*",
        ]

    async def inspect(self, url: str, platform: str, media_id: str) -> MediaInfo:
        raw = await self.runner.run(
            self.base_args() + ["--dump-single-json", "--skip-download", "--", url],
            timeout=90,
        )
        try:
            info = json.loads(raw)
        except (ValueError, TypeError) as error:
            raise MediaError("The platform returned an unreadable response. Try again.") from error
        duration = positive_number(info.get("duration"))
        if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
            raise MediaError("Live and upcoming streams are not supported. Try a recorded video.")
        if info.get("_type") in ("playlist", "multi_video"):
            raise MediaError("Use a link to one video rather than a playlist or multi-video post.")
        if not duration:
            raise MediaError("The video length could not be verified. Try a different video.")
        if duration > self.settings.max_duration_seconds:
            minutes = self.settings.max_duration_seconds // 60
            raise MediaError(f"Choose a video shorter than {minutes} minutes for this server.")
        formats = format_options(info)
        audio_available = any(
            f.get("acodec") not in (None, "none") and not f.get("has_drm")
            for f in (info.get("formats") or [info])
        )
        if not formats and not audio_available:
            raise MediaError("No downloadable video or audio formats were found.")
        thumbnail = info.get("thumbnail")
        if thumbnail and not str(thumbnail).startswith("https://"):
            thumbnail = None
        return MediaInfo(
            id=media_id,
            title=str(info.get("title") or "Untitled video")[:300],
            platform=platform,
            uploader=info.get("uploader"),
            thumbnail=thumbnail,
            duration=duration,
            formats=formats,
            audio_available=audio_available,
        )

    async def download(
        self,
        url: str,
        media: MediaInfo,
        request: CreateJobRequest,
        directory: Path,
        on_progress: Callable[[int, int | None], None],
    ) -> Path:
        args = self.base_args() + [
            "--no-simulate",
            "--newline",
            "--progress",
            "--progress-delta",
            "1",
            "--progress-template",
            "download:GRABIT_PROGRESS %(progress.downloaded_bytes)s "
            "%(progress.total_bytes)s %(progress.total_bytes_estimate)s",
            "--concurrent-fragments",
            "1",
            "--max-filesize",
            f"{self.settings.max_file_mb}M",
            "--match-filters",
            f"!is_live & duration <= {self.settings.max_duration_seconds}",
            "--output",
            str(directory / "media.%(ext)s"),
            "--no-write-info-json",
            "--no-write-thumbnail",
            "--no-write-subs",
        ]
        if request.mode == "audio":
            args += [
                "--format",
                "bestaudio/best",
                "--extract-audio",
                "--audio-format",
                request.audio_format,
                "--audio-quality",
                "192K",
            ]
        else:
            option = next((f for f in media.formats if f.id == request.format_id), None)
            if not option:
                raise MediaError("Choose one of the available video resolutions.")
            selector = option.id
            if not option.has_audio and media.audio_available:
                preferred = "m4a" if option.extension == "mp4" else "webm"
                selector = f"{option.id}+bestaudio[ext={preferred}]/{option.id}+bestaudio"
            args += ["--format", selector, "--merge-output-format", "mp4/webm/mkv"]

        def handle_line(line: str) -> None:
            if not line.startswith("GRABIT_PROGRESS "):
                return
            values = line.split()[1:]
            numbers = [int(v) if v.isdigit() else None for v in values]
            if len(numbers) == 3:
                on_progress(numbers[0] or 0, numbers[1] or numbers[2])
            # Bound temporary space as well as the final output, including unknown-size streams.
            size = sum(f.stat().st_size for f in directory.iterdir() if f.is_file())
            if size > self.settings.max_file_mb * 3 * 1024 * 1024:
                raise MediaError("This download exceeds the temporary storage limit.")

        await self.runner.run(
            args + ["--", url],
            timeout=self.settings.job_timeout_seconds,
            on_line=handle_line,
        )
        files = [
            p
            for p in directory.iterdir()
            if p.suffix in (".mp4", ".webm", ".mkv", ".mov", ".mp3", ".m4a")
        ]
        if len(files) != 1 or not files[0].is_file():
            raise MediaError("The download did not produce a complete file. Try another format.")
        result = files[0]
        if result.stat().st_size > self.settings.max_file_mb * 1024 * 1024:
            raise MediaError("The finished file exceeds the size limit. Choose a lower resolution.")
        if result.stat().st_size == 0:
            raise MediaError("The platform returned an empty file. Try another video.")
        return result
