import logging
import json
import math
import google.generativeai as genai
from src.config import settings
from src.models.schemas import Article, UserProfile
from src.ai_pipeline.embeddings import get_text_embedding, calculate_cosine_similarity

logger = logging.getLogger(__name__)

if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)


def get_profile_embedding(profile: UserProfile) -> list[float]:
    """Generates a semantic embedding for a user profile."""
    profile_text = (
        f"Role: {profile.current_role}. "
        f"Experience: {profile.years_of_experience} years. "
        f"Primary stack: {', '.join(profile.primary_tech_stack)}. "
        f"Secondary stack: {', '.join(profile.secondary_tech_stack)}. "
        f"Interests: {', '.join(profile.interests)}."
    )
    return get_text_embedding(profile_text)


def semantic_rank(
    articles: list[Article],
    profile_embedding: list[float],
    top_n: int = 20,
) -> list[Article]:
    """
    Ranks articles by cosine similarity against the user profile embedding.
    Embeds each article if not already embedded, then sorts by similarity score.
    """
    for art in articles:
        if not art.embedding or all(math.isclose(v, 0.0, abs_tol=1e-9) for v in art.embedding):
            snippet = f"{art.title}. {art.body_text[:3000]}"
            art.embedding = get_text_embedding(snippet)

    ranked = sorted(
        articles,
        key=lambda a: calculate_cosine_similarity(a.embedding or [], profile_embedding),
        reverse=True,
    )
    return ranked[:top_n]


def llm_rerank(
    articles: list[Article],
    profile: UserProfile,
    top_n: int = 6,
) -> list[Article]:
    """
    Uses Gemini to re-rank a shortlist of articles for a specific user profile.
    Returns the top_n most relevant articles in order.
    Falls back to the original order if Gemini fails.
    """
    if not articles:
        return articles

    candidates = []
    for i, art in enumerate(articles):
        candidates.append(
            f"[{i}] Title: {art.title}\n"
            f"    Domain: {art.source_domain}\n"
            f"    Snippet: {art.body_text[:400]}"
        )

    prompt = f"""You are a technical content curator for a senior developer.

Developer profile:
- Role: {profile.current_role}
- Stack: {', '.join(profile.primary_tech_stack + profile.secondary_tech_stack)}
- Interests: {', '.join(profile.interests)}
- Experience: {profile.years_of_experience} years

Candidate articles:
{chr(10).join(candidates)}

Return a JSON array of the {top_n} most relevant article indices in order of relevance (most relevant first).
Example: [3, 0, 5, 1, 4, 2]
Only output the JSON array, nothing else."""

    models_to_try = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash"]

    for model_name in models_to_try:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            if response and response.text:
                indices = json.loads(response.text)
                if isinstance(indices, list):
                    reranked = []
                    seen = set()
                    for idx in indices:
                        if isinstance(idx, int) and 0 <= idx < len(articles) and idx not in seen:
                            reranked.append(articles[idx])
                            seen.add(idx)
                    # Fill remaining slots from original order if needed
                    for i, art in enumerate(articles):
                        if i not in seen and len(reranked) < top_n:
                            reranked.append(art)
                    logger.info(f"LLM re-ranking completed with {model_name}.")
                    return reranked[:top_n]
        except Exception as e:
            logger.warning(f"LLM re-rank failed with {model_name}: {e}")

    logger.warning("LLM re-ranking failed for all models. Returning original order.")
    return articles[:top_n]
