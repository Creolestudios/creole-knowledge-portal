#!/usr/bin/env bash
# .claude/hooks/on-stop.sh
# Stop hook — runs when Claude finishes a task / session ends.
# Prints a session summary and reminder checklist.

set -euo pipefail

PROJECT_ROOT="/var/www/html/creole-knowledge-portal"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
SESSION_LOG="$LOG_DIR/session.log"

echo ""
echo "════════════════════════════════════════════════"
echo "  🏁 Claude Code Session Summary"
echo "════════════════════════════════════════════════"

# ── Show what was touched this session ───────────────────────────────────────
if [[ -f "$SESSION_LOG" ]]; then
  WRITTEN=$(grep "WRITE:" "$SESSION_LOG" | awk '{print $NF}' | sort -u)
  if [[ -n "$WRITTEN" ]]; then
    echo ""
    echo "📝 Files modified this session:"
    echo "$WRITTEN" | while read -r f; do echo "   • $f"; done
  fi
  
  CMDS=$(grep "CMD:" "$SESSION_LOG" | wc -l)
  echo ""
  echo "🔧 Commands run: $CMDS"
fi

# ── Reminder checklist ───────────────────────────────────────────────────────
echo ""
echo "✅ Before committing, verify:"
echo "   □ npm run lint        — no ESLint errors"
echo "   □ npm run test        — all tests pass"
echo "   □ npm run build       — production build succeeds"
echo "   □ .env.local NOT committed (check .gitignore)"
echo "   □ No hardcoded secrets in source files"
echo "   □ New routes tested manually in browser"

# ── Quick status ─────────────────────────────────────────────────────────────
echo ""
cd "$PROJECT_ROOT"
UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null | wc -l || echo "?")
echo "📊 Git: $UNCOMMITTED file(s) with uncommitted changes"

echo ""
echo "════════════════════════════════════════════════"
echo ""

# Rotate session log (keep last 500 lines)
if [[ -f "$SESSION_LOG" ]]; then
  tail -500 "$SESSION_LOG" > "$SESSION_LOG.tmp" && mv "$SESSION_LOG.tmp" "$SESSION_LOG"
fi

exit 0
