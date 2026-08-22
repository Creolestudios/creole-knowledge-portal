"""Ensure writable cache paths before third-party imports (newspaper3k uses TMPDIR)."""

from __future__ import annotations

import os
from pathlib import Path

_CACHE_ROOT = Path(os.environ.get("APP_CACHE_DIR", "/app/.cache"))
_TMP_DIR = _CACHE_ROOT / "tmp"

os.environ.setdefault("TMPDIR", str(_TMP_DIR))
_TMP_DIR.mkdir(parents=True, exist_ok=True)
