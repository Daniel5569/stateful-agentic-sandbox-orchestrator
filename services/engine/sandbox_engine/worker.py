import json
from pathlib import Path
from typing import Any

from redis.exceptions import ResponseError
from redis.asyncio import Redis

from .config import settings
from .db import database
from .delta_sync import hydrate_delta
from .sandbox_runner import run_sandboxed

STREAM_KEY = "sandbox-runs"
DEAD_LETTER_STREAM = "sandbox-runs-dead-letter"
CONSUMER_GROUP = "sandbox-engine"
CONSUMER_NAME = "engine-1"


async def process_job(payload: dict[str, Any]) -> None:
    run_id = payload["runId"]
    workspace_ref = payload["workspaceRef"]
    command = payload["command"]

    storage_root = Path(settings.storage_root)
    object_store_root = storage_root / "object-store"
    workspace_root = storage_root / "workspaces"

    await database.set_run_status(run_id, "running")
    try:
        await database.add_event(
            run_id, "engine.started", {"workspaceRef": workspace_ref}
        )

        delta = hydrate_delta(object_store_root, workspace_root, workspace_ref)
        await database.add_event(run_id, "workspace.delta_applied", delta.as_dict())

        result = await run_sandboxed(command, workspace_root / workspace_ref)
        final_status = (
            "completed" if result.exit_code == 0 and not result.timed_out else "failed"
        )

        await database.add_event(
            run_id,
            "sandbox.finished",
            {
                "exitCode": result.exit_code,
                "durationMs": result.duration_ms,
                "timedOut": result.timed_out,
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
        )
        await database.set_run_status(run_id, final_status, delta.as_dict())
    except Exception as error:
        await database.add_event(
            run_id,
            "engine.failed",
            {"errorType": type(error).__name__, "message": str(error)[:500]},
        )
        await database.set_run_status(run_id, "failed")


def _decode(value: Any) -> Any:
    return value.decode("utf-8") if isinstance(value, bytes) else value


def parse_stream_payload(fields: dict[Any, Any]) -> dict[str, Any] | None:
    normalized = {_decode(key): _decode(value) for key, value in fields.items()}
    payload = normalized.get("payload")
    if not isinstance(payload, str):
        return None

    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(decoded, dict):
        return None

    required = {"runId", "agentId", "command", "workspaceRef", "policyId"}
    if not required.issubset(decoded):
        return None
    if not all(isinstance(decoded[key], str) and decoded[key] for key in required):
        return None
    return decoded


async def ensure_consumer_group(redis: Redis) -> None:
    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except ResponseError as error:
        if "BUSYGROUP" not in str(error):
            raise


async def consume_once(redis: Redis) -> bool:
    response = await redis.xreadgroup(
        CONSUMER_GROUP,
        CONSUMER_NAME,
        {STREAM_KEY: ">"},
        count=1,
        block=5000,
    )
    if not response:
        return False

    for _, messages in response:
        for message_id, fields in messages:
            await handle_message(redis, str(_decode(message_id)), fields)
    return True


async def dead_letter(
    redis: Redis, message_id: str, fields: dict[Any, Any], reason: str
) -> None:
    await redis.xadd(
        DEAD_LETTER_STREAM,
        {
            "sourceMessageId": message_id,
            "reason": reason,
            "payload": json.dumps(
                {_decode(key): _decode(value) for key, value in fields.items()}
            ),
        },
    )


async def handle_message(redis: Redis, message_id: str, fields: dict[Any, Any]) -> None:
    payload = parse_stream_payload(fields)
    if payload is None:
        await dead_letter(redis, message_id, fields, "invalid_payload")
        await redis.xack(STREAM_KEY, CONSUMER_GROUP, message_id)
        return

    await process_job(payload)
    await redis.xack(STREAM_KEY, CONSUMER_GROUP, message_id)


def _pending_message_id(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(_decode(entry["message_id"]))
    return str(_decode(entry[0]))


async def reclaim_stale_pending(
    redis: Redis,
    min_idle_ms: int = settings.pending_message_idle_ms,
    count: int = 10,
) -> int:
    pending = await redis.xpending_range(
        STREAM_KEY,
        CONSUMER_GROUP,
        min="-",
        max="+",
        count=count,
        idle=min_idle_ms,
    )
    message_ids = [_pending_message_id(entry) for entry in pending]
    if not message_ids:
        return 0

    claimed = await redis.xclaim(
        STREAM_KEY,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        min_idle_time=min_idle_ms,
        message_ids=message_ids,
    )
    for message_id, fields in claimed:
        await handle_message(redis, str(_decode(message_id)), fields)
    return len(claimed)


async def worker_loop() -> None:
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await ensure_consumer_group(redis)
        while True:
            consumed = await consume_once(redis)
            if not consumed:
                await reclaim_stale_pending(redis)
    finally:
        await redis.aclose()
