import logging
import httpx
from src.models.schemas import Article
from src.scrapers.extractor import get_domain

logger = logging.getLogger(__name__)

JINA_BASE_URL = "https://r.jina.ai"
JINA_TIMEOUT = 15.0


def fetch_via_jina(url: str) -> dict | None:
    """
    Fetches clean article content using Jina Reader (r.jina.ai).
    Returns extracted text or None on failure.
    """
    jina_url = f"{JINA_BASE_URL}/{url}"
    headers = {
        "Accept": "application/json",
        "X-Return-Format": "markdown",
    }
    try:
        with httpx.Client(timeout=JINA_TIMEOUT) as client:
            res = client.get(jina_url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                content = data.get("data", {})
                body = content.get("content") or content.get("text", "")
                title = content.get("title", "")
                if body:
                    word_count = len(body.split())
                    return {
                        "body_text": body,
                        "body_markdown": body,
                        "title": title,
                        "author": None,
                        "word_count": word_count,
                        "reading_time_min": max(0.5, round(word_count / 250.0, 1)),
                        "tags": [],
                    }
    except Exception as e:
        logger.warning(f"Jina Reader failed for {url}: {e}")
    return None


def enrich_article_via_jina(article: Article) -> Article:
    """
    Attempts to enrich an Article's body_text using Jina Reader.
    Falls back to existing content if Jina fails.
    """
    extracted = fetch_via_jina(article.url)
    if extracted and extracted.get("body_text"):
        article.body_text = extracted["body_text"]
        article.body_markdown = extracted["body_markdown"]
        article.word_count = extracted["word_count"]
        article.reading_time_min = extracted["reading_time_min"]
        if extracted.get("title") and not article.title:
            article.title = extracted["title"]
        logger.info(f"Jina enrichment succeeded for: {article.url}")
    else:
        logger.debug(f"Jina enrichment skipped (no content) for: {article.url}")
    return article
