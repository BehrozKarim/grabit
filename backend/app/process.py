import asyncio
import contextlib
import os
import signal
from collections.abc import Callable

from app.errors import MediaError, friendly_error


class ProcessRunner:
    """Run bounded subprocesses without a shell, and terminate children on cancellation."""

    async def run(
        self,
        args: list[str],
        *,
        timeout: int,
        on_line: Callable[[str], None] | None = None,
    ) -> str:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=os.name != "nt",
            limit=8 * 1024 * 1024,
        )
        output: list[str] = []
        errors = bytearray()
        output_size = 0

        async def read_output() -> None:
            nonlocal output_size
            assert process.stdout
            async for raw in process.stdout:
                output_size += len(raw)
                if output_size > 8 * 1024 * 1024:
                    raise MediaError(
                        "The platform returned too much data. Try a single video link."
                    )
                line = raw.decode("utf-8", errors="replace").strip()
                if on_line:
                    on_line(line)
                else:
                    output.append(line)

        async def read_errors() -> None:
            assert process.stderr
            while chunk := await process.stderr.read(4096):
                errors.extend(chunk)
                del errors[:-65536]

        try:
            await asyncio.wait_for(
                asyncio.gather(read_output(), read_errors(), process.wait()), timeout=timeout
            )
        except BaseException as error:
            if process.returncode is None:
                if os.name == "nt":
                    killer = await asyncio.create_subprocess_exec(
                        "taskkill",
                        "/PID",
                        str(process.pid),
                        "/T",
                        "/F",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await killer.wait()
                else:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
            if isinstance(error, asyncio.TimeoutError):
                raise MediaError("This request took too long. Try a shorter video.", 504) from error
            raise
        if process.returncode:
            raise MediaError(friendly_error(errors.decode("utf-8", errors="replace")))
        return "\n".join(output)
