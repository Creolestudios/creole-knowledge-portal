import logging
import httpx
from datetime import datetime
from src.config import settings
from src.models.schemas import UserProfile, Article, DailyDigest
from src.scrapers.devto_scraper import fetch_devto_articles
from src.scrapers.hn_scraper import fetch_hn_top_stories
from src.scrapers.rss_scraper import parse_rss_feed
from src.synthesis.generator import generate_daily_digest
from src.storage.mongodb import get_db
from src.ai_pipeline.reranker import get_profile_embedding, semantic_rank, llm_rerank
from src.ai_pipeline.jina_crawler import enrich_article_via_jina

logger = logging.getLogger(__name__)

async def fetch_user_profile_from_supabase(user_id: str) -> UserProfile:
    """
    Fetches the source-of-truth developer profile from Supabase PostgREST.
    """
    url = f"{settings.SUPABASE_URL}/rest/v1/user_profiles"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}"
    }
    params = {
        "user_id": f"eq.{user_id}",
        "select": "*"
    }
    
    logger.info(f"Fetching user profile for {user_id} from Supabase...")
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url, headers=headers, params=params)
        if res.status_code == 200:
            data = res.json()
            if data:
                profile_data = data[0]
                # Map Supabase fields to our Pydantic schema using safe "or" operators
                return UserProfile(
                    user_id=profile_data.get("user_id"),
                    name=profile_data.get("name") or "Developer",
                    years_of_experience=int(profile_data.get("years_of_experience") or 0),
                    primary_tech_stack=profile_data.get("primary_tech_stack") or [],
                    secondary_tech_stack=profile_data.get("secondary_tech_stack") or [],
                    interests=profile_data.get("interests") or profile_data.get("future_learning_goals") or [],
                    current_role=profile_data.get("current_role") or "Developer",
                    preferred_content_depth=profile_data.get("preferred_content_depth"),
                    excluded_topics=profile_data.get("excluded_topics") or []
                )
        
    logger.warning(f"Could not load profile for {user_id} from Supabase. Using default profile.")
    return UserProfile(user_id=user_id, name="Developer")

