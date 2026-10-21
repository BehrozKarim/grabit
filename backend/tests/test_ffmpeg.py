import json
import shutil

import pytest

from app.process import ProcessRunner


@pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg not installed"
)
async def test_real_mp3_conversion(tmp_path):
    """Exercise native FFmpeg and validate its output independently with ffprobe."""
    result = tmp_path / "audio.mp3"
    runner = ProcessRunner()
    await runner.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.5",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(result),
        ],
        timeout=10,
    )
    raw = await runner.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            str(result),
        ],
        timeout=10,
    )
    stream = json.loads(raw)["streams"][0]
    assert stream["codec_name"] == "mp3"
    assert float(stream["duration"]) >= 0.5
    assert result.stat().st_size > 1000
