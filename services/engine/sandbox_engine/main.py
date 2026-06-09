import asyncio
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .config import settings
from .db import database
from .worker import worker_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    task = asyncio.create_task(worker_loop())
    yield
    task.cancel()
    await database.close()


app = FastAPI(title="Sandbox Engine", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "sandbox-engine"}


def main() -> None:
    uvicorn.run(
        "sandbox_engine.main:app",
        host="0.0.0.0",
        port=settings.engine_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
