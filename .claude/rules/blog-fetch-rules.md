# Blog Fetch Module — Architecture Rules

## Overview
The blog fetch system (`fetch-blogs/`) is a **Python/FastAPI** service that runs alongside the Next.js frontend. It provides personalized daily tech article digests via a REST API consumed by the Next.js dashboard.

## Three Strategies (Always Build Independently)
- **Strategy A** — Traditional: RSS + free APIs + TF-IDF/BM25 ranking (zero LLM cost)
- **Strategy B** — LLM-Powered: Crawl4AI/Jina + Gemini embeddings + semantic re-ranking
- **Strategy C** — Hybrid (preferred): Strategy A fetch pipeline + Strategy B ranking

> Default to Strategy C in production. Benchmark all three before choosing per user profile.

## Content Policy (Non-Negotiable)
- Always check and respect `robots.txt` before scraping any domain
- Maintain a `blocklist.txt` of domains that disallow scraping
- Use `robots.txt` cache — don't re-fetch on every request
- Never scrape paywalled content

## Free-Tier API Constraints
| Source | Limit | Handle By |
|--------|-------|-----------|
| Gemini 2.0 Flash | 15 RPM / 1M TPD | Rate limiter + Ollama fallback |
| Dev.to API | 30 req/min | `tenacity` retry with backoff |
| Reddit API | 60 req/min | `tenacity` retry with backoff |
| Google Custom Search | 100/day | Cache results aggressively |

## Data Flow
1. User profile → query generation → RSS + API fetch
2. Content extraction (`newspaper3k` / `readability-lxml` / `trafilatura`)
3. Dedup (URL + semantic similarity)
4. Scoring (TF-IDF + authority + recency + engagement + complexity fit)
5. LLM re-ranking (Gemini free / Ollama fallback)
6. Synthesis → structured JSON → stored in `daily_digests` table
7. Next.js dashboard consumes via `/api/digests/{user_id}/latest`

## Output Contract (for Next.js)
The digest JSON shape must match exactly — the frontend depends on it:
```typescript
interface DigestOutput {
  digest_id: string;          // UUID
  generated_at: string;       // ISO timestamp
  user_id: string;
  strategy_used: 'A' | 'B' | 'C';
  reading_time_minutes: number; // target: 15–20
  word_count: number;           // target: 3750–5000
  article: {
    headline: string;
    tldr: string[];
    sections: Array<{
      title: string;
      content: string;           // Markdown
      sources_cited: number[];
      estimated_read_minutes: number;
    }>;
    key_takeaways: string[];
    sources: Array<{
      id: number;
      title: string;
      url: string;
      author: string;
      source_domain: string;
      published_at: string;
    }>;
    further_reading: Array<{ title: string; url: string }>;
  };
  metadata: {
    articles_evaluated: number;
    articles_used_in_synthesis: number;
    llm_tokens_used: number;
    generation_latency_seconds: number;
  };
}
```

## Database Schema (PostgreSQL + pgvector)
Tables: `articles`, `user_profiles`, `daily_digests`
Vector column: `embedding vector(768)` — use `hnsw` index for cosine similarity

## Synthesis Rules
- Target word count: 3,750–5,000 (midpoint: 4,375)
- Reading speed: 250 WPM prose / 100 WPM code / +12s per image
- Max 2 refinement iterations on word count
- Use Gemini 2.0 Flash first; fall back to Ollama (Llama 3.1 8B or Mistral 7B)

## Python Module Structure
```
fetch-blogs/
├── src/
│   ├── models/        # Pydantic v2 models
│   ├── scrapers/      # Strategy A: RSS, HN, Dev.to, Reddit
│   ├── ai_pipeline/   # Strategy B: Crawl4AI, embeddings
│   ├── hybrid/        # Strategy C: combined pipeline
│   ├── scoring/       # TF-IDF, BM25, composite scorer
│   ├── storage/       # SQLAlchemy + pgvector repository
│   ├── synthesis/     # Dedup, clustering, LLM synthesis
│   ├── api/           # FastAPI routes
│   ├── scheduler/     # APScheduler daily job
│   ├── benchmark/     # A vs B vs C comparison
│   └── config/        # Settings, source registry
├── tests/
├── pyproject.toml
└── README.md
```

## FastAPI Endpoints
- `POST /api/profiles` — create/update user profile
- `GET  /api/profiles/{id}` — get user profile
- `POST /api/digests/generate` — trigger manual digest
- `GET  /api/digests/{user_id}/latest` — latest digest (consumed by Next.js)
- `GET  /api/digests/{user_id}/history` — past digests
- `POST /api/benchmark/run` — run all 3 strategies
- `GET  /api/health` — health check
