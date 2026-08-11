import logging
import httpx
from datetime import datetime
from typing import List
from src.scrapers.extractor import extract_article_content, get_domain
from src.models.schemas import Article

logger = logging.getLogger(__name__)

def fetch_hn_top_stories(limit: int = 5) -> List[Article]:
    """
    Fetches hot top stories from Hacker News and scrapes their detailed content.
    """
    articles = []
    logger.info("Fetching top story IDs from Hacker News...")
    
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get("https://hacker-news.firebaseio.com/v0/topstories.json")
            if res.status_code == 200:
                story_ids = res.json()[:limit]
                for story_id in story_ids:
                    try:
                        item_res = client.get(f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json")
                        if item_res.status_code == 200:
                            item = item_res.json()
                            url = item.get("url")
                            if not url:
                                continue
                                
                            published_at = datetime.fromtimestamp(item.get("time", datetime.utcnow().timestamp()))
                            
                            body_text = item.get("title", "")
                            
                            article = Article(
                                url=url,
                                title=item.get("title", ""),
                                author=item.get("by"),
                                source_domain=get_domain(url),
                                published_at=published_at,
                                body_text=body_text,
                                body_markdown=body_text,
                                word_count=len(body_text.split()),
                                reading_time_min=0.5,
                                tags=["tech", "news", "hacker-news"],
                                strategy_source="A"
                            )
                            articles.append(article)
                    except Exception as e:
                        logger.error(f"Error fetching HN item {story_id}: {e}")
            else:
                logger.error(f"HN topstories API returned status {res.status_code}")
    except Exception as e:
        logger.error(f"Error fetching Hacker News top stories: {e}")
        
    return articles
