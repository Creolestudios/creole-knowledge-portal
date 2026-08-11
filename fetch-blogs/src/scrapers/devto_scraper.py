import logging
import httpx
from datetime import datetime
from typing import List
from src.scrapers.extractor import extract_article_content, get_domain
from src.models.schemas import Article

logger = logging.getLogger(__name__)

def fetch_devto_articles(tag: str = None, limit: int = 10) -> List[Article]:
    """
    Fetches hot/trending articles from Dev.to API for a given interest tag.
    """
    articles = []
    url = "https://dev.to/api/articles"
    params = {"per_page": limit}
    if tag:
        params["tag"] = tag.lower().replace(" ", "")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    
    logger.info(f"Fetching articles from Dev.to API with tag: {tag or 'latest'}")
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(url, params=params, headers=headers)
            if res.status_code == 200:
                data = res.json()
                for item in data:
                    item_url = item.get("url")
                    if not item_url:
                        continue
                    
                    published_str = item.get("published_at")
                    published_at = datetime.utcnow()
                    if published_str:
                        try:
                            # Parse ISO timestamp
                            published_at = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                        except Exception:
                            pass
                            
                    body_text = item.get("description", "") or ""
                    
                    article = Article(
                        url=item_url,
                        title=item.get("title", ""),
                        author=item.get("user", {}).get("name"),
                        source_domain="dev.to",
                        published_at=published_at,
                        body_text=body_text,
                        body_markdown=body_text,
                        word_count=len(body_text.split()),
                        reading_time_min=max(0.5, round(len(body_text.split()) / 250.0, 1)),
                        tags=item.get("tag_list", []) or ([tag] if tag else ["dev.to"]),
                        strategy_source="A"
                    )
                    articles.append(article)
            else:
                logger.error(f"Dev.to API failed with status: {res.status_code}")
    except Exception as e:
        logger.error(f"Error fetching Dev.to articles: {e}")
        
    return articles
