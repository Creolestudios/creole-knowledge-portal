"""
Shared pytest fixtures for fetch-blogs tests.

Unit tests use mongomock-motor for in-memory MongoDB.
Integration tests may use a real Docker MongoDB via testcontainers.
"""
from __future__ import annotations

import mongomock
import pytest
from beanie import init_beanie
from mongomock_motor import AsyncMongoMockClient  # type: ignore[import-untyped]

from src.models.article import Article
from src.models.digest import DailyDigest
from src.models.job import PipelineJob
from src.models.profile import UserProfile

# ── mongomock / beanie compatibility shim ─────────────────────────────────────
# Beanie's initializer calls `list_collection_names(authorizedCollections=...)`,
# a PyMongo kwarg that mongomock does not implement. Without this shim every
# test in the suite errors out during the autouse init_beanie fixture with
# "TypeError: Database.list_collection_names() got an unexpected keyword
# argument 'authorizedCollections'". Swallow the unsupported kwargs rather than
# pinning a downgraded beanie in production dependencies.
_original_list_collection_names = mongomock.database.Database.list_collection_names


from typing import Any


def _list_collection_names_compat(self: mongomock.database.Database, *args: Any, **kwargs: Any) -> list[str]:
    kwargs.pop("authorizedCollections", None)
    kwargs.pop("nameOnly", None)
    return _original_list_collection_names(self, *args, **kwargs)  # type: ignore[no-any-return]



mongomock.database.Database.list_collection_names = _list_collection_names_compat  # type: ignore[assignment]


@pytest.fixture
async def mock_db() -> AsyncMongoMockClient:
    """Returns an in-memory AsyncMongoMockClient for unit tests."""
    return AsyncMongoMockClient()


@pytest.fixture(autouse=True)
async def init_beanie_models(mock_db: AsyncMongoMockClient) -> None:
    """Initialize Beanie against mongomock so Document constructors work in unit tests."""
    await init_beanie(
        database=mock_db.knowledge_portal,
        document_models=[Article, UserProfile, DailyDigest, PipelineJob],
    )
