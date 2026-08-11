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

- Node.js 20+
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

Edit `.env.local` with your values (see table below). **Do not set `NEXT_PUBLIC_BASE_PATH` locally** — the app runs at `/` on port 3000.

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

## Secrets & environment

App secrets **do not** go in GitHub Actions secrets. Local values live in `.env.local`. Production values are set with `pulumi config set --secret`, stored in **AWS Secrets Manager**, and injected into ECS at runtime. Full commands: [`infra/README.md`](infra/README.md).

### Local (`.env.local`)

Copy from [`.env.example`](.env.example). Never commit `.env.local`.

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser + server | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only | Supabase service role — never expose to client |
| `GEMINI_API_KEY` | Yes | Server only | Google Gemini for digest + quiz AI |
| `APP_URL` | Yes | Server | Base URL — `http://localhost:3000` for local dev |
| `NEXT_PUBLIC_BASE_PATH` | No | Build | Leave unset locally. Production Docker/ECS sets `/creole-knowledge-portal` |

**Where to get values**

- **Supabase:** Dashboard → Settings → API
- **Gemini:** [AI Studio](https://aistudio.google.com/app/apikey)

**Supabase redirect URLs (local):** Authentication → URL Configuration → add `http://localhost:3000/auth/callback`.

### GitHub (Actions)

Deploy uses OIDC — **no AWS access keys** and **no app secrets** in GitHub. Set this as a repository **variable** (not a secret):

| Name | Type | Where | Purpose |
|------|------|-------|---------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | Repository **variable** (not secret) | Settings → Secrets and variables → Actions → **Variables** | OIDC role `arn:aws:iam::761341389675:role/ckp-github-deploy-dev` |

Setup steps: [`.github/OIDC-SETUP.md`](.github/OIDC-SETUP.md).

### AWS / Pulumi / ECS

Pulumi encrypted config → AWS Secrets Manager → ECS task `secrets`. Keys match [`infra/components/app-secrets.ts`](infra/components/app-secrets.ts).

| Pulumi config (`pulumi config set`) | `--secret` | ECS env var | Service(s) |
|-------------------------------------|------------|-------------|------------|
| `ckp:mongoUri` | yes | `MONGO_URI` | api, workers |
| `ckp:redisUrl` | optional | `REDIS_URL`, `REDIS_RESULT_URL`, `CELERY_BROKER_URL` | api, workers |
| `ckp:supabaseUrl` | no | `NEXT_PUBLIC_SUPABASE_URL` | web |
| `ckp:supabaseAnonKey` | yes | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web |
| `ckp:supabaseServiceRoleKey` | yes | `SUPABASE_SERVICE_ROLE_KEY` | web |
| `ckp:geminiApiKey` | yes | `GEMINI_API_KEY` | web |
| `ckp:llmGeminiApiKey` | yes | `LLM_GEMINI_API_KEY` | api, workers |

If `ckp:llmGeminiApiKey` is unset, the stack reuses `ckp:geminiApiKey` for the LLM secret.

**Docker build-args** (inlined into the Next.js client bundle — not only ECS runtime):

| Build-arg | Value |
|-----------|--------|
| `NEXT_PUBLIC_BASE_PATH` | `/creole-knowledge-portal` |
| `NEXT_PUBLIC_SUPABASE_URL` | same as `ckp:supabaseUrl` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as `ckp:supabaseAnonKey` |

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `MONGO_URI`, `REDIS_URL`, `LLM_GEMINI_API_KEY`) are **not** build-args — they are injected at ECS runtime via Secrets Manager.

Commands and Secrets Manager paths → [`infra/README.md`](infra/README.md#secrets-setup-start-here).

---

## Production Docker build

`NEXT_PUBLIC_*` variables are **inlined at build time** by Next.js. They must be passed as Docker build-args (not only at ECS runtime):

```bash
docker build \
  --build-arg NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t ckp-web .
```

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) are injected at **ECS runtime** via AWS Secrets Manager — see [`infra/README.md`](infra/README.md).

---

## ALB path prefix (`basePath`)

Production serves the web app under **`/creole-knowledge-portal`** (matches `ckp:appName` in Pulumi and [`prototype.config.yaml`](prototype.config.yaml)).

- Configured via `NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal` at Docker build time
- [`next.config.ts`](next.config.ts) reads `process.env.NEXT_PUBLIC_BASE_PATH`
- Local dev has no basePath — routes stay at `/`, `/dashboard`, etc.

---

## Dev-only mock auth bypass

For local testing without Supabase login, append `?mockUser=true` to any URL. This sets a `mock-user` cookie and uses a fixed demo identity.

**Disabled in production** (`NODE_ENV=production`) — enforced in [`middleware.ts`](middleware.ts), API routes, and [`lib/dev/mock-user.ts`](lib/dev/mock-user.ts).

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server on port 3000 |
| `npm run build` | Production build (needs Supabase/Gemini env vars) |
| `npm run start` | Run production build locally |
| `npm run lint` | ESLint (Next.js app only; excludes `infra/`, `fetch-blogs/`) |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `bash scripts/ci-test.sh` | Full local quality gate |

CI uses placeholder env vars — see [`.github/workflows/quality-gate.yml`](.github/workflows/quality-gate.yml).

---

## Architecture

Three services in production: **web** (Next.js), **api** (FastAPI), **workers** (Celery). Auth and quiz data live in **Supabase Postgres**; scraped articles and job state live in **MongoDB Atlas**; Celery uses **external Redis**. No AWS RDS or DocumentDB.

```
Browser → Next.js (Supabase auth) → FastAPI / Celery → MongoDB + Redis + Gemini
```

### Production URLs (current)

Same hostname, path-based routing — **not** `api.ckp.nikcreations.com`.

| URL | Service | Status |
|-----|---------|--------|
| [https://ckp.nikcreations.com/creole-knowledge-portal/](https://ckp.nikcreations.com/creole-knowledge-portal/) | Frontend (Next.js) | HTTPS on ALB (ACM) — **not CloudFront** |
| `https://ckp.nikcreations.com/creole-knowledge-portal/api/` | Python API (FastAPI) | **Not live** (`apiDesiredCount=0`) |

HTTP on the custom domain **301s to HTTPS**. There is no `api.ckp.nikcreations.com` and no CloudFront distribution.

Full deploy + secrets → **[infra/README.md](infra/README.md)**

Other docs:

- [`wiki/pages/architecture.md`](wiki/pages/architecture.md) — system design
- [`CLAUDE.md`](CLAUDE.md) — agent/coding harness and folder map
- [`prototype.config.yaml`](prototype.config.yaml) — service manifest for infra

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Application releases (includes Pulumi infra, deploy CI, and secrets docs) |

## License

Private — Creole Studios internal use.
