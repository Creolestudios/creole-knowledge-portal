# Production Database Migration Guide: Supabase & MongoDB

This guide walks you through migrating and initializing both **Supabase (PostgreSQL)** and **MongoDB** when switching to a **new account, new cluster, or fresh production environment**.

---

## Architecture Overview

| Component | Database | Managed Service | Role in Application |
|---|---|---|---|
| **Core Web App & AI Interview** | PostgreSQL | **Supabase** | Users, auth, interview sessions, questions, strikes, events, scores, blogs, quizzes |
| **Blog Fetch & Synthesis Module** | NoSQL Document Store | **MongoDB (Atlas)** | Crawled raw articles, embeddings, synthesized daily briefings, pipeline job states |

---

## Part 1: Supabase (PostgreSQL) Migration

When setting up a **new Supabase project**:

### 1.1 Prerequisites from New Supabase Project
1. Log in to [Supabase](https://app.supabase.com) and click **New project**.
2. Save your **Database Password**.
3. From **Project Settings** → **API**, copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **`anon` `public` key**
   - **`service_role` `secret` key** (keep private!)
4. From **Project Settings** → **Database**, copy your **Connection String** (URI or Direct connection).

---

### 1.2 Running the Migrations

There are two ways to apply all migrations to your new Supabase project:

#### Option A: Supabase CLI (Recommended & Automated)

The repository already contains 20 sequential migrations in `supabase/migrations/`.

1. **Install or use Supabase CLI via `npx`**:
   ```bash
   # In the root directory of creole-knowledge-portal
   npx supabase login
   ```
2. **Link your local repo to the new Supabase project**:
   ```bash
   npx supabase link --project-ref <your-new-project-ref>
   ```
   *(It will prompt for your database password).*

3. **Push all migrations**:
   ```bash
   npx supabase db push
   ```
   This command applies all 20 migration files in chronological order and maintains the migration tracking table automatically.

---

#### Option B: Supabase Dashboard SQL Editor (Manual / Web UI)

If you do not have CLI access, run the scripts directly in the Supabase Web Dashboard:

1. Go to **Supabase Dashboard** → **SQL Editor** → **New query**.
2. **First**, run the baseline schema file located at:
   - [`supabase_migrations.sql`](file:///c:/Users/juzar/creole-knowledge-portal/supabase_migrations.sql)
     *(Creates extensions, gamification schema, user activity tables, streaks, and badges).*
3. **Next**, run the SQL files from [`supabase/migrations/`](file:///c:/Users/juzar/creole-knowledge-portal/supabase/migrations/) in sequential timestamp order:
   1. `20260524000000_daily_activity_tracker.sql`
   2. `20260613000000_create_quiz_tables.sql`
   3. `20260613120000_blog_roulette.sql`
   4. `20260616120000_blog_roulette_storage.sql`
   5. `20260623120000_blog_roulette_leaderboard.sql`
   6. `20260704120000_blog_roulette_drive_link.sql`
   7. `20260817000000_alter_quiz_attempts.sql`
   8. `20260825000000_add_match_percentage.sql`
   9. `20260825000001_create_user_activity.sql`
   10. `20260907120000_create_quiz_proctor_storage.sql`
   11. `20260911000000_create_ai_interviews.sql`
   12. `20260914000000_add_ai_interview_terminated_status.sql`
   13. `20260917000000_create_ai_interview_question_system.sql`
   14. `20260918000000_create_interview_events.sql`
   15. `20260918120000_create_interview_invites_and_events.sql`
   16. `20260921000000_add_custom_interview_questions.sql`
   17. `20260921111407_add_termination_reason_to_interview_sessions.sql`
   18. `20260922000000_create_interview_answer_audio.sql`
   19. `20260923000000_fix_interview_events_and_warnings.sql`
   20. `20260924000000_interview_transcript_and_scoring.sql`

---

### 1.3 Mandatory Supabase Dashboard Configurations

After the SQL scripts finish, configure these settings in the Supabase Dashboard:

1. **Authentication → URL Configuration**:
   - **Site URL**: `https://<your-production-domain-or-ip>`
   - **Redirect URLs**: Add `https://<your-production-domain-or-ip>/**`
   > [!IMPORTANT]
   > If you omit this, auth callbacks and magic link logins will silently fail or redirect to `localhost`.

2. **Database → Replication (Realtime)**:
   - Ensure Realtime is enabled for:
     - `interview_events`
     - `interview_sessions`
   *(Required for real-time proctoring alerts to reach the HR dashboard).*

3. **Storage → Buckets**:
   Verify that the following storage buckets exist (created by migrations):
   - `ai-interview-documents` (private)
   - `quiz-proctor-captures` (private)
   - `blog-covers` / `blog-roulette` (public)

---

## Part 2: MongoDB Migration

The Python FastAPI blog engine uses **Beanie ODM + Motor** (`fetch-blogs/src/core/db.py`).

### 2.1 How Schema Migration Works in MongoDB for this Project
Unlike relational databases, **MongoDB requires no manual SQL migration files**.
When the FastAPI app or Celery worker boots with your new `MONGO_URI`:
1. `init_beanie()` connects to the database.
2. It automatically creates the target database (`MONGO_DB_NAME=knowledge_portal`).
3. It automatically provisions all 4 document collections:
   - `articles` (crawled tech posts)
   - `user_profiles` (personalized tech stack & interest caches)
   - `daily_digests` (synthesized daily morning briefings)
   - `pipeline_jobs` (background pipeline task tracking)
4. It builds all defined compound and unique indexes (such as `Article.url` unique constraint).

---

### 2.2 Setting Up the New MongoDB Cluster (e.g. MongoDB Atlas)

1. **Create Cluster**:
   - Go to [MongoDB Atlas](https://cloud.mongodb.com) and create an M0 (free) or dedicated production cluster.
2. **Configure Database User**:
   - Under **Database Access**, create a user (e.g. `ckp_user`).
   - Give role `readWriteAnyDatabase` or `readWrite` on database `knowledge_portal`.
3. **Configure Network Access**:
   - Under **Network Access**, add the IP address of your production server/droplet (e.g. `143.110.245.16/32`).
   - If using dynamic cloud runners, you can temporarily allow `0.0.0.0/0` (secured with strong password).
4. **Copy Connection String**:
   - Click **Connect** → **Drivers (Python)**.
   - Example string:
     ```
     mongodb+srv://ckp_user:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
     ```
   > [!WARNING]
   > If your database password contains special characters (like `@`, `#`, `:`, `/`), you **MUST percent-encode** them (`@` becomes `%40`).

---

### 2.3 Verifying MongoDB Connection (One-liner Test)

Before deploying containers, test the connection string from your local terminal or droplet:

```bash
# Using python:
python -c "
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
async def test():
    client = AsyncIOMotorClient('YOUR_NEW_MONGO_URI', serverSelectionTimeoutMS=5000)
    print('Ping result:', await client.admin.command('ping'))
asyncio.run(test())
"
```
If it prints `{'ok': 1.0}`, your new MongoDB cluster is ready.

---

## Part 3: Deploying with the New Credentials

### ⚠️ Critical Next.js Build-Time Notice
Next.js bakes environment variables starting with `NEXT_PUBLIC_*` into the browser JavaScript bundle **at compile/build time**, NOT at runtime.

If you change `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`, you **must rebuild the Next.js Docker image**:

1. In GitHub Actions → **Actions** → **Build & Push to GHCR (Droplet)**:
   - Input `supabase_url`: Enter your **new** Supabase project URL (`https://<new-id>.supabase.co`).
   - Run workflow for `build_web`.

---

### 3.1 Update Server Environment Files

On the production server (e.g. droplet at `/opt/ckp`):

#### 1. Update `/opt/ckp/.env.production` (Web container)
```ini
# Production URLs
APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com

# NEW SUPABASE CREDENTIALS
NEXT_PUBLIC_SUPABASE_URL=https://<new-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<new-service-role-key>

# External Services
GEMINI_API_KEY=<your-gemini-key>
DRIVE_FOLDER_ID=<your-drive-folder-id>
DRIVE_SERVICE_ACCOUNT_KEY_JSON=<single-line-compacted-json>

# Internal communication to blog API
BLOG_SERVICE_URL=http://api:8000/api/v1
BLOG_INTERNAL_TOKEN=<32-char-random-secret>
```

#### 2. Update `/opt/ckp/.env.api` (FastAPI & Celery containers)
```ini
APP_ENVIRONMENT=production
AUTH_SECRET_KEY=<same-32-char-secret-as-BLOG_INTERNAL_TOKEN>

# NEW MONGODB CREDENTIALS
MONGO_URI=mongodb+srv://ckp_user:<encoded-password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
MONGO_DB_NAME=knowledge_portal

# NEW SUPABASE CREDENTIALS (for profile sync)
SUPABASE_URL=https://<new-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<new-service-role-key>

# Redis (container service name)
REDIS_URL=redis://redis:6379/0
REDIS_RESULT_URL=redis://redis:6379/1

# Gemini for Blog Synthesis
LLM_GEMINI_API_KEY=<your-gemini-key>
```

*(Ensure permissions: `chmod 600 /opt/ckp/.env.production /opt/ckp/.env.api`)*

---

### 3.2 Restart Services

On your production server:

```bash
cd /opt/ckp

# Deploy Web
./deploy.sh web

# Deploy Blog (FastAPI + Worker + Redis)
./deploy.sh blog

# Check status
./deploy.sh status
```

---

## Part 4: Verification Checklist

| Test | Command / Action | Expected Result |
|---|---|---|
| **Supabase Database** | Log into Portal → sign in or register | User row created in `public.user_profiles` |
| **Supabase Realtime** | Start assessment test link | Live events broadcast without WebSocket errors |
| **MongoDB Connection** | `curl -fsS http://127.0.0.1:8000/api/v1/health` | Returns `{"status":"ok","db":"connected"}` |
| **Beanie Auto-Migration** | Inspect MongoDB Atlas Collections | `articles`, `user_profiles`, `daily_digests`, `pipeline_jobs` present |
| **Blog Pipeline Run** | Trigger `/api/v1/pipeline/jobs` | Generates briefing and saves to MongoDB |
