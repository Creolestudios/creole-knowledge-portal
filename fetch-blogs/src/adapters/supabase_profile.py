"""Map a cloud Supabase user_profiles row into UserProfile field data."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from src.models.profile import ContentDepth


def _as_str_list(value: object) -> list[str]:
    """Normalize list, comma-separated string, or missing values into strings."""
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _as_int(value: object, default: int = 0) -> int:
    try:
        return max(0, int(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _as_depth(value: object) -> ContentDepth | None:
    if value is None:
        return None
    raw = str(value).strip().lower()
    try:
        return ContentDepth(raw)
    except ValueError:
        return None


def to_user_profile_fields(row: Mapping[str, Any]) -> dict[str, Any]:
    """Convert a Supabase profile dict into UserProfile constructor kwargs.

    Does not emit learning_path or profile_embedding so a re-sync cannot wipe
    adaptive ranking state.
    """
    user_id = str(row.get("user_id") or "").strip()
    if not user_id:
        raise ValueError("user_id is required")

    interests = _as_str_list(row.get("interests"))
    if not interests:
        interests = _as_str_list(row.get("future_learning_goals"))

    freshness = _as_int(row.get("content_freshness_days"), default=30)
    if freshness < 1:
        freshness = 30

    return {
        "user_id": user_id,
        "name": str(row.get("name") or "").strip(),
        "years_of_experience": _as_int(row.get("years_of_experience")),
        "primary_tech_stack": _as_str_list(row.get("primary_tech_stack")),
        "secondary_tech_stack": _as_str_list(row.get("secondary_tech_stack")),
        "interests": interests,
        "current_role": str(row.get("current_role") or "").strip(),
        "preferred_content_depth": _as_depth(row.get("preferred_content_depth")),
        "excluded_topics": _as_str_list(row.get("excluded_topics")),
        "preferred_sources": _as_str_list(row.get("preferred_sources")),
        "content_freshness_days": freshness,
    }
