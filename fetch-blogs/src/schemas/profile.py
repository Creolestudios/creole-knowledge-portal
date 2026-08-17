"""Profile API response schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from src.models.profile import ContentDepth, LearningPath


class ProfileOut(BaseModel):
    """Mirrored Mongo profile as returned by the API."""

    user_id: str
    name: str = ""
    years_of_experience: int = 0
    primary_tech_stack: list[str] = Field(default_factory=list)
    secondary_tech_stack: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    current_role: str = ""
    content_depth: ContentDepth
    excluded_topics: list[str] = Field(default_factory=list)
    ranking_terms: list[str] = Field(default_factory=list)
    learning_path: LearningPath = Field(default_factory=LearningPath)
    updated_at: datetime


class ProfileSyncOut(ProfileOut):
    """Profile response plus whether Mongo inserted a new document."""

    created: bool
