# Architecture — Creole Knowledge Portal

## System Overview

```
Browser
  │
  ▼
Next.js 15 App (Port 3000)
  ├── app/ (App Router)
  │   ├── page.tsx               → Login (Magic Link + Google OAuth)
  │   ├── dashboard/page.tsx     → User: daily digest viewer
  │   ├── admin/dashboard/       → Admin: user management
  │   ├── auth/callback/         → Supabase auth handler
  │   └── api/admin/             → Server-side admin API
  ├── components/                → Shared UI components
  ├── lib/supabase/              → Supabase client factories
  └── middleware.ts              → Auth routing guard
         │
         ▼
    Supabase (Cloud)
    ├── Auth (Magic Link + Google)
    └── PostgreSQL DB (user accounts, preferences)
         │
         ▼ HTTP :8000
    FastAPI Microservice — fetch-blogs/ (Docker)
    ├── src/main.py              ← FastAPI app factory + APScheduler lifespan
    ├── src/api/routes/          ← REST endpoints (pipeline, digests, profiles, health)
    ├── src/workers/             ← Celery task chain (5 stages, 5 queues)
    ├── src/scrapers/            ← Strategy A: RSS, HN, Dev.to, Reddit
    ├── src/extractors/          ← Strategy B: Crawl4AI, Gemini embeddings
    ├── src/ranker/              ← numpy cosine + LLM re-rank
    ├── src/generator/           ← Gemini synthesis + quality gate
    └── src/publisher/           ← Beanie upsert to MongoDB
         │                   │
         ▼                   ▼
    MongoDB 7 (Docker)    Redis 7 (Docker)
    Beanie ODM documents  db=0: Celery broker
    - articles            db=1: Celery results
    - daily_digests
    - user_profiles
    - pipeline_jobs
    - admin_configs
         │
         ▼
    Gemini AI (free tier) / Ollama (local fallback)
```

## Auth Flow
```
User visits /
  → middleware.ts checks Supabase session
  → Not logged in → stay on / (login page)
  → Logged in, admin email → redirect to /admin/dashboard
  → Logged in, non-admin → redirect to /dashboard
```

## Data Flow: Digest Delivery
```
APScheduler (daily cron — 06:00 IST / 00:30 UTC)
  → Enqueues Celery task to scrape_queue
  → Celery chain: scrape → extract → rank → generate → publish
  → DailyDigest written to MongoDB
  → Next.js GET /api/v1/digests/{user_id}/latest (HTTP to fetch-blogs :8000)
  → Dashboard renders structured DigestOutput JSON
```

## Pipeline Task Chain (Celery)
```
scrape_queue        → Scrape RSS/HN/Dev.to/Reddit → Article documents in Mongo
  extract_queue     → Crawl4AI content extraction → Article.body_text + embedding
    rank_queue      → numpy cosine sim + Gemini re-rank → Article.quality_score
      generate_queue → Gemini Flash synthesis → DigestArticle JSON
        publish_queue  → Beanie upsert → DailyDigest saved
```

Each stage passes only `list[str]` (article IDs) forward — no large Redis payloads.

## Docker Services (fetch-blogs/ only)
| Service | Port | Role |
|---|---|---|
| `fastapi-api` | 8000 | FastAPI + APScheduler |
| `celery-scrape` | — | Stage 1 worker |
| `celery-extract` | — | Stage 2 worker |
| `celery-rank` | — | Stage 3 worker |
| `celery-generate` | — | Stage 4 worker |
| `celery-publish` | — | Stage 5 worker |
| `flower` | 5555 | Celery monitoring UI |
| `mongo` | 27017 | MongoDB 7 |
| `redis` | 6379 | Redis 7 (broker + results) |

## Component Hierarchy (Next.js)
```
app/dashboard/page.tsx (Server Component)
  → Fetches user session + digest via HTTP from FastAPI :8000
  → Renders DigestCard + SourceList

app/admin/dashboard/page.tsx (Server Component)
  → components/user-management.tsx (Client Component)
    → Handles user search, filter, actions
```

## Environment Variables

### Next.js (`.env.local`)
| Variable | Used In | Secret? |
|----------|---------|---------| 
| `GEMINI_API_KEY` | Server only | ✅ Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | ❌ No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | ✅ Yes |
| `APP_URL` | Server only | ❌ No |

### Python microservice (`fetch-blogs/.env`) — domain-prefixed
| Variable | Domain Class | Example |
|---|---|---|
| `APP_ENVIRONMENT` | `AppSettings` | `local` |
| `MONGO_URI` | `MongoSettings` | `mongodb://mongo:27017` |
| `REDIS_URL` | `RedisSettings` | `redis://redis:6379/0` |
| `REDIS_RESULT_URL` | `RedisSettings` | `redis://redis:6379/1` |
| `AUTH_SECRET_KEY` | `AuthSettings` | 32-char random string |
| `LLM_GEMINI_API_KEY` | `LLMSettings` | Gemini API key |
| `SCRAPING_CRON_SCHEDULE` | `ScrapingSettings` | `"30 0 * * *"` |

## Key Design Decisions
1. **No separate auth service** — Supabase handles Next.js auth entirely
2. **Admin by email match** — simple, avoids complex RBAC for 50-user internal tool
3. **Strategy C as default** — best cost/quality tradeoff without paid scraping APIs
4. **MongoDB + Beanie ODM** — flexible schema for article metadata; no migration scripts needed
5. **numpy cosine sim (self-hosted)** — zero-cost vector search; Atlas migration path is isolated to `src/ranker/vector_search.py`
6. **Gemini free tier → Ollama fallback** — zero-cost AI pipeline
7. **Next.js consumes FastAPI JSON** — clean separation; FastAPI can be replaced without touching Next.js
8. **domain-split pydantic-settings** — each Celery worker imports only its own settings class
9. **`src/` layout with uv** — native importable package, no PYTHONPATH hacks in Docker
