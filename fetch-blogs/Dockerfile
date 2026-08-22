# Production image only — local dev runs FastAPI on the host via uv.
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

# Stage 2: Chromium for Crawl4AI scraping
FROM builder AS playwright-stage

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 curl && \
    rm -rf /var/lib/apt/lists/*

# Installed outside $HOME so it stays readable by the non-root runtime user below.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN uv run playwright install chromium

# Stage 3: slim runtime image
FROM python:3.11-slim AS runtime

# curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=playwright-stage /app/.venv /app/.venv
COPY --from=playwright-stage /ms-playwright /ms-playwright

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV APP_CACHE_DIR=/app/.cache
ENV TMPDIR=/app/.cache/tmp

WORKDIR /app

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/.cache/tmp && \
    chmod +x scripts/prestart.sh scripts/test.sh && \
    groupadd --system appuser && useradd --system --gid appuser --home-dir /app appuser && \
    chown -R appuser:appuser /app /ms-playwright
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["fastapi", "run", "--workers", "4", "src/main.py"]
