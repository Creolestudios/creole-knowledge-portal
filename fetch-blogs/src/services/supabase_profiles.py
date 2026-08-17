"""Fetch user profile rows from cloud Supabase PostgREST."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from src.adapters.supabase_profile import to_user_profile_fields
from src.core.config import get_supabase_settings
from src.models.profile import UserProfile

log = structlog.get_logger(__name__)


async def fetch_profile_row(user_id: str) -> dict[str, Any] | None:
    """Return the Supabase user_profiles row or None when missing."""
    cfg = get_supabase_settings()
    url = f"{cfg.URL}/rest/v1/user_profiles"
    headers = {
        "apikey": cfg.ANON_KEY.get_secret_value() if cfg.ANON_KEY else cfg.SERVICE_ROLE_KEY.get_secret_value(),
        "Authorization": f"Bearer {cfg.SERVICE_ROLE_KEY.get_secret_value()}",
    }
    params = {"user_id": f"eq.{user_id}", "select": "*"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, headers=headers, params=params)
    if response.status_code != 200:
        log.warning("supabase: profile fetch failed", status=response.status_code, user_id=user_id)
        return None
    rows = response.json()
    if not rows:
        return None
    return rows[0]


async def upsert_mongo_profile(user_id: str) -> UserProfile:
    """Copy Supabase preferences into Mongo without wiping learning_path."""
    row = await fetch_profile_row(user_id)
    if row is None:
        raise ValueError(f"Supabase profile not found for {user_id}")

    fields = to_user_profile_fields(row)
    existing = await UserProfile.find_one(UserProfile.user_id == user_id)
    now = datetime.now(UTC)
    if existing is None:
        profile = UserProfile(**fields)
        await profile.insert()
        return profile

    for key, value in fields.items():
        setattr(existing, key, value)
    existing.updated_at = now
    await existing.save()
    return existing
