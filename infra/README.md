# Creole Knowledge Portal — Infrastructure & Secrets

Pulumi stack for deploying CKP to **AWS ECS Fargate** on the TGN **Option 3** pattern (shared VPC + ALB). This guide is written for someone new to the project.

## Overview

| Decision | Detail |
|----------|--------|
| **Pattern** | Option 3 — compute in shared VPC; **data stores are external** |
| **Compute** | ECS Fargate: Next.js web (:3000), FastAPI api (:8000), Celery workers |
| **Postgres / Auth** | [Supabase](https://supabase.com) — auth, user profiles, quiz data |
| **MongoDB** | [MongoDB Atlas](https://www.mongodb.com/atlas) — fetch-blogs article store, job state |
| **Redis** | External provider (Upstash, Redis Cloud, etc.) — Celery broker + result backend |
| **NOT used** | AWS RDS, DocumentDB, ElastiCache — no AWS-managed databases in this stack |

Secrets are **never committed**. Pulumi stores encrypted config in stack state; production values flow through **AWS Secrets Manager** (created/managed by Pulumi) and into ECS task definitions at deploy time.

| Item | Value |
|------|-------|
| AWS profile | `cloud_user` |
| AWS account | `761341389675` |
| Region | `us-east-1` |
| Pulumi backend | `s3://pulumi-state-761341389675?region=us-east-1&awssdk=v2` |
| Stack | `dev` (project `creole-knowledge-portal`) |

See also: [`PULUMI-BACKEND.md`](./PULUMI-BACKEND.md), [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md), repo-root [`prototype.config.yaml`](../prototype.config.yaml).

## Architecture

```mermaid
flowchart TB
  subgraph AWS["AWS (this stack)"]
    ALB["Shared ALB"]
    Web["ECS: Next.js web"]
    API["ECS: FastAPI api"]
    Workers["ECS: Celery workers"]
    SM["Secrets Manager"]
    ECR["ECR repos"]
  end
  subgraph External["External data stores"]
    Supa["Supabase Postgres + Auth"]
    Atlas["MongoDB Atlas"]
    Redis["Redis (Upstash / etc.)"]
  end
  ALB --> Web
  ALB --> API
  SM --> Web
  SM --> API
  SM --> Workers
  Web --> Supa
  API --> Supa
  API --> Atlas
  API --> Redis
  Workers --> Atlas
  Workers --> Redis
```

## Prerequisites

Before your first deploy, ensure you have:

1. **AWS CLI** configured with profile `cloud_user` (account `761341389675`).
2. **Pulumi CLI** (`pulumi`) and **Node.js 20+**.
3. **Shared platform IDs** from your platform team: VPC, private subnets, shared ALB listener ARN, ECS cluster ARN (see [Network config](#network-config-non-secret) below).
4. **Supabase project** — URL, anon key, service role key ([Supabase dashboard](https://app.supabase.com) → Settings → API).
5. **MongoDB Atlas cluster** — connection string with database user ([Atlas](https://cloud.mongodb.com)).
6. **Redis instance** — broker URL from Upstash, Redis Cloud, or similar.
7. **Google Gemini API key** — [AI Studio](https://aistudio.google.com/app/apikey) (used by Next.js and fetch-blogs).

Log in to the Pulumi backend:

```bash
export AWS_PROFILE=cloud_user
export AWS_REGION=us-east-1
pulumi login 's3://pulumi-state-761341389675?region=us-east-1&awssdk=v2'
cd infra
npm install
pulumi stack select --create dev
```

---

## Secrets setup (start here)

This is the main onboarding path for new team members.

### Rules

- **Never** commit real secrets to git (`.env.local`, `Pulumi.*.yaml` with plaintext secrets, etc.).
- Use `pulumi config set --secret` for all sensitive Pulumi keys — values are encrypted in stack state.
- For production ECS, secrets are stored in **AWS Secrets Manager** and referenced by ARN in task definitions (not baked into Docker images).
- Local development uses `.env.local` (web) and `fetch-blogs/.env` — see [root README](../README.md#secrets-setup-local-development).

### All secrets and config keys

| Pulumi config key | ECS / runtime env var | Used by | Where to get it | Status in stack |
|-------------------|----------------------|---------|-----------------|-----------------|
| `ckp:mongoUri` | `MONGO_URI` | api, workers | MongoDB Atlas → Connect → connection string | **Wired** — passed to task env from config |
| `ckp:redisUrl` | `REDIS_URL`, `REDIS_RESULT_URL`, `CELERY_BROKER_URL` | api, workers | Upstash / Redis Cloud dashboard | **Wired** — passed to task env from config |
| `ckp:supabaseUrl` | `NEXT_PUBLIC_SUPABASE_URL` | web | Supabase → Settings → API → Project URL | Planned — Secrets Manager |
| `ckp:supabaseAnonKey` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase → Settings → API → anon public key | Planned — Secrets Manager |
| `ckp:supabaseServiceRoleKey` | `SUPABASE_SERVICE_ROLE_KEY` | web (server routes) | Supabase → Settings → API → service_role key | Planned — Secrets Manager |
| `ckp:geminiApiKey` | `GEMINI_API_KEY` | web | Google AI Studio API key | Planned — Secrets Manager |
| `ckp:llmGeminiApiKey` | `LLM_GEMINI_API_KEY` | api, workers | Same Gemini key (fetch-blogs uses `LLM_` prefix) | Planned — Secrets Manager |

Non-secret runtime config (computed or plain config):

| Source | ECS env var | Used by |
|--------|-------------|---------|
| Pulumi output / ALB DNS | `NEXT_PUBLIC_API_URL` | web |
| `ckp:domainName` | (Route53 + Supabase redirect URLs) | dns, auth |

### Step 1 — Set Pulumi secrets (deploy machine or CI)

Run from `infra/` with stack `dev` selected:

```bash
export AWS_PROFILE=cloud_user
pulumi stack select dev

# MongoDB Atlas — REQUIRED today (api + workers won't connect without it)
pulumi config set --secret ckp:mongoUri 'mongodb+srv://USER:PASSWORD@cluster.mongodb.net/ckp?retryWrites=true&w=majority'

# External Redis — REQUIRED today
pulumi config set ckp:redisUrl 'rediss://default:YOUR_TOKEN@your-redis.upstash.io:6379/0'

# Supabase — set before web service can authenticate in production
pulumi config set ckp:supabaseUrl 'https://your-project-id.supabase.co'
pulumi config set --secret ckp:supabaseAnonKey 'your-anon-key'
pulumi config set --secret ckp:supabaseServiceRoleKey 'your-service-role-key'

# Gemini — web uses GEMINI_API_KEY; fetch-blogs uses LLM_GEMINI_API_KEY
pulumi config set --secret ckp:geminiApiKey 'your-gemini-api-key'
pulumi config set --secret ckp:llmGeminiApiKey 'your-gemini-api-key'
```

Verify encrypted values are stored (shows `[secret]`):

```bash
pulumi config
```

Copy [`Pulumi.example.yaml`](./Pulumi.example.yaml) for non-secret keys; never paste real secrets into committed YAML — use the commands above instead.

### Step 2 — AWS Secrets Manager flow

**Target pattern** (full wiring in progress):

1. **Pulumi creates** `aws.secretsmanager.Secret` resources per app secret (e.g. `ckp/dev/supabase-service-role`).
2. **Secret values** are populated from `pulumi config set --secret` at deploy time — not checked into git.
3. **ECS task definitions** reference secrets via `secrets` (not plain `environment`):

   ```json
   {
     "name": "SUPABASE_SERVICE_ROLE_KEY",
     "valueFrom": "arn:aws:secretsmanager:us-east-1:761341389675:secret:ckp/dev/supabase-service-role:SUPABASE_SERVICE_ROLE_KEY::"
   }
   ```

4. **Execution role** needs `secretsmanager:GetSecretValue` on those ARNs.

**Current state:** `MONGO_URI` and Redis URLs are injected from Pulumi config directly into api/workers task definitions ([`index.ts`](./index.ts)). Supabase and Gemini keys are **not yet** in ECS — set Pulumi secrets now so they are ready when Secrets Manager wiring lands.

### Step 3 — GitHub Actions variables

Deploy workflows use **OIDC** (no long-lived AWS access keys). Full setup: [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md).

| GitHub setting | Type | Value / purpose |
|----------------|------|-----------------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | **Repository variable** | IAM role ARN, e.g. `arn:aws:iam::761341389675:role/ckp-github-deploy-dev` |

Optional: GitHub **Environments** (`dev`, `prod`) with approval gates before `pulumi up`.

The deploy workflow ([`.github/workflows/deploy-infra.yml`](../.github/workflows/deploy-infra.yml)) skips Pulumi jobs until `AWS_GHA_DEPLOY_ROLE_ARN` is set.

### Step 4 — Local dev vs production

| Environment | Where secrets live | Files |
|-------------|-------------------|-------|
| **Local (web)** | Developer machine | `.env.local` (gitignored) — copy from [`.env.example`](../.env.example) |
| **Local (api/workers)** | Developer machine | `fetch-blogs/.env` — copy from [`fetch-blogs/.env.example`](../fetch-blogs/.env.example) |
| **Production (ECS)** | AWS Secrets Manager + Pulumi encrypted config | Never in repo or Docker layers |

---

## MongoDB Atlas setup

1. Create a cluster in Atlas (M10+ recommended for production; free tier OK for dev).
2. **Database user** — create a user with `readWrite` on the `ckp` database (or your chosen DB name).
3. **Network access** — ECS tasks run in private subnets with outbound NAT. Either:
   - Add the **NAT gateway elastic IP(s)** for your VPC to Atlas IP Access List, or
   - Use **Atlas Private Endpoint / VPC peering** for production, or
   - Temporarily allow `0.0.0.0/0` for dev only (Atlas still requires username/password).
4. **Connection string format:**

   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ckp?retryWrites=true&w=majority
   ```

5. Set in Pulumi:

   ```bash
   pulumi config set --secret ckp:mongoUri 'mongodb+srv://...'
   ```

Local fetch-blogs uses `MONGO_URI=mongodb://localhost:27017` via docker-compose.

---

## External Redis setup

Use any managed Redis with TLS support (recommended: **Upstash** or **Redis Cloud**).

- **Broker:** database `0` → `REDIS_URL` / `CELERY_BROKER_URL`
- **Results:** database `1` → `REDIS_RESULT_URL` (can use same host, different DB index)

Example Upstash URL:

```
rediss://default:YOUR_TOKEN@your-endpoint.upstash.io:6379/0
```

Set in Pulumi:

```bash
pulumi config set ckp:redisUrl 'rediss://default:YOUR_TOKEN@your-endpoint.upstash.io:6379/0'
```

> **Note:** Current ECS task definitions use one URL for both broker and result backend. Use separate DB indexes on the same instance, or extend the stack to support `ckp:redisResultUrl`.

---

## Supabase redirect URLs (production)

Default production domain from Pulumi: `ckp.nikcreations.com` (override with `ckp:domainName`).

In **Supabase Dashboard → Authentication → URL Configuration**:

| Setting | Value |
|---------|-------|
| **Site URL** | `https://ckp.nikcreations.com` |
| **Redirect URLs** | `https://ckp.nikcreations.com/auth/callback` |
| | `http://localhost:3000/auth/callback` (local dev) |

Google OAuth (if enabled) must also list the production callback URL in Google Cloud Console.

Auth callback handler: [`app/auth/callback/route.ts`](../app/auth/callback/route.ts).

---

## Network config (non-secret)

Required shared-platform keys (from your VPC/ALB operator):

```bash
pulumi config set ckp:environment dev
pulumi config set ckp:appName creole-knowledge-portal
pulumi config set ckp:sharedVpcId vpc-xxxxxxxx
pulumi config set --path 'ckp:sharedPrivateSubnetIds[0]' subnet-xxxxxxxx
pulumi config set --path 'ckp:sharedPrivateSubnetIds[1]' subnet-yyyyyyyy
pulumi config set ckp:sharedVpcCidrBlock 10.0.0.0/16
pulumi config set ckp:sharedAlbListenerArn arn:aws:elasticloadbalancing:...
pulumi config set ckp:sharedAlbSecurityGroupId sg-xxxxxxxx
pulumi config set ckp:sharedAlbDnsName shared-alb-xxxxx.us-east-1.elb.amazonaws.com
pulumi config set ckp:sharedEcsClusterArn arn:aws:ecs:us-east-1:761341389675:cluster/...
pulumi config set ckp:sharedEcsClusterName shared-cluster
pulumi config set ckp:listenerPriorityBase 1100
pulumi config set ckp:domainName ckp.nikcreations.com
```

---

## Deploy flow

### 1. Bootstrap infrastructure

```bash
export AWS_PROFILE=cloud_user
cd infra
pulumi preview
pulumi up
```

Creates: ECR repos, security groups, ALB target groups + listener rules, ECS services, CloudWatch logs, Route53 hosted zone.

### 2. Build and push Docker images

Use ECR URLs from stack outputs:

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 761341389675.dkr.ecr.us-east-1.amazonaws.com

# Web (repo root)
docker build -t ckp-web .
docker tag ckp-web:latest <webRepositoryUrl>:v1
docker push <webRepositoryUrl>:v1

# API + workers (fetch-blogs/)
docker build -t ckp-api ./fetch-blogs
docker tag ckp-api:latest <apiRepositoryUrl>:v1
docker push <apiRepositoryUrl>:v1

docker tag ckp-api:latest <workersRepositoryUrl>:v1
docker push <workersRepositoryUrl>:v1
```

### 3. Point ECS at new images

```bash
pulumi config set ckp:webImage <webRepositoryUrl>:v1
pulumi config set ckp:apiImage <apiRepositoryUrl>:v1
pulumi config set ckp:workersImage <workersRepositoryUrl>:v1
pulumi up
```

### 4. DNS delegation

After `pulumi up`, note the stack output `route53NameServers`. Add NS records at the parent domain (`nikcreations.com`) to delegate `ckp.nikcreations.com` to Route53.

### 5. Verify health

| Service | URL |
|---------|-----|
| Web | `http://<alb-dns>/creole-knowledge-portal/` |
| API | `http://<alb-dns>/creole-knowledge-portal/api/api/v1/health` |
| Production (after DNS) | `https://ckp.nikcreations.com/` |

### 6. Teardown (ephemeral sandbox)

```bash
pulumi destroy
```

---

## CI / GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| [quality-gate.yml](../.github/workflows/quality-gate.yml) | PR + push to `main`, `feat/infra` | Lint, test, build (Next.js + fetch-blogs + infra typecheck) |
| [deploy-infra.yml](../.github/workflows/deploy-infra.yml) | `workflow_dispatch`, push to `feat/infra` | Pulumi preview/up via OIDC |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pulumi preview` fails on missing config | Shared VPC keys not set | Complete [Network config](#network-config-non-secret) |
| API/workers crash on startup | Missing `mongoUri` or `redisUrl` | `pulumi config set --secret ckp:mongoUri '...'` and `pulumi config set ckp:redisUrl '...'` |
| Mongo connection timeout from ECS | Atlas IP allowlist | Add NAT gateway IP or enable VPC peering |
| Web login redirect fails | Supabase redirect URLs | Add production callback URL in Supabase dashboard |
| `AccessDenied` on `pulumi up` in GHA | OIDC role or trust policy | See [OIDC-SETUP.md](../.github/OIDC-SETUP.md) |
| Deploy workflow skipped | Missing `AWS_GHA_DEPLOY_ROLE_ARN` | Set repo variable in GitHub Settings |
| Wrong AWS account | Profile mismatch | `export AWS_PROFILE=cloud_user` and verify with `aws sts get-caller-identity` |
| Secrets visible in git | Accidental commit | Rotate compromised secrets; use `pulumi config set --secret` only |

---

## What this stack creates / does not create

**Creates:** ECR (`ckp-web`, `ckp-api`, `ckp-workers`), Fargate security groups, ALB target groups + rules, ECS services, CloudWatch log group, Route53 zone.

**Does not create:** VPC, subnets, ECS cluster, shared ALB, Supabase project, Atlas cluster, Redis instance, RDS, DocumentDB, ElastiCache.

**Placeholder modules:** [`components/data-stores.ts`](./components/data-stores.ts) retains security groups from the Option 3 template; ElastiCache/DocumentDB provisioning is intentionally **not** used — external providers only.

---

## Local development

Infra is deploy-only. Local dev does not require Pulumi:

- **Web:** `npm run dev` (see [root README](../README.md))
- **API + workers:** `fetch-blogs/docker-compose.yml`
