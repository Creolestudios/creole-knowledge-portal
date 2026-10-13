#!/usr/bin/env bash
# CKP droplet deploy — pull images from GHCR and (re)start the stack.
#
# Usage, from /opt/ckp on the droplet:
#   ./deploy.sh web          # Stage 1: Next.js portal only
#   ./deploy.sh blog         # Stage 2: portal + api + unified worker + redis
#   ./deploy.sh scheduler    # Stage 2 + celery beat (automatic daily digests)
#   ./deploy.sh status       # what is running, memory, swap, disk
#   IMAGE_TAG=<sha> ./deploy.sh web    # pin a specific build
#
# Requires /opt/ckp/.ghcr-env (chmod 600):
#   GHCR_USER=your-github-username
#   GHCR_TOKEN=ghp_xxx          # classic PAT, read:packages scope only
set -euo pipefail

STACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$STACK_DIR"

MODE="${1:-status}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

show_state() {
  log "Containers"
  docker compose --profile blog --profile scheduler ps || true
  log "Resources"
  free -h
  echo
  swapon --show || echo "(no swap in use)"
  echo
  df -h / | tail -1
  log "Per-container memory"
  docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}' || true
}

ghcr_login() {
  [[ -f .ghcr-env ]] || fail "missing $STACK_DIR/.ghcr-env (see header of this script)"
  # shellcheck disable=SC1091
  source ./.ghcr-env
  [[ -n "${GHCR_USER:-}" && -n "${GHCR_TOKEN:-}" ]] || fail "GHCR_USER / GHCR_TOKEN not set in .ghcr-env"
  log "Logging in to ghcr.io as $GHCR_USER"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
}

require_env_file() {
  local f="$1"
  [[ -f "$f" ]] || fail "missing $STACK_DIR/$f — copy the matching .example and fill it in"
  local perms
  perms="$(stat -c '%a' "$f")"
  [[ "$perms" == "600" ]] || fail "$f has mode $perms; run: chmod 600 $f"
}

health_gate() {
  log "Waiting for health (up to 90s)"
  for _ in $(seq 1 18); do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
      echo "web responding on 127.0.0.1:3000"
      return 0
    fi
    sleep 5
  done
  echo "web did not respond in 90s — recent logs:" >&2
  docker compose logs --tail=50 web >&2
  return 1
}

case "$MODE" in
  web)
    require_env_file .env.production
    ghcr_login
    log "Pulling web image"
    docker compose pull web
    log "Starting web"
    docker compose up -d web
    health_gate
    show_state
    ;;

  blog)
    require_env_file .env.production
    require_env_file .env.api
    ghcr_login
    log "Pulling web + api images"
    docker compose --profile blog pull
    log "Starting web + redis + api + worker"
    docker compose --profile blog up -d
    health_gate
    log "Blog API health"
    curl -fsS http://127.0.0.1:8000/api/v1/health || echo "api health check failed — see: docker compose logs api"
    show_state
    ;;

  scheduler)
    require_env_file .env.production
    require_env_file .env.api
    ghcr_login
    docker compose --profile blog --profile scheduler pull
    docker compose --profile blog --profile scheduler up -d
    health_gate
    show_state
    ;;

  status)
    show_state
    ;;

  *)
    fail "unknown mode '$MODE' (expected: web | blog | scheduler | status)"
    ;;
esac

log "Done"
