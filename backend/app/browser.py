"""Build credential-free device plans from cached extractor output; never proxy media."""

from urllib.parse import urlsplit

from app.errors import MediaError
from app.models import BrowserPlan, BrowserSource, CreateJobRequest, MediaInfo
from app.values import positive_number

SOURCE_DOMAINS = (
    "googlevideo.com",
    "fbcdn.net",
    "cdninstagram.com",
    "twimg.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokcdn-eu.com",
    "byteoversea.com",
    "ibytedtos.com",
    "muscdn.com",
    "tiktok.com",
    "akamaized.net",
    "instagram.com",
    "facebook.com",
)


def safe_source_url(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 16384:
        return False
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        return (
            url.scheme == "https"
            and not url.username
            and not url.password
            and url.port in (None, 443)
            and not url.fragment
            and not any(ord(c) < 32 or c == "\\" for c in value)
            and any(host == domain or host.endswith("." + domain) for domain in SOURCE_DOMAINS)
        )
    except ValueError:
        return False


def browser_formats(info: dict) -> list[dict]:
    result = []
    for item in info.get("formats") or [info]:
        headers = {
            str(k).lower()
            for k in {**(info.get("http_headers") or {}), **(item.get("http_headers") or {})}
        }
        if (
            not safe_source_url(item.get("url"))
            or item.get("has_drm")
            or item.get("protocol") not in ("https", "http", None)
            or item.get("fragments")
            or headers & {"authorization", "cookie"}
            or info.get("cookies")
            or item.get("cookies")
            or item.get("ext") not in ("mp4", "webm", "mov", "mkv", "m4a", "mp3")
        ):
            continue
        result.append(
            {
                key: item.get(key)
                for key in (
                    "format_id",
                    "url",
                    "ext",
                    "vcodec",
                    "acodec",
                    "filesize",
                    "filesize_approx",
                    "abr",
                )
            }
        )
    return result


def browser_plan(media: MediaInfo, request: CreateJobRequest) -> BrowserPlan:
    formats = media._browser_formats
    unavailable = BrowserPlan(
        route="server",
        reason="The platform did not provide a browser-compatible source for this format.",
    )

    def source(item: dict) -> BrowserSource:
        size = positive_number(item.get("filesize")) or positive_number(item.get("filesize_approx"))
        return BrowserSource(
            url=item["url"],
            extension=item["ext"],
            filesize=int(size) if size else None,
        )

    def audio(preferred: str) -> dict | None:
        choices = [f for f in formats if f.get("acodec") not in (None, "none")]
        return max(
            choices,
            key=lambda f: (
                f.get("vcodec") in (None, "none"),
                f["ext"] == preferred,
                positive_number(f.get("abr")) or 0,
            ),
            default=None,
        )

    if request.mode == "audio":
        if not media.audio_available:
            raise MediaError("No audio track is available for this video.")
        selected = audio(request.audio_format)
        if not selected:
            return unavailable
        direct = (
            selected.get("vcodec") in (None, "none") and selected["ext"] == request.audio_format
        )
        return BrowserPlan(
            route="direct" if direct else "convert",
            sources=[source(selected)],
            extension=request.audio_format,
        )
    option = next((f for f in media.formats if f.id == request.format_id), None)
    if not option:
        raise MediaError("Choose one of the available video resolutions.")
    selected = next((f for f in formats if str(f["format_id"]) == option.id), None)
    if not selected:
        return unavailable
    if option.has_audio or not media.audio_available:
        return BrowserPlan(route="direct", sources=[source(selected)], extension=selected["ext"])
    track = audio("m4a" if option.extension == "mp4" else "webm")
    if not track:
        return unavailable
    # Matroska accepts mixed codecs when a matching MP4/WebM audio stream is unavailable.
    extension = (
        option.extension
        if (option.extension, track["ext"]) in (("mp4", "m4a"), ("webm", "webm"))
        else "mkv"
    )
    return BrowserPlan(
        route="merge", sources=[source(selected), source(track)], extension=extension
    )
