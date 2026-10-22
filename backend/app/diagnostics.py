"""Build-time diagnostics without credentials, source URLs or media downloads."""

import argparse
import asyncio
import json
import os
import platform
import re
import shutil
import subprocess
from importlib.metadata import PackageNotFoundError, version

from app.config import Settings
from app.downloader import YtDlpDownloader
from app.errors import MediaError
from app.platforms import validate_media_url
from app.process import ProcessRunner


def package_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "missing"


def node_version() -> str:
    executable = shutil.which("node")
    if not executable:
        return "missing"
    try:
        result = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=5, check=True
        )
    except (OSError, subprocess.SubprocessError):
        return "unavailable"
    value = result.stdout.strip()
    return value if re.fullmatch(r"v\d+\.\d+\.\d+", value) else "unrecognized"


async def collect_diagnostics(youtube_url: str | None = None) -> dict:
    settings = Settings(_env_file=None, env="development")
    node = node_version()
    match = re.fullmatch(r"v(\d+)\.\d+\.\d+", node)
    report = {
        "python": platform.python_version(),
        "yt_dlp": package_version("yt-dlp"),
        "yt_dlp_ejs": package_version("yt-dlp-ejs"),
        "node": node,
        "node_supported": bool(match and int(match[1]) >= 22),
        "ffmpeg_available": bool(shutil.which("ffmpeg")),
        "ffprobe_available": bool(shutil.which("ffprobe")),
        "youtube_cookies_configured": settings.youtube_cookies_file is not None,
    }
    if not youtube_url:
        return report
    if settings.youtube_cookies_file and not settings.youtube_cookies_file.is_file():
        # Secret mounts are guaranteed at runtime, not in every build environment.
        report["youtube"] = {
            "status": "skipped",
            "message": "The configured cookie secret is not mounted here. Test at runtime.",
        }
        return report
    try:
        url, provider = validate_media_url(youtube_url)
        if provider != "YouTube":
            raise MediaError("The diagnostic requires a public YouTube video link.")
        # Metadata only; no production key, application startup or download is needed.
        engine = YtDlpDownloader(settings, ProcessRunner())
        media = await engine.inspect(url, provider, "0" * 32)
        report["youtube"] = {
            "status": "ok",
            "format_count": len(media.formats),
            "duration": media.duration,
        }
    except MediaError as error:
        report["youtube"] = {"status": "failed", "message": error.message}
    except OSError:
        report["youtube"] = {
            "status": "failed",
            "message": "The extractor process could not start.",
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--youtube-url", default=os.environ.get("GRABIT_DIAGNOSTIC_YOUTUBE_URL"))
    args = parser.parse_args()
    # An upstream rejection is a diagnostic result, not a reason to fail the deploy.
    print("GRABIT_DIAGNOSTICS " + json.dumps(asyncio.run(collect_diagnostics(args.youtube_url))))


if __name__ == "__main__":
    main()
