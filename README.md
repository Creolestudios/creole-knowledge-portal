# Creole Knowledge Portal

Internal office tool for **personalized morning tech blog recommendations** and a **daily AI digest**. Users sign in via Supabase (Magic Link + Google OAuth), set their tech interests, and receive curated content powered by the fetch-blogs pipeline and Google Gemini.

## Stack

| Layer | Technology |
|-------|------------|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Auth & Postgres | Supabase (Magic Link, Google OAuth, user profiles, quiz) |
| Blog pipeline | `fetch-blogs/` — Python, FastAPI, Celery, MongoDB, Redis |
| AI | Google Gemini |
| Production infra | AWS ECS Fargate (Pulumi) — see [`infra/README.md`](infra/README.md) |

## Quick start (local dev)

### Prerequisites

- Node.js 18+ or 20+
- npm 9+
- A Supabase project ([dashboard](https://app.supabase.com))
- A Gemini API key ([AI Studio](https://aistudio.google.com/app/apikey))

### 1. Install dependencies

```bash
git clone https://github.com/Creolestudios/creole-knowledge-portal.git
cd creole-knowledge-portal
npm install
```

### 2. Configure secrets

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values (see [Secrets setup](#secrets-setup-local-development) below).

### 3. Run the web app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional: API + workers locally

The blog-fetch service lives in `fetch-blogs/` and runs separately via Docker Compose:

```bash
cd fetch-blogs
cp .env.example .env
docker compose up
```

See [`fetch-blogs/README.md`](fetch-blogs/README.md) for API env vars (`MONGO_URI`, `REDIS_URL`, `LLM_GEMINI_API_KEY`, etc.).

---

## Secrets setup (local development)

> **Never commit secrets.** `.env.local` and `fetch-blogs/.env` are gitignored. Do not paste real keys into PRs, wiki pages, or committed config files.

### Web app — `.env.local`

Copy from [`.env.example`](.env.example):

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (`https://xxx.supabase.co`) — safe for browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key — safe for browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (server) | Supabase service role key — **server-side only**, never expose to client |
| `GEMINI_API_KEY` | Yes (server) | Google Gemini API key for AI digest and quiz features |
| `APP_URL` | Yes | App base URL — `http://localhost:3000` for local dev |

**Where to get values**

- **Supabase:** Dashboard → your project → Settings → API
- **Gemini:** [AI Studio](https://aistudio.google.com/app/apikey)

**Supabase redirect URLs (local):** Authentication → URL Configuration → add `http://localhost:3000/auth/callback`.

### Production / AWS deploy secrets

Production secrets (Pulumi config, AWS Secrets Manager, ECS, Atlas, Upstash, etc.) are documented in:

**→ [infra/README.md](infra/README.md)**

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run production build locally |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `bash scripts/ci-test.sh` | Full local quality gate |

---

## Architecture

Three services in production: **web** (Next.js), **api** (FastAPI), **workers** (Celery). Auth and quiz data live in **Supabase Postgres**; scraped articles and job state live in **MongoDB Atlas**; Celery uses **external Redis**. No AWS RDS or DocumentDB.

```
Browser → Next.js (Supabase auth) → FastAPI / Celery → MongoDB + Redis + Gemini
```

Deeper docs:

- [`wiki/pages/architecture.md`](wiki/pages/architecture.md) — system design
- [`CLAUDE.md`](CLAUDE.md) — agent/coding harness and folder map
- [`prototype.config.yaml`](prototype.config.yaml) — service manifest for infra

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Application releases |
| `feat/infra` | Infrastructure (Pulumi), CI deploy workflows, secrets documentation |

Infra and deploy changes land on `feat/infra` until the production path is merged to `main`.

## License

Private — Creole Studios internal use.
