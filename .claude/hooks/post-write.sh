#!/usr/bin/env bash
# .claude/hooks/post-write.sh
# PostToolUse hook for file Write/Edit/MultiEdit
# Runs AFTER Claude writes or edits a file.
# Automatically runs lint on TypeScript/TSX files.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('path', d.get('file_path', '')))" 2>/dev/null || echo "")

PROJECT_ROOT="/var/www/html/creole-knowledge-portal"

# ── Auto-lint TypeScript / TSX files ─────────────────────────────────────────
if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  echo "🔍 Running ESLint on $FILE_PATH..."
  cd "$PROJECT_ROOT"
  
  # Run lint on only the changed file for speed
  RELATIVE_PATH="${FILE_PATH#$PROJECT_ROOT/}"
  npx eslint "$RELATIVE_PATH" --max-warnings 0 2>&1 || {
    echo "⚠️  ESLint found issues in $RELATIVE_PATH. Review before committing." >&2
    # Don't exit 2 — just warn. Claude will see the output.
  }
fi

# ── Auto-format check Python files ───────────────────────────────────────────
if [[ "$FILE_PATH" == *.py ]]; then
  echo "🐍 Checking Python formatting on $FILE_PATH..."
  if command -v ruff &> /dev/null; then
    ruff check "$FILE_PATH" 2>&1 || echo "⚠️  Ruff found issues. Run: ruff check --fix $FILE_PATH" >&2
  fi
fi

# ── Log: Track post-write actions ────────────────────────────────────────────
LOG_DIR="$PROJECT_ROOT/.claude/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] POST-WRITE-CHECK: $FILE_PATH" >> "$LOG_DIR/session.log"

exit 0
