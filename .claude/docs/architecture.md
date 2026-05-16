# Architecture — Creole Knowledge Portal

## System Overview

```
Browser
  │
  ▼
Next.js 15 App (Port 3000)
  ├── app/ (App Router)
  │   ├── page.tsx            → Login (Magic Link + Google OAuth)
  │   ├── dashboard/page.tsx  → User: daily digest viewer
  │   ├── admin/dashboard/    → Admin: user management
  │   ├── auth/callback/      → Supabase auth handler
  │   └── api/admin/          → Server-side admin API
  ├── components/             → Shared UI components
  ├── lib/supabase/           → Supabase client factories
  └── middleware.ts           → Auth routing guard
         │
         ▼
    Supabase (Cloud)
    ├── Auth (Magic Link + Google)
    └── PostgreSQL DB
         │
         ▼
    FastAPI Service (fetch-blogs/)  ← separate Python process
    ├── Strategy A: RSS + APIs
    ├── Strategy B: Crawl4AI + LLM
    ├── Strategy C: Hybrid (default)
    ├── APScheduler (daily cron)
    └── PostgreSQL + pgvector
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
APScheduler (daily)
  → For each user profile in DB
  → Strategy C: fetch RSS/APIs → extract → LLM rank → synthesize
  → Store in daily_digests table
  → Next.js GET /api/digests/{user_id}/latest
  → Dashboard renders structured JSON
```

## Component Hierarchy
```
app/dashboard/page.tsx (Server Component)
  → Fetches user + latest digest from Supabase
  → Renders DigestCard + SourceList

app/admin/dashboard/page.tsx (Server Component)
  → components/user-management.tsx (Client Component)
    → Handles user search, filter, actions
```

## Environment Variables

| Variable | Used In | Secret? |
|----------|---------|---------|
| `GEMINI_API_KEY` | Server only | ✅ Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | ❌ No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | ✅ Yes |
| `APP_URL` | Server only | ❌ No |

## Key Design Decisions
1. **No separate auth service** — Supabase handles everything
2. **Admin by email match** — simple, avoids complex RBAC for 50-user internal tool
3. **Strategy C as default** — best cost/quality tradeoff without paid scraping APIs
4. **PostgreSQL + pgvector** — single DB for MVP; no separate vector store needed
5. **Gemini free tier → Ollama fallback** — zero-cost AI pipeline
6. **Next.js consumes FastAPI JSON** — clean separation; FastAPI can be replaced later
