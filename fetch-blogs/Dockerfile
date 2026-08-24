# Production image — local dev runs FastAPI on the host via uv.
#
# Scraping uses httpx + feedparser + newspaper3k + BeautifulSoup + Jina (no browser).
#
# Stage 1: install Python deps (cached between builds)
FROM python:3.11-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace --no-dev

# Stage 2: slim runtime
FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY src ./src
COPY scripts ./scripts

RUN chmod +x scripts/prestart.sh scripts/test.sh && \
    groupadd --system appuser && useradd --system --gid appuser --home-dir /app appuser && \
    chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["fastapi", "run", "--workers", "4", "src/main.py"]
