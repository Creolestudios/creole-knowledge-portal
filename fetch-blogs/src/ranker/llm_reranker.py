"""Gemini-assisted article re-ranking with deterministic fallback."""

from __future__ import annotations

import json
from typing import Protocol

import google.generativeai as genai
import structlog
from pydantic import BaseModel, Field, ValidationError

from src.core.config import get_llm_settings
from src.models.article import Article
from src.models.profile import UserProfile
from src.ranker.scorer import clamp_score

log = structlog.get_logger(__name__)


class RerankCandidate(BaseModel):
    """Bounded metadata sent to the AI re-ranker."""

    article_id: str
    title: str
    source_domain: str
    summary: str = ""
    topics: list[str] = Field(default_factory=list)
    tech_stack: list[str] = Field(default_factory=list)
    composite_score: float = Field(ge=0.0, le=1.0)
    vector_similarity: float = Field(default=0.0, ge=0.0, le=1.0)

    @classmethod
    def from_article(
        cls, article: Article, composite_score: float, vector_similarity: float
    ) -> "RerankCandidate":
        """Create a candidate from an Article without sending full content bodies."""
        return cls(
            article_id=str(article.id),
            title=article.title,
            source_domain=article.source_domain,
            summary=article.summary[:600],
            topics=article.topics[:10],
            tech_stack=article.tech_stack[:10],
            composite_score=clamp_score(composite_score),
            vector_similarity=clamp_score(vector_similarity),
        )


class RerankResult(BaseModel):
    """AI or fallback ranking result."""

    article_id: str
    score: float = Field(ge=0.0, le=1.0)
    reason: str


class _GeminiResponse(Protocol):
    text: str


class _GeminiModel(Protocol):
    def generate_content(self, prompt: str) -> _GeminiResponse: ...


class _GeminiResultItem(BaseModel):
    article_id: str
    score: float = Field(ge=0.0, le=1.0)
    reason: str = "Gemini relevance judgment"


class _GeminiResultEnvelope(BaseModel):
    results: list[_GeminiResultItem]


def build_rerank_prompt(profile: UserProfile, candidates: list[RerankCandidate]) -> str:
    """Build a compact JSON-only prompt for Gemini."""
    profile_payload = {
        "years_of_experience": profile.years_of_experience,
        "content_depth": profile.content_depth.value,
        "primary_tech_stack": profile.primary_tech_stack,
        "secondary_tech_stack": profile.secondary_tech_stack,
        "interests": profile.interests,
        "excluded_topics": profile.excluded_topics,
    }
    candidate_payload = [candidate.model_dump() for candidate in candidates]
    return f"""
You are ranking technical blog articles for a personalized engineering digest.
Prefer deep technical posts (APIs, frameworks, databases, architecture, debugging).
Never prefer career advice, job hunting, LinkedIn/GitHub branding, portfolios, or soft skills.
Return strict JSON only. Do not include markdown.

Profile:
{json.dumps(profile_payload, ensure_ascii=False)}

Candidates:
{json.dumps(candidate_payload, ensure_ascii=False)}

Rank every candidate by relevance, novelty, technical depth fit, and practical value.
Return this exact shape:
{{"results":[{{"article_id":"...","score":0.0,"reason":"short reason"}}]}}
Scores must be between 0 and 1. Include each candidate at most once.
""".strip()


def fallback_rerank(candidates: list[RerankCandidate], limit: int) -> list[RerankResult]:
    """Return deterministic ranking when Gemini is unavailable or invalid."""
    ordered = sorted(
        candidates,
        key=lambda candidate: (candidate.composite_score * 0.65) + (candidate.vector_similarity * 0.35),
        reverse=True,
    )
    return [
        RerankResult(
            article_id=candidate.article_id,
            score=clamp_score((candidate.composite_score * 0.65) + (candidate.vector_similarity * 0.35)),
            reason="Fallback rank: deterministic composite/vector blend",
        )
        for candidate in ordered[:limit]
    ]


def parse_gemini_rerank_response(response_text: str, candidates: list[RerankCandidate]) -> list[RerankResult]:
    """Parse and validate Gemini's JSON re-rank result."""
    candidate_ids = {candidate.article_id for candidate in candidates}
    payload = json.loads(response_text)
    envelope = _GeminiResultEnvelope.model_validate(payload)
    results: list[RerankResult] = []
    seen: set[str] = set()
    for item in envelope.results:
        if item.article_id not in candidate_ids or item.article_id in seen:
            continue
        seen.add(item.article_id)
        results.append(
            RerankResult(article_id=item.article_id, score=clamp_score(item.score), reason=item.reason)
        )
    return sorted(results, key=lambda result: result.score, reverse=True)


def rerank_with_gemini(
    profile: UserProfile,
    candidates: list[RerankCandidate],
    limit: int = 20,
    model: _GeminiModel | None = None,
) -> list[RerankResult]:
    """Rank candidates with Gemini, falling back to deterministic scoring."""
    bounded_candidates = candidates[:50]
    if not bounded_candidates:
        return []

    settings = get_llm_settings()
    if not settings.GEMINI_API_KEY and model is None:
        return fallback_rerank(bounded_candidates, limit)

    try:
        gemini_model = model
        if gemini_model is None:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            gemini_model = genai.GenerativeModel(settings.GEMINI_MODEL)
        response = gemini_model.generate_content(build_rerank_prompt(profile, bounded_candidates))
        parsed = parse_gemini_rerank_response(response.text, bounded_candidates)
        if not parsed:
            return fallback_rerank(bounded_candidates, limit)
        missing = [candidate for candidate in bounded_candidates if candidate.article_id not in {r.article_id for r in parsed}]
        merged = [*parsed, *fallback_rerank(missing, limit)]
        return merged[:limit]
    except (json.JSONDecodeError, ValidationError, ValueError, RuntimeError, Exception) as exc:
        log.warning("ranker: gemini rerank fallback", error=str(exc))
        return fallback_rerank(bounded_candidates, limit)
