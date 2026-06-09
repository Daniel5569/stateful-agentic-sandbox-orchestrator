from pathlib import Path

import pytest

from sandbox_engine.sandbox_runner import run_sandboxed


@pytest.mark.asyncio
async def test_run_sandboxed_returns_stdout(tmp_path: Path) -> None:
    result = await run_sandboxed("python -c print(123)", tmp_path, timeout_seconds=5)

    assert result.exit_code == 0
    assert "123" in result.stdout
    assert result.timed_out is False


@pytest.mark.asyncio
async def test_run_sandboxed_reports_nonzero_exit_code(tmp_path: Path) -> None:
    result = await run_sandboxed(
        'python -c "raise SystemExit(7)"', tmp_path, timeout_seconds=5
    )

    assert result.exit_code == 7
    assert result.timed_out is False


@pytest.mark.asyncio
async def test_run_sandboxed_enforces_timeout(tmp_path: Path) -> None:
    result = await run_sandboxed(
        'python -c "import time;time.sleep(1)"', tmp_path, timeout_seconds=0
    )

    assert result.timed_out is True
