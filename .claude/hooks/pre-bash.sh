#!/usr/bin/env bash
# .claude/hooks/pre-bash.sh
# PreToolUse hook for Bash commands
# Runs BEFORE Claude executes any shell command.
# Receives the proposed command via stdin as JSON.
# Exit code 2 = block the command (output goes to Claude as error message).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('command', ''))" 2>/dev/null || echo "")

# ── Blocklist: Destructive commands ──────────────────────────────────────────
BLOCKED_PATTERNS=(
  "rm -rf /"
  "DROP TABLE"
  "DROP DATABASE"
  "truncate.*daily_digests"
  "git push.*--force"
  "npm publish"
  "curl.*SUPABASE_SERVICE_ROLE_KEY"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "🚫 BLOCKED by pre-bash hook: Potentially destructive pattern detected: '$pattern'" >&2
    exit 2
  fi
done

# ── Warn: Production database mutations ──────────────────────────────────────
if echo "$COMMAND" | grep -qiE "(DELETE FROM|UPDATE .* SET|INSERT INTO).*articles|user_profiles|daily_digests"; then
  echo "⚠️  WARNING: Direct DB mutation detected. Ensure this is intentional and tested." >&2
  # Don't block — just warn. Claude will see this in output.
fi

# ── Log: Track commands for session audit ────────────────────────────────────
LOG_DIR="/var/www/html/creole-knowledge-portal/.claude/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] CMD: $COMMAND" >> "$LOG_DIR/session.log"

exit 0
