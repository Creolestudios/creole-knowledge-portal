import feedparser
import logging
from datetime import datetime, timezone
import time
from typing import List
from src.scrapers.extractor import extract_article_content, get_domain
from src.models.schemas import Article

logger = logging.getLogger(__name__)

def parse_rss_feed(feed_url: str, limit: int = 5) -> List[Article]:
    """
    Parses an RSS feed (Substack, Medium, standard blog) and returns scraped Articles.
    """
    articles = []
    logger.info(f"Parsing RSS feed: {feed_url}")
    
    try:
        feed = feedparser.parse(feed_url)
        entries = feed.entries[:limit]
        
        for entry in entries:
            url = getattr(entry, "link", None)
            if not url:
                continue
                
            title = getattr(entry, "title", "Untitled Feed Item")
            
            # Parse published date
            published_at = datetime.now(timezone.utc)
            for date_key in ("published_parsed", "updated_parsed", "created_parsed"):
                date_val = getattr(entry, date_key, None)
                if date_val:
                    try:
                        published_at = datetime.fromtimestamp(time.mktime(date_val))
                        break
                    except Exception:
                        pass
            
            body_text = getattr(entry, "summary", "") or getattr(entry, "description", "") or title
            
            article = Article(
                url=url,
                title=title,
                author=getattr(entry, "author", None),
                source_domain=get_domain(url),
                published_at=published_at,
                body_text=body_text,
                body_markdown=body_text,
                word_count=len(body_text.split()),
                reading_time_min=max(0.5, round(len(body_text.split()) / 250.0, 1)),
                tags=[tag.term for tag in getattr(entry, "tags", [])] if hasattr(entry, "tags") else ["rss"],
                strategy_source="A"
            )
            articles.append(article)
            
    except Exception as e:
        logger.error(f"Error parsing RSS feed {feed_url}: {e}")
        
    return articles
