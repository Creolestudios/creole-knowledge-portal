"""
Shared pytest fixtures for fetch-blogs tests.

Unit tests use mongomock-motor for in-memory MongoDB.
Integration tests may use a real Docker MongoDB via testcontainers.
"""
from __future__ import annotations

import pytest
from mongomock_motor import AsyncMongoMockClient  # type: ignore[import-untyped]


@pytest.fixture
async def mock_db() -> AsyncMongoMockClient:
    """Returns an in-memory AsyncMongoMockClient for unit tests."""
    return AsyncMongoMockClient()
