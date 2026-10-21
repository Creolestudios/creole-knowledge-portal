"""Gemini embedding helper used during article extraction and next-day query."""

from __future__ import annotations

import structlog

from src.core.config import get_llm_settings

log = structlog.get_logger(__name__)


def embed_text(text: str, *, task_type: str = "retrieval_document") -> list[float]:
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
        embed_kwargs = {
            "model": getattr(settings, "GEMINI_EMBED_MODEL", "models/gemini-embedding-2"),
            "content": trimmed,
            "task_type": task_type,
        }
        dim = getattr(settings, "GEMINI_EMBED_DIMENSION", 768)
        if dim:
            embed_kwargs["output_dimensionality"] = dim

        response = genai.embed_content(**embed_kwargs)
        embedding = response.get("embedding") if isinstance(response, dict) else None
        if isinstance(embedding, list):
            return [float(value) for value in embedding]
    except Exception as exc:
        log.warning("embedding: gemini failed", error=str(exc), task_type=task_type)
    return []


def embed_query(text: str) -> list[float]:
    """Embed a retrieval query (next-day selection)."""
    return embed_text(text, task_type="retrieval_query")
