import asyncio
import shlex
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SandboxResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool


async def run_sandboxed(
    command: str, workspace: Path, timeout_seconds: int = 45
) -> SandboxResult:
    started = time.perf_counter()
    process = await asyncio.create_subprocess_exec(
        *shlex.split(command),
        cwd=workspace,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=timeout_seconds
        )
        timed_out = False
    except asyncio.TimeoutError:
        process.kill()
        stdout_bytes, stderr_bytes = await process.communicate()
        timed_out = True

    duration_ms = int((time.perf_counter() - started) * 1000)
    return SandboxResult(
        exit_code=process.returncode if process.returncode is not None else 124,
        stdout=stdout_bytes.decode(errors="replace")[-4000:],
        stderr=stderr_bytes.decode(errors="replace")[-4000:],
        duration_ms=duration_ms,
        timed_out=timed_out,
    )
