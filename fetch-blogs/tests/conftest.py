"""
Shared pytest fixtures for fetch-blogs tests.

Unit tests use mongomock-motor for in-memory MongoDB.
Integration tests may use a real Docker MongoDB via testcontainers.
"""
from __future__ import annotations

import pytest
from beanie import init_beanie
from mongomock_motor import AsyncMongoMockClient  # type: ignore[import-untyped]

from src.models.article import Article
from src.models.profile import UserProfile


@pytest.fixture
async def mock_db() -> AsyncMongoMockClient:
    """Returns an in-memory AsyncMongoMockClient for unit tests."""
    return AsyncMongoMockClient()


@pytest.fixture(autouse=True)
async def init_beanie_models(mock_db: AsyncMongoMockClient) -> None:
    """Initialize Beanie against mongomock so Document constructors work in unit tests."""
    await init_beanie(
        database=mock_db.knowledge_portal,
        document_models=[Article, UserProfile],
    )
