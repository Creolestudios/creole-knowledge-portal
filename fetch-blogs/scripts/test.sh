#!/usr/bin/env bash
# Run the full Python quality gate — same order as CI.
set -euo pipefail

echo "🔍 mypy --strict..."
uv run mypy src --strict

echo "🔍 ruff check..."
uv run ruff check src

echo "🔍 ruff format --check..."
uv run ruff format --check src

echo "🧪 pytest + coverage..."
uv run pytest --cov=src --cov-report=term-missing --cov-fail-under=80

echo "✅ All checks passed."
