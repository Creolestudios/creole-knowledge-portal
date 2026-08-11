# Skill: Fetch-Blogs DevOps & Infrastructure

## When to Use
Use when working on Docker, CI/CD pipeline, pre-commit hooks, environment variables,
or the uv/pyproject.toml configuration for the `fetch-blogs/` Python microservice.

---

## Workflow 1: Add a New Environment Variable

### 1. Add to `.env.example` (documentation)
```bash
# ── <Domain> ──────────────────────────────────────────────────────────────
<DOMAIN>_<VAR_NAME>=<example_value>   # explain what it does
```

### 2. Add to the correct settings class in `src/core/config.py`
```python
class <Domain>Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="<DOMAIN>_", extra="ignore"
    )
    <VAR_NAME>: <type>               # add here
```

### 3. Expose via a getter if not already present
```python
@lru_cache
def get_<domain>_settings() -> <Domain>Settings:
    return <Domain>Settings()
```

### 4. Checklist
- [ ] Added to `.env.example` with a comment
- [ ] Added to the correct domain settings class (NOT the global catch-all)
- [ ] Getter exists in `src/core/config.py`
- [ ] Added to `fetch-blogs/.env` locally (gitignored)
- [ ] `uv run mypy src --strict` still passes

---

## Workflow 2: Update Python Dependencies

```bash
cd fetch-blogs/

# Add a new runtime dependency
uv add <package>>=<version>

# Add a dev-only dependency
uv add --dev <package>>=<version>

# After manual pyproject.toml edit — re-lock
uv lock

# Verify the lock file is consistent
uv sync

# Always commit both pyproject.toml and uv.lock
git add pyproject.toml uv.lock
```

**Rules:**
- Always pin with `>=<min>,<next_major>` (e.g. `>=5.4.0,<6.0.0`)
- Never install unverified packages outside pyproject.toml
- Add type stubs to `[dependency-groups.dev]` if the package lacks inline types

---

## Workflow 3: Add a New Docker Service

### `fetch-blogs/docker-compose.yml`
```yaml
  new-service:
    <<: *worker-common        # reuse the shared anchor
    command: <start command>
    healthcheck:
      test: ["CMD", "<health command>"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### `fetch-blogs/docker-compose.override.yml` (dev overrides)
```yaml
  new-service:
    volumes: [.:/app]          # hot reload
    environment:
      LOG_LEVEL: DEBUG
```

### Checklist
- [ ] Uses `<<: *worker-common` anchor for shared config
- [ ] Has `depends_on` with `condition: service_healthy` for Mongo/Redis
- [ ] Has `healthcheck` if it exposes a port
- [ ] Dev override adds source mount and debug log level
- [ ] Service documented in `.claude/docs/architecture.md` Docker services table

---

## Workflow 4: Update Pre-commit Hooks

```bash
cd fetch-blogs/

# Install hooks (first time or after .pre-commit-config.yaml changes)
uv run pre-commit install

# Run all hooks manually
uv run pre-commit run --all-files

# Update hook versions
uv run pre-commit autoupdate

# Bypass hooks for a one-off emergency commit (USE SPARINGLY)
git commit --no-verify -m "emergency: <reason>"
```

**Hooks enforced:**
| Hook | What it checks |
|---|---|
| `ruff` | Lint + import order (auto-fix) |
| `ruff-format` | Code formatting |
| `mypy` | `--strict` type checking |
| `detect-secrets` | No secrets in committed code |
| `check-toml` | Valid TOML syntax |
| `check-yaml` | Valid YAML syntax |
| `no-commit-to-branch` | Blocks direct commits to `main` |

---

## Workflow 5: Docker Build & Run Cycle

```bash
cd fetch-blogs/

# First-time setup
cp .env.example .env           # fill in GEMINI_API_KEY, AUTH_SECRET_KEY, etc.
uv run pre-commit install       # enable git hooks

# Build (includes Playwright Chromium install — slow first time)
docker compose build

# Start all services (local dev with hot reload via override.yml)
docker compose up

# Start only specific services
docker compose up fastapi-api mongo redis

# Scale a specific worker
docker compose up --scale celery-scrape=3

# Check logs
docker compose logs -f celery-generate

# Shell into a container
docker compose exec fastapi-api bash

# Full rebuild from scratch
docker compose down -v          # removes volumes!
docker compose build --no-cache
docker compose up
```

---

## Workflow 6: GitHub Actions CI — Python Job

Template for the Python quality gate job to add to `.github/workflows/quality-gate.yml`:

```yaml
python-quality:
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: fetch-blogs
  steps:
    - uses: actions/checkout@v4
    - uses: astral-sh/setup-uv@v3
      with:
        version: "0.9.x"
    - name: Install deps
      run: uv sync --frozen
    - name: Type check
      run: uv run mypy src --strict
    - name: Lint
      run: uv run ruff check src
    - name: Format check
      run: uv run ruff format --check src
    - name: Tests + coverage
      run: uv run pytest --cov=src --cov-fail-under=80 --cov-report=xml
    - name: Upload coverage
      uses: actions/upload-artifact@v4
      with:
        name: python-coverage
        path: fetch-blogs/coverage.xml
        retention-days: 7
```
