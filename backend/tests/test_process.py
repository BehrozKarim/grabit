import asyncio
import sys

import pytest

from app.errors import MediaError
from app.process import ProcessRunner


async def test_process_timeout_terminates_child():
    with pytest.raises(MediaError, match="too long"):
        await ProcessRunner().run([sys.executable, "-c", "import time; time.sleep(10)"], timeout=1)


async def test_process_cancellation_terminates_child():
    task = asyncio.create_task(
        ProcessRunner().run(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            timeout=20,
        )
    )
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_platform_error_is_sanitized(caplog):
    with pytest.raises(MediaError, match="blocked") as captured:
        await ProcessRunner().run(
            [
                sys.executable,
                "-c",
                "import sys; sys.stderr.write('403 secret-url'); sys.exit(1)",
            ],
            timeout=5,
        )
    assert "secret-url" not in str(captured.value)
    assert "secret-url" not in caplog.text
    assert "Media process exited with code 1" in caplog.text
