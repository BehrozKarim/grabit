"""Keep an optional YouTube session on the backend, separate from downloadable files."""

import os
import warnings
from http.cookiejar import LoadError, MozillaCookieJar
from pathlib import Path

from app.errors import MediaError


class YouTubeSession:
    def __init__(self, source: Path | None, download_dir: Path):
        self.source = source
        self.directory = download_dir / ".session"
        self._working_file: Path | None = None

    def prepare(self) -> Path | None:
        if self.source is None:
            return None
        if self._working_file is not None:
            return self._working_file
        try:
            if self.source.stat().st_size > 1024 * 1024:
                raise MediaError("The YouTube cookie file exceeds the 1 MiB limit.")
            jar = MozillaCookieJar(str(self.source))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                jar.load(ignore_discard=True, ignore_expires=True)
            for cookie in list(jar):
                host = cookie.domain.lower().lstrip(".")
                if host != "youtube.com" and not host.endswith(".youtube.com"):
                    jar.clear(cookie.domain, cookie.path, cookie.name)
            if not list(jar):
                raise MediaError("The cookie file contains no YouTube cookies. Export youtube.com.")
            # Render's mounted secret can be read-only. yt-dlp updates a private,
            # writable copy; the original secret and other browser cookies stay out.
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self.directory / "youtube-cookies.txt"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.close(descriptor)
            os.chmod(path, 0o600)
            jar.save(str(path), ignore_discard=True, ignore_expires=True)
            self._working_file = path
            return path
        except (OSError, LoadError, ValueError) as error:
            raise MediaError(
                "The backend could not read its YouTube cookie file. "
                "Configure a valid Netscape cookie file as a Render secret."
            ) from error
