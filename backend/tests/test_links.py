import httpx
import pytest

from app.errors import MediaError
from app.links import resolve_share_url


@pytest.mark.parametrize(
    "share",
    [
        "https://fb.watch/v/3_zSxAwpK/",
        "https://www.facebook.com/share/v/19jdQ5gd42/",
    ],
)
async def test_facebook_share_redirects_are_resolved_without_generic_extraction(share):
    target = "https://www.facebook.com/watch/?v=1119567540782702"
    requested = []

    def handler(request):
        requested.append(str(request.url))
        return httpx.Response(302, headers={"Location": target})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await resolve_share_url(share, client) == target
    assert requested == [share]


@pytest.mark.parametrize(
    "target",
    [
        "http://www.facebook.com/watch/?v=1",
        "https://127.0.0.1/private",
        "https://facebook.com.evil.test/video",
        "https://user:pass@www.facebook.com/watch/?v=1",
        "https://www.youtube.com/watch?v=1",
    ],
)
async def test_share_redirect_is_validated_before_following(target):
    calls = []

    def handler(request):
        calls.append(request.url)
        return httpx.Response(302, headers={"Location": target})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(MediaError):
            await resolve_share_url("https://fb.watch/test/", client)
    assert len(calls) == 1


async def test_redirect_loops_are_bounded_and_standard_video_links_do_not_make_requests():
    calls = []

    def handler(request):
        calls.append(request.url)
        return httpx.Response(302, headers={"Location": "/loop/"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        standard = "https://www.facebook.com/watch/?v=1"
        assert await resolve_share_url(standard, client) == standard
        assert not calls
        with pytest.raises(MediaError, match="did not resolve"):
            await resolve_share_url("https://fb.watch/test/", client)
    assert len(calls) == 5
