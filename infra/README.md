# Creole Knowledge Portal — Infrastructure & Secrets

Pulumi stack for deploying CKP to **AWS ECS Fargate**. **AWS CLI-created infrastructure is invalid** — create and change AWS resources only with Pulumi. Former CLI bootstrap (ALB, cluster, HTTP listener, OIDC, deploy role) was **imported** into this stack. External data stores only — no RDS, DocumentDB, or ElastiCache.

## Overview

| Decision | Detail |
|----------|--------|
| **Pattern** | Single Pulumi stack owns platform + app; **data stores are external** |
| **Compute** | ECS Fargate: Next.js web (:3000), FastAPI api (:8000), Celery workers — **1024 CPU / 2 GB** (valid Fargate pair) |
| **Postgres / Auth** | [Supabase](https://supabase.com) |
| **MongoDB** | [MongoDB Atlas](https://www.mongodb.com/atlas) |
| **Redis** | External (Upstash, Redis Cloud, etc.) — Celery broker + result backend |
| **Secrets** | Pulumi encrypted config → AWS Secrets Manager → ECS task `secrets` |

| Item | Value |
|------|-------|
| AWS profile | `cloud_user` |
| AWS account | `715736407442` |
| Region | `us-east-1` |
| Pulumi backend | `s3://pulumi-state-715736407442?region=us-east-1&awssdk=v2` |
| Stack | `dev` (project `creole-knowledge-portal`) |

See also: [`PULUMI-BACKEND.md`](./PULUMI-BACKEND.md), [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md), [`prototype.config.yaml`](../prototype.config.yaml).

---

## Ownership policy (no AWS CLI)

Do **not** use the AWS CLI (or console) to create CKP resources. Extend [`components/platform.ts`](./components/platform.ts) or `index.ts` and run `pulumi up`. Read-only `aws … describe` is OK for verification.

### Imported into stack `dev` (was CLI bootstrap)

| Pulumi name | AWS type | Imported ID |
|-------------|----------|-------------|
| `ckp-shared-alb-sg` | Security group | `sg-04f7dda0f8d56fadd` |
| `ckp-shared-alb` | ALB | `arn:…:loadbalancer/app/ckp-shared-alb/9d5d020a6e55f819` |
| `ckp-shared-http-listener` | HTTP :80 listener | `arn:…/listener/…/18c48acf310a9913` |
| `ckp-shared-cluster` | ECS cluster `ckp-shared` | cluster name / ARN |
| `ckp-github-oidc` | GitHub OIDC provider | `arn:aws:iam::715736407442:oidc-provider/token.actions.githubusercontent.com` |
| `ckp-github-deploy-role` | IAM role | `ckp-github-deploy-dev` |
| `ckp-github-deploy-policy` | Inline policy | `ckp-github-deploy-dev:ckp-pulumi-deploy` |

These resources are **protected** in Pulumi (`protect: true`) and tagged `ManagedBy=Pulumi`. OIDC thumbprint is `6938fd4d98bab03fa0217a5d6397dd4a4f5e5e5e`.

### Still not Pulumi-created (by design)

| Resource | Why |
|----------|-----|
| AWS default VPC + subnets | AWS-owned; looked up (`aws.ec2.getVpc`) |
| S3 `pulumi-state-715736407442` | Pulumi backend — chicken-and-egg. **Only allowed CLI leftover.** Do not recreate unless the bucket is gone. See [`PULUMI-BACKEND.md`](./PULUMI-BACKEND.md). |
| KMS alias `ckp-pulumi-secrets` | Secrets provider for stack config (same bootstrap class as the state bucket) |
| Supabase / Atlas / Redis | External SaaS |

---

## GitHub Actions variable (required for CI deploy)

App secrets **do not** go in GitHub. The only GitHub setting for deploy is a repository **variable** (Settings → Secrets and variables → Actions → **Variables**):

| Name | Type | Value | Purpose |
|------|------|-------|---------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | Repository **variable** (not a secret) | `arn:aws:iam::715736407442:role/ckp-github-deploy-dev` | OIDC role assumed by [deploy-infra.yml](../.github/workflows/deploy-infra.yml) |

No `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Full OIDC steps: [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md).

---

## Secrets setup (start here)

### Rules

- **Never** commit real secrets to git.
- **Never** put app secrets (`GEMINI_API_KEY`, Supabase keys, Mongo/Redis URIs) in GitHub Actions secrets.
- Use `pulumi config set --secret` for sensitive values — encrypted in stack state.
- Pulumi creates **AWS Secrets Manager** resources ([`components/app-secrets.ts`](./components/app-secrets.ts)) and ECS tasks reference them by ARN.
- If a Pulumi secret is not set, the stack falls back to plain env placeholders from [`components/data-stores.ts`](./components/data-stores.ts) (mongo/redis only).

### Pulumi config keys → ECS env vars

| Pulumi config key | Secrets Manager path | ECS env var | Service(s) |
|-------------------|---------------------|-------------|------------|
| `ckp:supabaseUrl` | `{appName}/{env}/supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` | web |
| `ckp:supabaseAnonKey` *(secret)* | `{appName}/{env}/supabase-anon-key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web |
| `ckp:supabaseServiceRoleKey` *(secret)* | `{appName}/{env}/supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | web |
| `ckp:geminiApiKey` *(secret)* | `{appName}/{env}/gemini-api-key` | `GEMINI_API_KEY` | web |
| `ckp:llmGeminiApiKey` *(secret)* | `{appName}/{env}/llm-gemini-api-key` | `LLM_GEMINI_API_KEY` | api, workers |
| `ckp:mongoUri` *(secret)* | `{appName}/{env}/mongo-uri` | `MONGO_URI` | api, workers |
| `ckp:redisUrl` | `{appName}/{env}/redis-url` | `REDIS_URL`, `REDIS_RESULT_URL`, `CELERY_BROKER_URL` | api, workers |

`{appName}` defaults to `creole-knowledge-portal`; `{env}` is the stack name (e.g. `dev`).

If `ckp:llmGeminiApiKey` is unset, the stack reuses `ckp:geminiApiKey` for the LLM secret.

### Non-secret runtime config

| Source | ECS env var | Service |
|--------|-------------|---------|
| Pulumi / ALB DNS | `NEXT_PUBLIC_API_URL` | web |
| Pulumi / ALB DNS | `BLOG_SERVICE_URL` (`…/api/v1`) | web — server-side fetch to FastAPI |
| Pulumi / domain | `APP_CORS_ORIGINS` | api — browser CORS (includes `https://ckp.nikcreations.com`) |
| `ckp:appName` | `NEXT_PUBLIC_BASE_PATH` | web |
| Static | `NODE_ENV`, `PORT`, `HOSTNAME` | web, api |

> **Build-time vs runtime:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also required as **Docker build-args** (inlined into the client bundle). ECS runtime secrets cover server-side middleware and SSR. See root [README](../README.md#production-docker-build).

### Set secrets (deploy machine or CI)

```bash
export AWS_PROFILE=cloud_user
cd infra && pulumi stack select dev

# MongoDB Atlas — required for api + workers
pulumi config set --secret ckp:mongoUri 'mongodb+srv://USER:PASSWORD@cluster.mongodb.net/ckp?retryWrites=true&w=majority'

# External Redis — required for api + workers
pulumi config set ckp:redisUrl 'rediss://default:YOUR_TOKEN@your-redis.upstash.io:6379/0'

# Supabase — required for web auth in production
pulumi config set ckp:supabaseUrl 'https://your-project-id.supabase.co'
pulumi config set --secret ckp:supabaseAnonKey 'your-anon-key'
pulumi config set --secret ckp:supabaseServiceRoleKey 'your-service-role-key'

# Gemini — web uses GEMINI_API_KEY; fetch-blogs uses LLM_GEMINI_API_KEY
pulumi config set --secret ckp:geminiApiKey 'your-gemini-api-key'
pulumi config set --secret ckp:llmGeminiApiKey 'your-gemini-api-key'   # optional if same key
```

Verify:

```bash
pulumi config   # sensitive values show [secret]
pulumi preview  # creates/updates Secrets Manager + ECS task definitions
```

---

## Service scaling guidance

| Config key | Default (`Pulumi.example.yaml`) | Notes |
|------------|--------------------------------|-------|
| `ckp:webDesiredCount` | `1` | Web UI — scale after image + Supabase secrets are set |
| `ckp:apiDesiredCount` | `1` | FastAPI — set to `0` in dev until `mongoUri` + `redisUrl` are real |
| `ckp:workersDesiredCount` | `1` | Celery — set to `0` until Redis + Mongo are reachable |
| `ckp:ecsDesiredCount` | `1` | Fallback when per-service counts are omitted |
| `ckp:ecsCpu` | `1024` | Fargate CPU units (1 vCPU). Must be a valid pair with `ecsMemory` |
| `ckp:ecsMemory` | `2048` | Fargate memory (MiB) — **2 GB**. Pair with `ecsCpu: 1024` (not 256/2048) |

Default and **dev** task size is **1024 CPU / 2 GB**. Current dev stack (`Pulumi.dev.yaml`) may keep `apiDesiredCount: 0` and `workersDesiredCount: 0` until external stores are configured.

---

## ALB routing & custom domain

| Route | ALB path pattern | Container health check |
|-------|------------------|------------------------|
| Web | `/creole-knowledge-portal`, `/creole-knowledge-portal/*` | `/creole-knowledge-portal` |
| API | `/creole-knowledge-portal/api/*` | `/api/v1/health` (direct to container) |

| URL | Purpose | Status |
|-----|---------|--------|
| `https://ckp.nikcreations.com/creole-knowledge-portal/` | Web app | HTTPS on shared ALB (ACM) |
| `https://ckp.nikcreations.com/creole-knowledge-portal/api/v1/health` | API health | Not live until `apiDesiredCount=1` |
| `http://ckp.nikcreations.com/...` | HTTP custom domain | **301 → HTTPS** (host-header rule) |
| `http://ckp-shared-alb-495275305.us-east-1.elb.amazonaws.com/creole-knowledge-portal/` | ALB DNS (debug) | HTTP only — no redirect |

**Not using CloudFront.** TLS terminates on the ALB. There is no `api.ckp.nikcreations.com`.

`NEXT_PUBLIC_API_URL` is `https://ckp.nikcreations.com/creole-knowledge-portal` (clients append `/api/v1/...`).

### DNS (already delegated)

Hosted zone `ckp.nikcreations.com` (Route53 `Z08236051M6RDZHQDVAUN`). NS at the parent `nikcreations.com` (Cloudflare):

1. `ns-1277.awsdns-31.org`
2. `ns-1670.awsdns-16.co.uk`
3. `ns-423.awsdns-52.com`
4. `ns-525.awsdns-01.net`

### HTTPS (ALB + ACM, no CloudFront)

Pulumi creates:

1. ACM certificate for `ckp.nikcreations.com` (DNS validation in this Route53 zone)
2. ALB HTTPS listener `:443` with the same path rules as HTTP
3. HTTP → HTTPS redirect when `Host` is `ckp.nikcreations.com`

CloudFront / WAF is **not** in this stack (TGN TotalMed used it optionally). Add later if you need CDN or edge WAF.

### Supabase redirect URLs

In **Supabase Dashboard → Authentication → URL Configuration**:

| Setting | Value |
|---------|-------|
| **Site URL** | `https://ckp.nikcreations.com/creole-knowledge-portal` |
| **Redirect URLs** | `https://ckp.nikcreations.com/creole-knowledge-portal/auth/callback` |
| | `http://ckp-shared-alb-495275305.us-east-1.elb.amazonaws.com/creole-knowledge-portal/auth/callback` |
| | `http://localhost:3000/auth/callback` (local dev, no basePath) |

---

## Deploy flow

### 1. Apply the Pulumi stack

```bash
export AWS_PROFILE=cloud_user
cd infra
npm install
pulumi stack select dev
pulumi preview
pulumi up
```

Owns: shared ALB + SG + listeners, ECS cluster, GitHub OIDC + deploy role, ECR, Secrets Manager (when config is set), Fargate SGs, ALB rules, ECS services, CloudWatch logs, ACM, Route53 zone. Platform resources are imported and protected — `pulumi up` must not replace the ALB or cluster.

### 2. Build and push Docker images

```bash
# Authenticate
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 715736407442.dkr.ecr.us-east-1.amazonaws.com

WEB_REPO=$(pulumi stack output webRepositoryUrl)
API_REPO=$(pulumi stack output apiRepositoryUrl)
WORKERS_REPO=$(pulumi stack output workersRepositoryUrl)

# Web — repo root; NEXT_PUBLIC_* must be build-args
docker build \
  --build-arg NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t ckp-web .
docker tag ckp-web:latest ${WEB_REPO}:v1
docker push ${WEB_REPO}:v1

# API + workers — fetch-blogs/ (same image, different ECS command for workers)
# Fargate is linux/amd64 — required on Apple Silicon
docker build --platform linux/amd64 -t ckp-api ./fetch-blogs
docker tag ckp-api:latest ${API_REPO}:latest
docker push ${API_REPO}:latest
docker tag ckp-api:latest ${WORKERS_REPO}:latest
docker push ${WORKERS_REPO}:latest
```

### 3. Point ECS at new images

```bash
pulumi config set ckp:webImage ${WEB_REPO}:v1
pulumi config set ckp:apiImage ${API_REPO}:v1
pulumi config set ckp:workersImage ${WORKERS_REPO}:v1
pulumi config set ckp:apiDesiredCount 1
pulumi config set ckp:workersDesiredCount 1
pulumi up
```

### 4. DNS delegation

After `pulumi up`, add NS records at `nikcreations.com` using stack output `route53NameServers` (already done for `ckp`). HTTPS is provisioned by this stack (ACM + ALB :443).

---

## Manual setup checklist

These are **outside** this Pulumi stack:

| Task | Where |
|------|-------|
| MongoDB Atlas cluster + IP allowlist (NAT gateway IPs) | [Atlas](https://cloud.mongodb.com) |
| Upstash / Redis Cloud instance + TLS URL | Provider dashboard |
| Supabase project + redirect URLs | [Supabase dashboard](https://app.supabase.com) |
| GitHub OIDC deploy role | Set repo variable `AWS_GHA_DEPLOY_ROLE_ARN` — see [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md) |
| Shared VPC / ALB / ECS cluster | Default VPC looked up; ALB + cluster owned by this stack (`components/platform.ts`) — imported, not CLI |

---

## CI / GitHub Actions

**Required variable** (see [GitHub Actions variable](#github-actions-variable-required-for-ci-deploy) above): `AWS_GHA_DEPLOY_ROLE_ARN`.

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| [quality-gate.yml](../.github/workflows/quality-gate.yml) | PR + push to `main` | Lint, test, build (Next.js + fetch-blogs + infra typecheck) |
| [deploy-infra.yml](../.github/workflows/deploy-infra.yml) | `workflow_dispatch`, push to `main` | Pulumi preview/up via OIDC |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `https://ckp.nikcreations.com` connection refused | Cert or :443 listener not ready | Wait for ACM validation; `pulumi up`; confirm SG allows 443 |
| Web 404 at ALB root | basePath | Use `/creole-knowledge-portal/` not `/` |
| API 404 via ALB | Path prefix mismatch | Hit `/creole-knowledge-portal/api/v1/health` |
| ECS task fails to start | Missing Secrets Manager permission | Re-run `pulumi up` (execution role policy) |
| api/workers crash | Placeholder mongo/redis | Set real `ckp:mongoUri` and `ckp:redisUrl` |
| Mongo timeout | Atlas IP allowlist | Add VPC NAT gateway IP |
| Login redirect fails | Supabase URLs | Include basePath in callback URL |
| GHA deploy skipped | Missing OIDC var | Set `AWS_GHA_DEPLOY_ROLE_ARN` |

---

## What this stack creates / does not create

**Creates / owns (Pulumi):** default-VPC lookup, ALB + SG, HTTP/HTTPS listeners, ECS cluster, GitHub OIDC + deploy role, ECR, Secrets Manager (when config set), Fargate SGs, target groups + rules, ECS services, ACM cert, CloudWatch logs, Route53 zone.

**Does not create:** AWS default VPC/subnets (looked up), Pulumi S3 state bucket (only allowed CLI leftover), Supabase, Atlas, Redis, RDS, DocumentDB, ElastiCache.

**Do not use AWS CLI to add more CKP infra** — extend [`components/platform.ts`](./components/platform.ts) or `index.ts` and `pulumi up`.

**Placeholder modules:** [`components/data-stores.ts`](./components/data-stores.ts) retains SGs for future in-VPC stores; production uses external Atlas + Redis only.

---

## Local development

Infra is deploy-only. Local dev does not require Pulumi:

- **Web:** `npm run dev` — see [root README](../README.md)
- **API + workers:** `fetch-blogs/docker-compose.yml`
