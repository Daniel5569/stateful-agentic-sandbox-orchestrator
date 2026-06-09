import json
from typing import Any

import asyncpg

from .config import settings


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(
            settings.database_url, min_size=1, max_size=5
        )

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    async def set_run_status(
        self, run_id: str, status: str, delta: dict[str, Any] | None = None
    ) -> None:
        assert self.pool is not None
        await self.pool.execute(
            """
            UPDATE runs
            SET status = $2,
                delta_json = COALESCE($3::jsonb, delta_json),
                updated_at = now()
            WHERE id = $1
            """,
            run_id,
            status,
            json.dumps(delta) if delta is not None else None,
        )

    async def add_event(
        self, run_id: str, event_type: str, payload: dict[str, Any]
    ) -> None:
        assert self.pool is not None
        await self.pool.execute(
            "INSERT INTO run_events (run_id, event_type, payload) VALUES ($1, $2, $3)",
            run_id,
            event_type,
            json.dumps(payload),
        )


database = Database()
