"""Strategy A scrapers — legacy modules used by hybrid and Celery scrape."""

from src.scrapers.devto_scraper import fetch_devto_articles
from src.scrapers.hn_scraper import fetch_hn_top_stories
from src.scrapers.rss_scraper import parse_rss_feed

__all__ = ["fetch_devto_articles", "fetch_hn_top_stories", "parse_rss_feed"]
