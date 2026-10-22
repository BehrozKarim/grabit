"""Resolve supported share redirects without enabling yt-dlp's generic web extractor."""

from urllib.parse import urljoin, urlsplit

import httpx

from app.errors import MediaError
from app.platforms import validate_media_url


def is_facebook_share(url: str) -> bool:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    return host in ("fb.watch", "fb.com", "www.fb.watch", "www.fb.com") or (
        (host == "facebook.com" or host.endswith(".facebook.com"))
        and parsed.path.startswith(("/share/v/", "/share/r/"))
    )


async def resolve_share_url(url: str, client: httpx.AsyncClient | None = None) -> str:
    if not is_facebook_share(url):
        return url
    if client is None:
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=10, headers={"User-Agent": "Mozilla/5.0"}
        ) as owned:
            return await resolve_share_url(url, owned)
    try:
        for _ in range(5):
            async with client.stream("GET", url, follow_redirects=False) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        break
                    candidate, platform = validate_media_url(urljoin(url, location))
                    if platform != "Facebook":
                        raise MediaError("Facebook redirected outside its supported video hosts.")
                    url = candidate
                    if not is_facebook_share(url):
                        return url
                else:
                    break
    except httpx.HTTPError as error:
        raise MediaError(
            "Facebook's share link could not be resolved. Try its original video URL."
        ) from error
    raise MediaError("Facebook did not resolve this share link. Open it and copy the video URL.")
