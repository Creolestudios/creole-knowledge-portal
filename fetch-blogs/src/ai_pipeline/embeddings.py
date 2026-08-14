import logging
import math
import google.generativeai as genai
from src.config import settings

logger = logging.getLogger(__name__)

# Configure Gemini Client
if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)
else:
    logger.warning("GEMINI_API_KEY not set in environment settings.")

def get_text_embedding(text: str) -> list[float]:
    """
    Generates a 768-dimensional text embedding vector using Gemini text-embedding-004.
    If the API call fails or key is missing, returns a 768-dim zero vector fallback.
    """
    if not settings.GEMINI_API_KEY:
        logger.warning("Gemini key is missing. Returning 768-dimensional zero-vector.")
        return [0.0] * 768
        
    try:
        # Trim text to prevent token limit issues
        trimmed_text = text[:15000]
        
        response = genai.embed_content(
            model="models/text-embedding-004",
            contents=trimmed_text,
            task_type="retrieval_document"
        )
        
        if "embedding" in response:
            return response["embedding"]
            
    except Exception as e:
        logger.error(f"Error generating embedding via Gemini API: {e}")
        
    # Return zero vector fallback
    return [0.0] * 768

def calculate_cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """
    Utility to calculate cosine similarity between two 768-dim vector embeddings.
    """
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
        
    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5
    
    if math.isclose(norm_a, 0.0, abs_tol=1e-9) or math.isclose(norm_b, 0.0, abs_tol=1e-9):
        return 0.0
        
    return dot_product / (norm_a * norm_b)
