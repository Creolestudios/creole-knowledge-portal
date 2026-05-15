#!/usr/bin/env bash
# .claude/hooks/pre-write.sh
# PreToolUse hook for file Write/Edit/MultiEdit
# Runs BEFORE Claude writes or edits any file.
# Receives file path + content via stdin as JSON.
# Exit code 2 = block the write.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('path', d.get('file_path', '')))" 2>/dev/null || echo "")
CONTENT=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('content', d.get('new_content', '')))" 2>/dev/null || echo "")

# ── Guard: Never overwrite .env.local ────────────────────────────────────────
if [[ "$FILE_PATH" == *".env.local"* ]]; then
  echo "🚫 BLOCKED by pre-write hook: Writing to .env.local is not allowed via Claude." >&2
  echo "   Edit .env.local manually. This file contains real secrets." >&2
  exit 2
fi

# ── Guard: Never write to .next/ or node_modules/ ────────────────────────────
if [[ "$FILE_PATH" == *"/.next/"* ]] || [[ "$FILE_PATH" == *"/node_modules/"* ]]; then
  echo "🚫 BLOCKED by pre-write hook: Writing to .next/ or node_modules/ is not allowed." >&2
  exit 2
fi

# ── Guard: Detect hardcoded secrets in content ───────────────────────────────
SECRET_PATTERNS=(
  "SUPABASE_SERVICE_ROLE_KEY"
  "AIzaSy"                    # Gemini API key prefix
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"  # JWT prefix (Supabase keys)
)

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$CONTENT" | grep -q "$pattern"; then
    # Allow only in .env files and .env.example
    if [[ "$FILE_PATH" != *".env"* ]]; then
      echo "⚠️  WARNING: Possible secret detected in $FILE_PATH — pattern: $pattern" >&2
      echo "   If this is intentional (e.g., .env.example), you can proceed." >&2
      # Warn only, don't block — Claude should decide
    fi
  fi
done

# ── Guard: Server-side secrets in client files ────────────────────────────────
if echo "$CONTENT" | grep -q "SUPABASE_SERVICE_ROLE_KEY"; then
  if [[ "$FILE_PATH" == *"app/"* ]] && [[ "$FILE_PATH" == *"page.tsx"* || "$FILE_PATH" == *"layout.tsx"* ]]; then
    echo "🚫 BLOCKED by pre-write hook: SUPABASE_SERVICE_ROLE_KEY in a client-rendered page." >&2
    exit 2
  fi
fi

# ── Guard: 'use client' in Server-only files ─────────────────────────────────
if echo "$CONTENT" | grep -q "'use client'" && [[ "$FILE_PATH" == *"/lib/supabase/server.ts"* || "$FILE_PATH" == *"/lib/supabase/admin.ts"* ]]; then
  echo "🚫 BLOCKED by pre-write hook: 'use client' directive in a server-only Supabase file." >&2
  exit 2
fi

# ── Log: Track file writes ────────────────────────────────────────────────────
LOG_DIR="/var/www/html/creole-knowledge-portal/.claude/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WRITE: $FILE_PATH" >> "$LOG_DIR/session.log"

exit 0
