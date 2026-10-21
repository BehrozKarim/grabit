import asyncio
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Protocol

from app.config import Settings
from app.errors import MediaError
from app.models import MediaInfo
from app.platforms import validate_media_url


class MediaInspector(Protocol):
    async def inspect(self, url: str, platform: str, media_id: str) -> MediaInfo: ...


@dataclass
class CachedMedia:
    url: str
    info: MediaInfo
    created_at: float


class MediaService:
    def __init__(self, settings: Settings, inspector: MediaInspector, gate: asyncio.Lock):
        self.settings = settings
        self.inspector = inspector
        self.gate = gate
        self.cache: OrderedDict[str, CachedMedia] = OrderedDict()

    async def inspect(self, value: str) -> MediaInfo:
        url, platform = validate_media_url(value)
        if self.gate.locked():
            raise MediaError(
                "The server is preparing a video. Wait for it to finish, then retry.", 429
            )
        async with self.gate:
            media_id = uuid.uuid4().hex
            info = await self.inspector.inspect(url, platform, media_id)
        self.cache[media_id] = CachedMedia(url, info, time.monotonic())
        while len(self.cache) > 100:
            self.cache.popitem(last=False)
        return info

    def get(self, media_id: str) -> CachedMedia:
        entry = self.cache.get(media_id)
        if not entry or time.monotonic() - entry.created_at > self.settings.metadata_ttl_seconds:
            self.cache.pop(media_id, None)
            raise MediaError("These formats expired. Fetch the video again.", 410)
        return entry
