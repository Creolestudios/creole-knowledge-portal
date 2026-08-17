"""Gemini embedding helper used during article extraction."""

from __future__ import annotations

import structlog

from src.core.config import get_llm_settings

log = structlog.get_logger(__name__)


def embed_text(text: str) -> list[float]:
    """Return a Gemini embedding, or an empty list when the key is missing."""
    trimmed = text.strip()[:15000]
    if not trimmed:
        return []

    settings = get_llm_settings()
    if not settings.GEMINI_API_KEY:
        return []

    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)
        response = genai.embed_content(
            model=settings.GEMINI_EMBED_MODEL,
            content=trimmed,
            task_type="retrieval_document",
        )
        embedding = response.get("embedding") if isinstance(response, dict) else None
        if isinstance(embedding, list):
            return [float(value) for value in embedding]
    except Exception as exc:
        log.warning("embedding: gemini failed", error=str(exc))
    return []
