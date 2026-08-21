"""Import every source module so coverage.xml includes Python files for Sonar."""

from __future__ import annotations

from src.api.routes import admin as admin_routes
from src.generator import prompt_builder, quality_gate
from src.models import admin as admin_model
from src.schemas import common as common_schemas
from src.schemas import digest as digest_schemas
from src.scrapers import reddit


def test_stub_modules_are_importable() -> None:
    assert admin_routes.IMPLEMENTED is False
    assert admin_model.IMPLEMENTED is False
    assert prompt_builder.IMPLEMENTED is False
    assert quality_gate.IMPLEMENTED is False
    assert reddit.IMPLEMENTED is False
    assert common_schemas.IMPLEMENTED is False
    assert digest_schemas.IMPLEMENTED is False
