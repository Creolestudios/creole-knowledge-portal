# Creole Knowledge Portal

Internal office tool for **personalized morning tech blog recommendations** and a **daily AI digest**. Users sign in via Supabase (Magic Link + Google OAuth), set their tech interests, and receive curated content powered by the fetch-blogs pipeline and Google Gemini.

## Stack

| Layer | Technology |
|-------|------------|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Auth & Postgres | Supabase (Magic Link, Google OAuth, user profiles, quiz) |
| Blog pipeline | `fetch-blogs/` — Python, FastAPI, Celery, MongoDB, Redis |
| AI | Google Gemini |
| Production infra | AWS ECS Fargate — **Pulumi only** (no AWS CLI for resource creation) — default/dev task size **1024 CPU / 2 GB** — see [`infra/README.md`](infra/README.md) |

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

Deploy uses OIDC — **no AWS access keys** and **no app secrets** in GitHub. The only GitHub setting required for infra deploy is repository variable `AWS_GHA_DEPLOY_ROLE_ARN`. Full checklist (pending steps, post-deploy, Supabase URLs): **[GitHub CI/CD Setup](#github-cicd-setup)** below. OIDC details: [`.github/OIDC-SETUP.md`](.github/OIDC-SETUP.md).

### AWS / Pulumi / ECS

**Policy:** AWS CLI-created CKP infrastructure is invalid. Create and change AWS resources only with Pulumi (`infra/`). Read-only `aws` describe is fine for verification.

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

## GitHub CI/CD Setup

Use this checklist to finish production deploy automation and unblock auth + API. **App secrets never go in GitHub Actions** — they live in Pulumi encrypted config → AWS Secrets Manager → ECS. GitHub only needs the OIDC deploy role variable.

### Workflows

| Workflow | Trigger | Needs GitHub secrets? |
|----------|---------|------------------------|
| [quality-gate.yml](.github/workflows/quality-gate.yml) | PR + push to `main` | No — uses placeholder env vars for lint/test/build |
| [deploy-infra.yml](.github/workflows/deploy-infra.yml) | Push to `main` (`infra/**`), or manual **Run workflow** | No secrets — requires repository **variable** below |

Until the variable is set, **Deploy Infrastructure** prints a warning and skips Pulumi (see `oidc-not-configured` job in the workflow).

### 1. GitHub repository variable (required — pending)

In **Settings → Secrets and variables → Actions → Variables**, add:

| Name | Value |
|------|-------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | `arn:aws:iam::715736407442:role/ckp-github-deploy-dev` |

- [ ] Variable `AWS_GHA_DEPLOY_ROLE_ARN` set on `Creolestudios/creole-knowledge-portal`
- [ ] Push to `main` (or **Actions → Deploy Infrastructure → Run workflow** → `preview`, stack `dev`) — confirm job assumes the role in account `715736407442`

Optional: create GitHub **Environments** (`dev`, `prod`) with protection rules before allowing manual `pulumi up`.

### 2. AWS OIDC trust (already provisioned)

The GitHub OIDC provider and deploy role are **Pulumi-owned** in stack `dev` — do not recreate with the AWS CLI. Trust is scoped to this repo.

| Item | Value |
|------|-------|
| OIDC provider | `arn:aws:iam::715736407442:oidc-provider/token.actions.githubusercontent.com` |
| Deploy role | `ckp-github-deploy-dev` |
| AWS account / region | `715736407442` / `us-east-1` |

Details and verification steps: [`.github/OIDC-SETUP.md`](.github/OIDC-SETUP.md).

### 3. Pulumi backend (CI + local)

Both GitHub Actions and local deploys use the same S3 backend:

```
s3://pulumi-state-715736407442?region=us-east-1&awssdk=v2
```

- [ ] Local operators: `export AWS_PROFILE=cloud_user` and `pulumi login` to the URL above before `pulumi stack select dev` ([`infra/PULUMI-BACKEND.md`](infra/PULUMI-BACKEND.md))
- [ ] CI inherits backend from [deploy-infra.yml](.github/workflows/deploy-infra.yml) after OIDC auth — no extra GitHub config

**Do not commit plaintext secrets in `infra/Pulumi.dev.yaml`.** Sensitive keys must be set with `pulumi config set --secret` (encrypted in stack state). Never paste real API keys, passwords, or connection strings into git. A backup of the old account config may exist locally as `infra/Pulumi.dev.yaml.old-account.bak` — keep it untracked.

### 4. Where secrets live (not GitHub)

| Secret / config | Set in | In GitHub Actions? |
|-----------------|--------|--------------------|
| Supabase URL + keys | `pulumi config set [--secret] ckp:supabaseUrl` … | **No** |
| Gemini keys (web + fetch-blogs) | `ckp:geminiApiKey`, `ckp:llmGeminiApiKey` | **No** |
| MongoDB Atlas URI | `ckp:mongoUri` (secret) | **No** |
| Redis broker URL | `ckp:redisUrl` | **No** |
| Docker `NEXT_PUBLIC_*` build-args | Passed at `docker build` (match Pulumi Supabase values) | **No** |

Commands: [`infra/README.md` — Secrets setup](infra/README.md#secrets-setup-start-here).

### 5. Supabase redirect URLs (required for login — pending)

Configure in **Supabase Dashboard → Authentication → URL Configuration** (not in GitHub or Pulumi):

| Setting | Value |
|---------|-------|
| **Site URL** | `https://ckp.nikcreations.com/creole-knowledge-portal` |
| **Redirect URLs** | `https://ckp.nikcreations.com/creole-knowledge-portal/auth/callback` |
| | `http://ckp-shared-alb-889679340.us-east-1.elb.amazonaws.com/creole-knowledge-portal/auth/callback` (ALB debug) |
| | `http://localhost:3000/auth/callback` (local dev) |

- [ ] Production Site URL and callback added in Supabase
- [ ] Magic link / Google OAuth tested at [https://ckp.nikcreations.com/creole-knowledge-portal/](https://ckp.nikcreations.com/creole-knowledge-portal/)

### 6. External data stores (outside GitHub)

| Store | Pending / verify |
|-------|------------------|
| **MongoDB Atlas** | Cluster + DB user; `ckp:mongoUri` in Pulumi; Atlas **Network Access** allows ECS egress (NAT IP or `0.0.0.0/0` for dev) |
| **Redis** | External broker (e.g. Redis Cloud / Upstash); `ckp:redisUrl` in Pulumi |
| **Supabase** | Project keys in Pulumi; redirect URLs above |

### 7. Post-deploy: images, scale-up, health checks (pending for API/workers)

Web is live; **API and Celery workers are scaled to zero** until images exist and secrets are confirmed.

```bash
export AWS_PROFILE=cloud_user
cd infra && pulumi stack select dev

# ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 715736407442.dkr.ecr.us-east-1.amazonaws.com

WEB_REPO=$(pulumi stack output webRepositoryUrl)
API_REPO=$(pulumi stack output apiRepositoryUrl)
WORKERS_REPO=$(pulumi stack output workersRepositoryUrl)
```

- [ ] **Web image** — already pushed (`creole-knowledge-portal-web:latest`); rebuild when `NEXT_PUBLIC_*` change (build-args, not runtime-only)
- [ ] **API + workers images** — build from `fetch-blogs/` with `--platform linux/amd64`, push to `${API_REPO}` and `${WORKERS_REPO}` (repos may be empty)
- [ ] Set image tags: `pulumi config set ckp:apiImage …`, `ckp:workersImage …`, `ckp:webImage …`
- [ ] Scale up: `pulumi config set ckp:apiDesiredCount 1` and `ckp:workersDesiredCount 1`, then `pulumi up` (or use **Deploy Infrastructure** → `up`)
- [ ] **Health checks:**
  - Web: `https://ckp.nikcreations.com/creole-knowledge-portal/` → **200**
  - API: `https://ckp.nikcreations.com/creole-knowledge-portal/api/v1/health` → **200** (currently **503** while `apiDesiredCount=0`)
- [ ] Confirm ECS services register healthy targets on the ALB

Full build/push commands: [`infra/README.md` — Deploy flow](infra/README.md#deploy-flow).

### 8. Repo sync (team)

If your local `main` predates the Aug 2026 history rewrite, re-sync before pushing — see [`TEAM-RESYNC-INSTRUCTIONS.md`](TEAM-RESYNC-INSTRUCTIONS.md). Infra account migration edits (`Dockerfile`, `infra/Pulumi.yaml`, `infra/Pulumi.dev.yaml`, deploy workflow) should land on `main` via PR once reviewed — **without** plaintext secrets in commits.

### Quick reference

| What | Where |
|------|-------|
| OIDC + GitHub variable | [`.github/OIDC-SETUP.md`](.github/OIDC-SETUP.md) |
| Pulumi secrets + deploy flow | [`infra/README.md`](infra/README.md) |
| Pulumi S3 backend | [`infra/PULUMI-BACKEND.md`](infra/PULUMI-BACKEND.md) |
| Deploy log / status | [`wiki/logs/2026-08-22.md`](wiki/logs/2026-08-22.md) |

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

Full deploy + secrets → **[infra/README.md](infra/README.md)**. Platform resources (ALB, cluster, OIDC) live in [`infra/components/platform.ts`](infra/components/platform.ts) and were imported from a one-time CLI bootstrap. The only remaining CLI leftover is the Pulumi S3 state bucket (chicken-and-egg backend).

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
