from urllib.parse import urlsplit, urlunsplit

from app.errors import MediaError

PLATFORMS = {
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "facebook.com": "Facebook",
    "fb.watch": "Facebook",
    "fb.com": "Facebook",
    "instagram.com": "Instagram",
    "tiktok.com": "TikTok",
    "x.com": "X",
    "twitter.com": "X",
}


def validate_media_url(value: str) -> tuple[str, str]:
    try:
        url = urlsplit(value.strip())
        if url.scheme != "https" or url.username or url.password or url.port not in (None, 443):
            raise ValueError
        host = (url.hostname or "").lower()
        for domain, platform in PLATFORMS.items():
            if host == domain or host.endswith("." + domain):
                if not url.path or url.path == "/":
                    raise MediaError("Paste a video or post link, rather than a platform homepage.")
                return urlunsplit(("https", host, url.path, url.query, "")), platform
    except ValueError:
        pass
    raise MediaError("Use an HTTPS video link from YouTube, Facebook, Instagram, TikTok, or X.")
