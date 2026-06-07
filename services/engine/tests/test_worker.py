from pathlib import Path
from typing import Any

import pytest

from sandbox_engine import worker
from sandbox_engine.sandbox_runner import SandboxResult


def test_parse_stream_payload_accepts_string_fields() -> None:
    payload = worker.parse_stream_payload(
        {
            "payload": '{"runId":"run-1","agentId":"agent","command":"python task.py","workspaceRef":"demo","policyId":"policy"}'
        }
    )

    assert payload == {
        "runId": "run-1",
        "agentId": "agent",
        "command": "python task.py",
        "workspaceRef": "demo",
        "policyId": "policy",
    }


def test_parse_stream_payload_accepts_bytes_fields() -> None:
    payload = worker.parse_stream_payload(
        {
            b"payload": b'{"runId":"run-1","agentId":"agent","command":"python task.py","workspaceRef":"demo","policyId":"policy"}'
        }
    )

    assert payload is not None
    assert payload["runId"] == "run-1"


def test_parse_stream_payload_rejects_malformed_json() -> None:
    assert worker.parse_stream_payload({"payload": "not-json"}) is None


def test_parse_stream_payload_rejects_non_object_json() -> None:
    assert worker.parse_stream_payload({"payload": '["not", "an", "object"]'}) is None


def test_parse_stream_payload_rejects_incomplete_contracts() -> None:
    assert worker.parse_stream_payload({"payload": '{"runId":"run-1"}'}) is None


class FakeDatabase:
    def __init__(self) -> None:
        self.statuses: list[tuple[str, str, dict[str, Any] | None]] = []
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    async def set_run_status(self, run_id: str, status: str, delta: dict[str, Any] | None = None) -> None:
        self.statuses.append((run_id, status, delta))

    async def add_event(self, run_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.events.append((run_id, event_type, payload))


@pytest.mark.asyncio
async def test_process_job_hydrates_workspace_and_writes_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    object_store = tmp_path / "object-store" / "demo"
    object_store.mkdir(parents=True)
    (object_store / "task.py").write_text("print(42)", encoding="utf-8")

    fake_database = FakeDatabase()
    monkeypatch.setattr(worker, "database", fake_database)
    monkeypatch.setattr(worker.settings, "storage_root", str(tmp_path))

    async def fake_runner(command: str, workspace: Path) -> SandboxResult:
        assert command == "python task.py"
        assert (workspace / "task.py").exists()
        return SandboxResult(exit_code=0, stdout="42", stderr="", duration_ms=12, timed_out=False)

    monkeypatch.setattr(worker, "run_sandboxed", fake_runner)

    await worker.process_job(
        {
            "runId": "run-1",
            "agentId": "agent",
            "command": "python task.py",
            "workspaceRef": "demo",
            "policyId": "policy",
        }
    )

    assert fake_database.statuses[0] == ("run-1", "running", None)
    assert fake_database.statuses[-1][1] == "completed"
    assert ("run-1", "workspace.delta_applied", {"added": ["task.py"], "changed": [], "deleted": [], "unchanged": []}) in fake_database.events


@pytest.mark.asyncio
async def test_process_job_marks_run_failed_when_workspace_ref_is_invalid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_database = FakeDatabase()
    monkeypatch.setattr(worker, "database", fake_database)
    monkeypatch.setattr(worker.settings, "storage_root", str(tmp_path))

    await worker.process_job(
        {
            "runId": "run-1",
            "agentId": "agent",
            "command": "python task.py",
            "workspaceRef": "../bad",
            "policyId": "policy",
        }
    )

    assert fake_database.statuses[-1] == ("run-1", "failed", None)
    assert any(event_type == "engine.failed" for _, event_type, _ in fake_database.events)
