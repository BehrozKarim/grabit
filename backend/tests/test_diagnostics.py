from unittest.mock import AsyncMock

import pytest

from app import diagnostics
from app.errors import MediaError
from app.models import MediaInfo


@pytest.mark.parametrize(
    ("node", "supported"), [("v24.12.0", True), ("v20.19.0", False), ("missing", False)]
)
async def test_runtime_check_does_not_contact_youtube_or_print_environment_secrets(
    monkeypatch, node, supported
):
    inspect = AsyncMock()
    monkeypatch.setattr(diagnostics.YtDlpDownloader, "inspect", inspect)
    monkeypatch.setenv("GRABIT_API_KEY", "private-backend-secret")
    monkeypatch.setattr(diagnostics, "node_version", lambda: node)
    report = await diagnostics.collect_diagnostics()
    assert report["node_supported"] is supported
    assert "private-backend-secret" not in str(report)
    inspect.assert_not_called()


def test_build_command_uses_opt_in_environment_and_keeps_failure_nonfatal(monkeypatch, capsys):
    url = "https://youtu.be/test"
    collect = AsyncMock(
        return_value={"youtube": {"status": "failed", "message": "bot verification"}}
    )
    monkeypatch.setenv("GRABIT_DIAGNOSTIC_YOUTUBE_URL", url)
    monkeypatch.setattr("sys.argv", ["diagnostics"])
    monkeypatch.setattr(diagnostics, "collect_diagnostics", collect)
    diagnostics.main()
    collect.assert_awaited_once_with(url)
    assert 'GRABIT_DIAGNOSTICS {"youtube": {"status": "failed"' in capsys.readouterr().out


async def test_metadata_check_omits_titles_and_source_urls(monkeypatch):
    inspect = AsyncMock(
        return_value=MediaInfo(
            id="0" * 32,
            title="private-title",
            platform="YouTube",
            duration=12,
            formats=[],
            audio_available=True,
            uploader=None,
            thumbnail=None,
        )
    )
    monkeypatch.setattr(diagnostics.YtDlpDownloader, "inspect", inspect)
    report = await diagnostics.collect_diagnostics("https://www.youtube.com/watch?v=test")
    assert report["youtube"] == {"status": "ok", "format_count": 0, "duration": 12}
    assert "private-title" not in str(report)
    assert "youtube.com" not in str(report)


async def test_upstream_rejection_is_reported_without_failing_the_build(monkeypatch):
    monkeypatch.setattr(
        diagnostics.YtDlpDownloader,
        "inspect",
        AsyncMock(side_effect=MediaError("bot verification")),
    )
    report = await diagnostics.collect_diagnostics("https://youtu.be/test")
    assert report["youtube"] == {"status": "failed", "message": "bot verification"}


@pytest.mark.parametrize("url", ["https://evil.example/video", "https://facebook.com/watch/123"])
async def test_diagnostic_rejects_non_youtube_sources(monkeypatch, url):
    inspect = AsyncMock()
    monkeypatch.setattr(diagnostics.YtDlpDownloader, "inspect", inspect)
    report = await diagnostics.collect_diagnostics(url)
    assert report["youtube"]["status"] == "failed"
    inspect.assert_not_called()
