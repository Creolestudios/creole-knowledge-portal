#!/usr/bin/env bash
# Waits for MongoDB and Redis to be healthy before starting FastAPI or Celery.
# Run this before any service start command in Docker Compose.
set -euo pipefail

echo "⏳ Waiting for MongoDB..."
until mongosh "${MONGO_URI:-mongodb://mongo:27017}" --eval "db.adminCommand('ping')" --quiet 2>/dev/null; do
  sleep 2
done
echo "✅ MongoDB is ready."

echo "⏳ Waiting for Redis..."
until redis-cli -u "${REDIS_URL:-redis://redis:6379/0}" ping 2>/dev/null | grep -q PONG; do
  sleep 2
done
echo "✅ Redis is ready."