async def fetch_admin_blog_sources_from_supabase() -> list[str]:
    """
    Fetches list of custom feed URLs registered by admins in Supabase.
    """
    url = f"{settings.SUPABASE_URL}/rest/v1/blog_sources"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}"
    }
    params = {
        "select": "url"
    }
    
    logger.info("Fetching custom blog sources from Supabase...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers, params=params)
            if res.status_code == 200:
                data = res.json()
                return [item.get("url") for item in data if item.get("url")]
    except Exception as e:
        logger.error(f"Error loading blog sources from Supabase: {e}")
        
    return []

def score_article_relevance(article: Article, keywords: list[str]) -> float:
    """
    Computes a keyword relevance score.
    Matching tags, title, or body keywords increases the article relevance score.
    """
    score = 0.0
    text_to_match = f"{article.title} {article.body_text[:2000]} {' '.join(article.tags)}".lower()
    
    for kw in keywords:
        kw_lower = kw.lower()
        # Direct exact match
        if kw_lower in text_to_match:
            score += 10.0
        # Multi-word splits
        for word in kw_lower.split():
            if len(word) > 2 and word in text_to_match:
                score += 2.0
                
    return score

async def run_hybrid_pipeline(user_id: str) -> DailyDigest:
    """
    Executes Strategy C: Hybrid Scrape + Rank + AI Synthesize.
    1. Fetches user profile from Supabase.
    2. Gathers source articles in parallel (Dev.to, HN, custom RSS feeds).
    3. Scores articles on relevance and saves new entries to MongoDB.
    4. Passes top-10 scored articles to Gemini for daily briefing synthesis.
    5. Saves synthesized digest in MongoDB daily_digests collection.
    """
    db = get_db()
    
    # 1. Fetch profile
    user = await fetch_user_profile_from_supabase(user_id)
    
    # Mirror and cache the user profile inside MongoDB user_profiles collection
    try:
        profile_dict = user.model_dump()
        await db.user_profiles.update_one(
            {"user_id": user.user_id},
            {"$set": profile_dict},
            upsert=True
        )
        logger.info(f"Successfully mirrored and cached user profile for {user.user_id} in MongoDB.")
    except Exception as e:
        logger.error(f"Failed to cache user profile in MongoDB: {e}")
    
    # Compile interest keywords
    keywords = [
        user.current_role,
        *user.primary_tech_stack,
        *user.secondary_tech_stack,
        *user.interests
    ]
    keywords = [k for k in keywords if k]
    
    # 2. Scrape articles
    logger.info("Gathering articles across all channels...")
    all_scraped: list[Article] = []
    scraped_sources = []
    
    # A. Scrape Hacker News
    hn_url = "https://news.ycombinator.com/"
    hn_articles_count = 0
    hn_status = "success"
    try:
        hn_items = fetch_hn_top_stories(limit=6)
        all_scraped.extend(hn_items)
        hn_articles_count = len(hn_items)
    except Exception as e:
        logger.error(f"HN Scraping failed: {e}")
        hn_status = "failed"
    scraped_sources.append({
        "url": hn_url,
        "type": "hacker_news",
        "scraped_at": datetime.utcnow(),
        "articles_count": hn_articles_count,
        "status": hn_status
    })
        
    # B. Scrape Dev.to for each interest tag
    tags_to_query = user.primary_tech_stack[:2] + user.interests[:2]
    if not tags_to_query:
        tags_to_query = ["webdev"]
        
    for tag in tags_to_query:
        devto_url = f"https://dev.to/t/{tag}"
        devto_articles_count = 0
        devto_status = "success"
        try:
            devto_items = fetch_devto_articles(tag=tag, limit=8)
            all_scraped.extend(devto_items)
            devto_articles_count = len(devto_items)
        except Exception as e:
            logger.error(f"Dev.to scraping for {tag} failed: {e}")
            devto_status = "failed"
        scraped_sources.append({
            "url": devto_url,
            "type": "devto",
            "tag": tag,
            "scraped_at": datetime.utcnow(),
            "articles_count": devto_articles_count,
            "status": devto_status
        })
            
    # C. Scrape custom registered RSS feeds
    custom_feeds = await fetch_admin_blog_sources_from_supabase()
    for feed in custom_feeds[:4]: # Limit to first 4 feeds to preserve rate limits
        rss_articles_count = 0
        rss_status = "success"
        try:
            rss_items = parse_rss_feed(feed_url=feed, limit=3)
            all_scraped.extend(rss_items)
            rss_articles_count = len(rss_items)
        except Exception as e:
            logger.error(f"RSS Scraper failed for {feed}: {e}")
            rss_status = "failed"
        scraped_sources.append({
            "url": feed,
            "type": "rss",
            "scraped_at": datetime.utcnow(),
            "articles_count": rss_articles_count,
            "status": rss_status
        })

    # Save scraped sources inside MongoDB
    try:
        if scraped_sources:
            await db.scraped_sources.insert_many(scraped_sources)
            logger.info(f"Recorded {len(scraped_sources)} scraped source sites inside MongoDB scraped_sources collection.")
    except Exception as e:
        logger.error(f"Failed to record scraped sources inside MongoDB: {e}")
            
    # 3. Strategy C: keyword pre-filter → semantic ranking → LLM re-rank
    logger.info(f"Evaluating {len(all_scraped)} scraped article candidates...")

    # 3a. Keyword pre-filter (Strategy A layer) — remove excluded topics
    keyword_filtered: list[Article] = []
    for art in all_scraped:
        score = score_article_relevance(art, keywords)
        art.quality_score = score
        is_excluded = any(
            ex.lower() in art.title.lower() or ex.lower() in art.body_text[:500].lower()
            for ex in user.excluded_topics
        )
        if not is_excluded:
            keyword_filtered.append(art)

    keyword_filtered.sort(key=lambda x: x.quality_score, reverse=True)
    pre_semantic_pool = keyword_filtered[:40]  # pass top-40 to semantic ranker

    # 3b. Generate user profile embedding (Strategy B layer)
    logger.info("Generating user profile embedding for semantic ranking...")
    try:
        profile_embedding = get_profile_embedding(user)
    except Exception as e:
        logger.error(f"Profile embedding failed: {e}. Falling back to keyword ranking.")
        profile_embedding = []

    # 3c. Semantic ranking via cosine similarity
    if profile_embedding and any(v != 0.0 for v in profile_embedding):
        logger.info("Running semantic cosine similarity ranking...")
        semantically_ranked = semantic_rank(pre_semantic_pool, profile_embedding, top_n=20)
    else:
        semantically_ranked = pre_semantic_pool[:20]

    # 3d. Deep-scrape top-20 via Jina Reader with newspaper3k fallback
    logger.info(f"Deep-scraping top {len(semantically_ranked)} candidates via Jina Reader...")
    from src.scrapers.extractor import extract_article_content
    for art in semantically_ranked:
        try:
            enriched = enrich_article_via_jina(art)
            if not enriched.body_text or len(enriched.body_text) < 200:
                # Jina returned empty — fall back to newspaper3k
                extracted = extract_article_content(art.url)
                if extracted and extracted.get("body_text"):
                    art.body_text = extracted["body_text"]
                    art.body_markdown = extracted.get("body_markdown") or extracted["body_text"]
                    art.word_count = extracted["word_count"]
                    art.reading_time_min = extracted["reading_time_min"]
                    if extracted.get("author"):
                        art.author = extracted["author"]
        except Exception as e:
            logger.warning(f"Deep scraping failed for {art.url}: {e}")

    # 3e. LLM re-rank top-20 → final top-6
    logger.info("Running Gemini LLM re-ranker on top candidates...")
    try:
        top_candidates = llm_rerank(semantically_ranked, user, top_n=6)
    except Exception as e:
        logger.error(f"LLM re-ranking failed: {e}. Using semantic ranking order.")
        top_candidates = semantically_ranked[:6]

    logger.info(f"Final candidate set: {len(top_candidates)} articles selected for synthesis.")
            
    # Cache articles in MongoDB
    saved_articles = []
    for art in top_candidates:
        try:
            # Check if already cached in MongoDB
            existing = await db.articles.find_one({"url": art.url})
            if not existing:
                # Insert new article
                art_dict = art.model_dump()
                art_dict.pop("id", None)
                res = await db.articles.insert_one(art_dict)
                art.id = str(res.inserted_id)
                logger.info(f"Cached new article in MongoDB: {art.title}")
            else:
                art.id = str(existing["_id"])
            saved_articles.append(art)
        except Exception as e:
            logger.error(f"Error caching article {art.title} in MongoDB: {e}")
            
    # Fallback to general MongoDB articles if we couldn't scrape new ones
    if not saved_articles:
        logger.info("Scraping returned zero new candidates. Loading older items from MongoDB...")
        cursor = db.articles.find().sort("scraped_at", -1).limit(10)
        async for doc in cursor:
            doc["id"] = str(doc.pop("_id"))
            saved_articles.append(Article(**doc))
            
    # 4. Synthesize custom Daily Digest (Strategy C = A fetch + B semantic rank + LLM synthesis)
    digest = generate_daily_digest(user, saved_articles)
    digest.strategy_used = "C"
    
    # 5. Save digest inside MongoDB
    try:
        # Delete today's previous digest if any to allow overwrite
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        await db.daily_digests.delete_many({
            "user_id": user_id,
            "generated_at": {"$gte": today_start}
        })
        
        digest_dict = digest.model_dump()
        await db.daily_digests.insert_one(digest_dict)
        logger.info(f"Daily digest successfully saved in MongoDB daily_digests.")
    except Exception as e:
        logger.error(f"Error saving daily digest in MongoDB: {e}")
        
    return digest
