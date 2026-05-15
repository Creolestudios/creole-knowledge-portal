# Blog Fetch Plan — Full Implementation Reference

Condensed from `implementation_plan_v1.md` for Claude Code consumption.

## Goal
Generate a **15–20 minute personalized tech article digest** daily for each user profile,
synthesized from free public sources, stored in PostgreSQL, and served to the Next.js dashboard.

## User Profile Shape
```python
class UserProfile(BaseModel):
    user_id: str
    name: str
    years_of_experience: int       # 0-1 = junior, 2-5 = mid, 6+ = senior
    primary_tech_stack: list[str]  # e.g. ["Python", "FastAPI", "PostgreSQL"]
    secondary_tech_stack: list[str]
    interests: list[str]           # e.g. ["distributed-systems", "MLOps"]
    current_role: str
    preferred_content_depth: str | None = None  # auto-derived from YOE
    excluded_topics: list[str] = []
    preferred_sources: list[str] = []
    content_freshness_days: int = 30
```
Auto-derive depth: 0–1 YOE → beginner, 2–5 → intermediate, 6+ → advanced.

## Strategy A: Traditional (No LLM)
- **Sources:** RSS (Medium, Substack, personal blogs), HN API, Dev.to API, Reddit API, Google Custom Search
- **Extraction:** `feedparser` → `newspaper3k` / `readability-lxml` / `BeautifulSoup`
- **Scoring:** `0.35×TF-IDF + 0.25×authority + 0.15×recency + 0.15×engagement + 0.10×complexity_fit`
- **Curated Registry:** ~200 feeds across Systems, Python, Frontend, AI/ML, DevOps, Career

## Strategy B: LLM-Powered
- **Query gen:** Gemini 2.0 Flash or Ollama
- **Crawl:** Crawl4AI (self-hosted) or Jina Reader (`r.jina.ai/{url}`) or Trafilatura
- **Embeddings:** Gemini `text-embedding-004` (free) or `nomic-embed-text` via Ollama
- **Ranking:** cosine sim + LLM re-ranker on top-50
- **Quality:** LLM evaluates accuracy, depth, actionability, originality

## Strategy C: Hybrid (Production Default)
1. Fetch via Strategy A's RSS + API pipeline
2. Extract with `newspaper3k` / `readability-lxml`
3. Rank via Strategy B's embedding cosine + LLM re-ranking
4. Synthesize with Gemini Flash / Ollama

## Benchmark Metrics
```python
class StrategyBenchmark(BaseModel):
    strategy: str                  # "A", "B", or "C"
    profile_id: str
    articles_fetched: int
    articles_after_dedup: int
    avg_relevance_score: float     # 0–1
    latency_seconds: float
    llm_tokens_used: int
    synthesis_quality_score: float # human-rated 1–10
    reading_time_accuracy: float
```

## Database Schema (PostgreSQL + pgvector)
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE articles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url             TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    author          TEXT,
    source_domain   TEXT NOT NULL,
    published_at    TIMESTAMPTZ,
    scraped_at      TIMESTAMPTZ DEFAULT NOW(),
    body_text       TEXT NOT NULL,
    body_markdown   TEXT,
    word_count      INTEGER,
    reading_time_min FLOAT,
    tags            TEXT[],
    metadata        JSONB DEFAULT '{}',
    embedding       vector(768),
    quality_score   FLOAT,
    strategy_source VARCHAR(1),   -- 'A', 'B', or 'C'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    years_of_experience     INTEGER,
    primary_tech_stack      TEXT[],
    secondary_tech_stack    TEXT[],
    interests               TEXT[],
    current_role            TEXT,
    preferred_content_depth VARCHAR(20),
    excluded_topics         TEXT[],
    profile_embedding       vector(768),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_digests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES user_profiles(id),
    digest_json     JSONB NOT NULL,
    word_count      INTEGER,
    reading_time    FLOAT,
    source_articles UUID[],
    strategy_used   VARCHAR(1),
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_embedding ON articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_articles_tags ON articles USING GIN (tags);
CREATE INDEX idx_digests_user ON daily_digests (user_id, generated_at DESC);
```

## Dependencies (Python)
```
python ^3.11
fastapi, uvicorn, pydantic ^2.0, httpx
feedparser, beautifulsoup4, newspaper3k, readability-lxml, trafilatura
scikit-learn (TF-IDF), crawl4ai, google-generativeai (free tier)
sqlalchemy ^2.0, pgvector, asyncpg, apscheduler
playwright (JS fallback), tenacity, structlog
```

## Synthesis Rules
- Target: 3,750–5,000 words (midpoint: 4,375)
- Prose: 250 WPM / Code: 100 WPM / Image: +12s
- Max 2 refinement iterations
- LLM priority: Gemini 2.0 Flash → Gemini 1.5 Pro → Llama 3.1 8B (Ollama) → Mistral 7B (Ollama)
