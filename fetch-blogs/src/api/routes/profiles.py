"""Sync Supabase preferences into the Mongo profile mirror."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from src.core.config import get_auth_settings
from src.models.profile import UserProfile
from src.schemas.profile import ProfileOut, ProfileSyncOut
from src.services.supabase_profiles import upsert_mongo_profile

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _verify_internal_token(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    cfg = get_auth_settings()
    if not x_internal_token or x_internal_token != cfg.SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-Internal-Token header.",
        )


def _profile_out(profile: UserProfile) -> ProfileOut:
    return ProfileOut(
        user_id=profile.user_id,
        name=profile.name,
        years_of_experience=profile.years_of_experience,
        primary_tech_stack=profile.primary_tech_stack,
        secondary_tech_stack=profile.secondary_tech_stack,
        interests=profile.interests,
        current_role=profile.current_role,
        content_depth=profile.content_depth,
        excluded_topics=profile.excluded_topics,
        ranking_terms=profile.ranking_terms,
        learning_path=profile.learning_path,
        updated_at=profile.updated_at,
    )


@router.post("/{user_id}/sync", response_model=ProfileSyncOut)
async def sync_profile(
    user_id: str,
    _: Annotated[None, Depends(_verify_internal_token)],
) -> ProfileSyncOut:
    """Copy Supabase preferences into Mongo without wiping learning_path."""
    existing = await UserProfile.find_one(UserProfile.user_id == user_id)
    try:
        profile = await upsert_mongo_profile(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    out = _profile_out(profile)
    return ProfileSyncOut(**out.model_dump(), created=existing is None)


@router.get("/{user_id}", response_model=ProfileOut)
async def get_profile(user_id: str) -> ProfileOut:
    """Read the Mongo mirror only."""
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not mirrored.")
    return _profile_out(profile)
