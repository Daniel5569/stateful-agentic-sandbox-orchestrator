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

    async def set_run_status(
        self, run_id: str, status: str, delta: dict[str, Any] | None = None
    ) -> None:
        self.statuses.append((run_id, status, delta))

    async def add_event(
        self, run_id: str, event_type: str, payload: dict[str, Any]
    ) -> None:
        self.events.append((run_id, event_type, payload))


class FakeRedis:
    def __init__(self) -> None:
        self.acked: list[tuple[str, str, str]] = []
        self.dead_letters: list[tuple[str, dict[str, str]]] = []
        self.pending_entries: list[object] = []
        self.claimed_messages: list[tuple[str, dict[str, str]]] = []
        self.xclaim_calls: list[dict[str, object]] = []

    async def xack(self, stream: str, group: str, message_id: str) -> None:
        self.acked.append((stream, group, message_id))

    async def xadd(self, stream: str, fields: dict[str, str]) -> None:
        self.dead_letters.append((stream, fields))

    async def xpending_range(
        self,
        stream: str,
        group: str,
        min: str,
        max: str,
        count: int,
        idle: int,
    ) -> list[object]:
        return self.pending_entries

    async def xclaim(
        self,
        stream: str,
        group: str,
        consumer: str,
        min_idle_time: int,
        message_ids: list[str],
    ) -> list[tuple[str, dict[str, str]]]:
        self.xclaim_calls.append(
            {
                "stream": stream,
                "group": group,
                "consumer": consumer,
                "min_idle_time": min_idle_time,
                "message_ids": message_ids,
            }
        )
        return self.claimed_messages


@pytest.mark.asyncio
async def test_process_job_hydrates_workspace_and_writes_events(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    object_store = tmp_path / "object-store" / "demo"
    object_store.mkdir(parents=True)
    (object_store / "task.py").write_text("print(42)", encoding="utf-8")

    fake_database = FakeDatabase()
    monkeypatch.setattr(worker, "database", fake_database)
    monkeypatch.setattr(worker.settings, "storage_root", str(tmp_path))

    async def fake_runner(command: str, workspace: Path) -> SandboxResult:
        assert command == "python task.py"
        assert (workspace / "task.py").exists()
        return SandboxResult(
            exit_code=0, stdout="42", stderr="", duration_ms=12, timed_out=False
        )

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
    assert (
        "run-1",
        "workspace.delta_applied",
        {"added": ["task.py"], "changed": [], "deleted": [], "unchanged": []},
    ) in fake_database.events


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
    assert any(
        event_type == "engine.failed" for _, event_type, _ in fake_database.events
    )


@pytest.mark.asyncio
async def test_handle_message_dead_letters_invalid_payload() -> None:
    redis = FakeRedis()

    await worker.handle_message(redis, "1-0", {"payload": "not-json"})

    assert redis.acked == [(worker.STREAM_KEY, worker.CONSUMER_GROUP, "1-0")]
    assert redis.dead_letters[0][0] == worker.DEAD_LETTER_STREAM
    assert redis.dead_letters[0][1]["reason"] == "invalid_payload"


@pytest.mark.asyncio
async def test_reclaim_stale_pending_claims_and_processes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = FakeRedis()
    redis.pending_entries = [{"message_id": "2-0"}]
    redis.claimed_messages = [
        (
            "2-0",
            {
                "payload": '{"runId":"run-1","agentId":"agent","command":"python task.py","workspaceRef":"demo","policyId":"policy"}'
            },
        )
    ]
    processed: list[dict[str, str]] = []

    async def fake_process_job(payload: dict[str, str]) -> None:
        processed.append(payload)

    monkeypatch.setattr(worker, "process_job", fake_process_job)

    reclaimed = await worker.reclaim_stale_pending(redis, min_idle_ms=123, count=1)

    assert reclaimed == 1
    assert redis.xclaim_calls[0]["message_ids"] == ["2-0"]
    assert processed[0]["runId"] == "run-1"
    assert redis.acked == [(worker.STREAM_KEY, worker.CONSUMER_GROUP, "2-0")]
