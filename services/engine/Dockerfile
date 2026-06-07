FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

FROM base AS deps
COPY services/engine/pyproject.toml ./
RUN pip install --no-cache-dir ".[dev]"

FROM deps AS runner
COPY services/engine ./services/engine
WORKDIR /app/services/engine
EXPOSE 8000
CMD ["python", "-m", "sandbox_engine.main"]

