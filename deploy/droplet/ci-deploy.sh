#!/usr/bin/env bash
# Forced command for the CI deploy key. Installed at /opt/ckp/ci-deploy.sh.
#
# The droplet's authorized_keys entry pins this script, so a holder of
# DROPLET_SSH_KEY cannot run arbitrary commands — only this one, with a single
# argument validated below:
#
#   command="/opt/ckp/ci-deploy.sh",restrict ssh-ed25519 AAAA... ckp-ci-deploy
#
# SSH_ORIGINAL_COMMAND carries whatever the client asked for. We accept exactly
# three words and reject everything else.
set -euo pipefail

STACK_DIR=/opt/ckp
LOG=/var/log/ckp-ci-deploy.log

log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

MODE="${SSH_ORIGINAL_COMMAND:-${1:-}}"
MODE="${MODE%% *}"   # first word only; ignore anything appended

case "$MODE" in
  web|blog|status) ;;
  *)
    log "REJECTED mode='${MODE}' from ${SSH_CONNECTION%% *}"
    echo "refused: expected one of web|blog|status" >&2
    exit 2
    ;;
esac

log "deploy start mode=$MODE from ${SSH_CONNECTION%% *}"
cd "$STACK_DIR"

# deploy.sh handles the GHCR login, image pull, restart and health gate.
if ./deploy.sh "$MODE" 2>&1 | tee -a "$LOG"; then
  log "deploy ok mode=$MODE"
else
  rc=$?
  log "deploy FAILED mode=$MODE rc=$rc"
  exit "$rc"
fi
