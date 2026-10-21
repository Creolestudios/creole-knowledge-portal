# Admin Manual & Technical Operations Guide: Blog Fetch Module

**Creole Knowledge Portal — Automated Tech Digest & Knowledge Administration**  
*Document Version:* 2.0  
*Target Audience:* Portal Administrators, System Operators, Engineering Leads  
*Module Role:* Administrative Configuration, Source Curation, User Moderation & Pipeline Monitoring  

---

## Table of Contents
1. [Overview & Administrative Scope](#1-overview--administrative-scope)
2. [Admin Authentication & Authorization Gate](#2-admin-authentication--authorization-gate)
3. [Admin Console Overview (`/admin/dashboard`)](#3-admin-console-overview-admindashboard)
4. [Tab 1: Blog Sources Management (`sources`)](#4-tab-1-blog-sources-management-sources)
   - [Configuring Technical RSS Feeds](#configuring-technical-rss-feeds)
   - [URL Validation & Persistence](#url-validation--persistence)
   - [How Sources Feed the Python Celery Pipeline](#how-sources-feed-the-python-celery-pipeline)
5. [Tab 2: User Profile & Tech Stack Management (`users`)](#5-tab-2-user-profile--tech-stack-management-users)
   - [User Search & Profile Inspection](#user-search--profile-inspection)
   - [Modifying Primary & Secondary Tech Stacks](#modifying-primary--secondary-tech-stacks)
   - [Role Delegation (User vs Admin)](#role-delegation-user-vs-admin)
   - [Impact on Scrape Personalization & Learning Path](#impact-on-scrape-personalization--learning-path)
6. [Tab 3: Submissions Moderation (`submissions`)](#6-tab-3-submissions-moderation-submissions)
   - [Reviewing Employee Drafts from Blog Roulette](#reviewing-employee-drafts-from-blog-roulette)
   - [AI Vetting Quiz Score Inspection](#ai-vetting-quiz-score-inspection)
   - [Approval, Rejection & Google Drive Publishing](#approval-rejection--google-drive-publishing)
7. [Backend Pipeline Architecture & Operations](#7-backend-pipeline-architecture--operations)
   - [Scheduled Cron Runs (APScheduler default 08:00 IST)](#scheduled-cron-runs-apscheduler-default-0800-ist)
   - [Celery Workers & Redis Queue Management](#celery-workers--redis-queue-management)
   - [Celery Flower Dashboard (`http://localhost:5555`)](#celery-flower-dashboard-httplocalhost5555)
   - [MongoDB Beanie Collections Maintenance](#mongodb-beanie-collections-maintenance)
8. [Admin Troubleshooting, Testing & Failure Recovery](#8-admin-troubleshooting-testing--failure-recovery)
   - [Diagnostic Command Reference](#diagnostic-command-reference)
   - [Troubleshooting Matrix](#troubleshooting-matrix)

---

## 1. Overview & Administrative Scope

The **Blog Fetch Module** relies on both Next.js App Router (frontend / BFF) and a Python FastAPI microservice (`fetch-blogs/`) backed by Celery, Redis, and MongoDB. 

As an **Administrator**, your responsibilities include:
1. **Source Curation**: Regulating technical RSS feeds and external tech blogs scraped by the automated pipeline.
2. **User & Curriculum Calibration**: Managing employee tech stacks, experience levels, and learning interests to ensure briefings remain relevant.
3. **Content Moderation**: Reviewing and approving employee articles drafted in Blog Roulette before publishing to the company Google Drive.
4. **Pipeline Health & Orchestration**: Monitoring background workers, scheduling daily morning digest generation, handling API rate limits, and troubleshooting queue stalls.

---

## 2. Admin Authentication & Authorization Gate

Administrative controls are secured at both database and middleware layers:

1. **Role Verification**:
   - Access to `/admin` and `/admin/dashboard` queries Supabase `user_profiles` for the authenticated user ID.
   - If `profile.role !== 'admin'`, the user is instantly redirected to the standard user dashboard at `/` or `/dashboard`.
2. **BFF Internal Token Handshake**:
   - Next.js server actions communicate with the FastAPI backend via an internal header:
     `X-Internal-Token: <AUTH_SECRET_KEY>`
   - Requests without this token or with mismatched credentials return `401 Unauthorized`.

---

## 3. Admin Console Overview (`/admin/dashboard`)

When an authenticated administrator logs into the portal, navigating to `/admin/dashboard` mounts the central console:

```
┌─────────────────────────────────┬────────────────────────────────────────────────────────┐
│  [🛡] Admin Console             │  Welcome, Admin [admin@creolestudios.com]              │
│  [SECURE ACCESS]                │                                                        │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│  MENU                           │                                                        │
│  [🌐] Blog Sources              │  ACTIVE TAB WORKSPACE                                  │
│  [👥] Users                     │  (Renders Blog Sources / Users / Submissions /        │
│  [🛡] Submissions               │   AI Interview Manager depending on selection)         │
│  [☁] AI Interview               │                                                        │
│                                 │                                                        │
│  [📄] Interview Reports         │                                                        │
│  ------------------------------ │                                                        │
│  [🏠] User Dashboard            │                                                        │
│  [⎋] Sign Out                   │                                                        │
└─────────────────────────────────┴────────────────────────────────────────────────────────┘
```

The sidebar provides instantaneous switching across administrative domains without full page reloads.

---

## 4. Tab 1: Blog Sources Management (`sources`)

The **Blog Sources** tab (`app/admin/dashboard/page.tsx` with `activeTab === 'sources'`) manages the pool of technical publications that feed the discovery stage.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🌐 Blog Sources Configuration                                                         │
│  Manage the technical blogs and RSS feeds used for daily crawl discovery.              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Feed URL 1: [ https://netflixtechblog.com/feed                                  ] [🗑] │
│  Feed URL 2: [ https://engineering.fb.com/feed/                                  ] [🗑] │
│  Feed URL 3: [ https://aws.amazon.com/blogs/architecture/feed/                   ] [🗑] │
│  Feed URL 4: [                                                                   ] [🗑] │
│                                                                                        │
│  [ + Add Another Source ]                                  [ 💾 Save Configuration ]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Operational Workflow:
1. **Adding a Feed**:
   - Click **"+ Add Another Source"** to create a new input row.
   - Enter a valid HTTP/HTTPS URL pointing to an RSS XML feed, Atom feed, or tech blog URL.
2. **Validation Rules**:
   - The interface rejects duplicate URLs.
   - Non-HTTP/HTTPS protocols and malformed URLs trigger inline validation warnings.
   - Empty rows are pruned automatically before saving.
3. **Saving & Database Sync**:
   - Click **"Save Configuration"**.
   - Next.js writes the entries to the Supabase `blog_sources` table under the administrator’s ID.
4. **How Sources Feed the Scrape Pipeline**:
   - When the scheduled cron or user-triggered synthesis runs, the Celery scrape worker (`src/workers/scraper_tasks.py`) queries `blog_sources`.
   - It reads the XML feeds using `feedparser`, filters out paywalls, news, and non-English posts, and enqueues extracted article IDs into MongoDB.

---

## 5. Tab 2: User Profile & Tech Stack Management (`users`)

The **Users** tab (`components/user-management.tsx`) allows administrators to calibrate learning curricula for every team member.

### Key Capabilities:
1. **User Search & Directory**:
   - Search team members by name, email, or specific role.
   - Displays last updated date, primary stack badges, and experience levels.
2. **Editing Employee Tech Profile**:
   - Selecting a user opens the **Profile Editor Modal**:
     - **Role**: Toggle between `user` and `admin`.
     - **Current Role**: e.g., `Senior Full-Stack Engineer`, `DevOps Specialist`.
     - **Years of Experience**: Numerical slider (influences the reading complexity score).
     - **Primary Tech Stack**: Add or remove tags (e.g., `Node.js`, `React 19`, `PostgreSQL`).
     - **Secondary Tech Stack**: Supporting libraries (e.g., `Redis`, `Tailwind`, `Docker`).
     - **Learning Interests**: Specific areas the employee wants to develop (e.g., `LLM Agents`, `Distributed Systems`).
3. **Curriculum & Personalization Impact**:
   - **Interest Precedence**: If a user has specified interests, the scraper targets *those interests only*.
   - **Stack Continuity**: If no interests are designated, the ranker matches the primary tech stack, ensuring consecutive daily briefings continue previous topics until a stack curriculum is completed.

---

## 6. Tab 3: Submissions Moderation (`submissions`)

The **Submissions** tab (`components/submissions-moderation.tsx`) serves as the editorial gate for internal blogs written via **Blog Roulette**.

### Moderation Workflow:
1. **Draft Review**:
   - Inspect employee blog submissions with author name, title, word count, and target keywords.
2. **AI Vetting Verification**:
   - The system displays the author's score on their own AI-generated authorship quiz (verifying human authorship rather than unvetted ChatGPT copy-pasting).
3. **Administrative Action**:
   - **Approve**: Converts the approved HTML body into a native Google Doc within the company's shared Google Drive (`application/vnd.google-apps.document`) and notifies the marketing team.
   - **Reject / Request Revisions**: Returns the blog to draft status with specific editorial feedback.

---

## 7. Backend Pipeline Architecture & Operations

The Blog Fetch backend (`fetch-blogs/`) runs as a Python FastAPI microservice utilizing Celery workers and Redis.

```
                  ┌──────────────────────────────────────────────┐
                  │ Next.js BFF (:3000) / lib/blog-service.ts    │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTP (X-Internal-Token)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ FastAPI Microservice (:8000)                 │
                  └──────────────────────┬───────────────────────┘
                                         │ Enqueues Celery Chain
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ REDIS BROKER (:6379)                                                                   │
│ [ scrape_queue ] → [ extract_queue ] → [ rank_queue ] → [ generate_queue ] → [ publish_queue ] │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                         │ Executed by Celery Workers
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ MONGODB 7 (:27017)                                                                     │
│ Collections: articles | user_profiles | daily_digests | pipeline_jobs                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Daily Cron Schedule
- Default Schedule: **08:00 IST** (`30 2 * * *` UTC).
- Managed by APScheduler in `src/core/scheduler.py`.
- At trigger time, it queries all Supabase user IDs and enqueues a `celery.chain` per user across the 5 queues.
- Manual Cron Trigger Endpoint:
  ```bash
  curl -X POST http://localhost:8000/api/v1/digests/cron/trigger
  ```

### 2. Celery Worker Pool (Windows / Linux)
Because Windows does not support `fork()`, local development workers must run using the `solo` pool:
```powershell
# Start all 5 queues on Windows
uv run celery -A src.workers.celery_app worker -Q scrape_queue,extract_queue,rank_queue,generate_queue,publish_queue -P solo -l info
```

### 3. Monitoring with Celery Flower
In Docker / Production environments, Flower is exposed on port `5555`:
- URL: `http://localhost:5555`
- Displays active tasks, execution times, worker health, and retry attempts.

---

## 8. Admin Troubleshooting, Testing & Failure Recovery

### 8.1 Diagnostic Command Reference

```bash
# 1. Check API Liveness & Database Ping
curl http://localhost:8000/api/v1/health/live
curl http://localhost:8000/api/v1/health/ready

# 2. Check Pipeline Job Status for a Specific User
curl http://localhost:8000/api/v1/pipeline/status/<supabase-user-uuid>

# 3. Force Immediate Pipeline Execution for a User
curl -X POST http://localhost:8000/api/v1/digests/generate \
  -H "Content-Type: application/json" \
  -d '{"userId": "<supabase-user-uuid>"}'

# 4. Trigger Manual Supabase-to-Mongo Profile Resync
curl -X POST http://localhost:8000/api/v1/profiles/<supabase-user-uuid>/sync \
  -H "X-Internal-Token: <AUTH_SECRET_KEY>"

# 5. Inspect Redis Queue Backlog
docker exec -it <redis-container> redis-cli -n 0 LLEN scrape_queue
```

### 8.2 Troubleshooting Matrix

| Issue / Symptom | Root Cause | Administrative Resolution Action |
| :--- | :--- | :--- |
| **HTTP 401 Unauthorized from FastAPI** | `AUTH_SECRET_KEY` mismatch between Next.js and Python | Ensure `BLOG_INTERNAL_TOKEN` in Next.js `.env.local` exactly matches `AUTH_SECRET_KEY` in `fetch-blogs/.env`. |
| **Pipeline Hangs at "Extracting..."** | Celery worker for `extract_queue` crashed or blocked by hanging request | 1. Check Flower at `:5555`.<br>2. Restart workers: `powershell -File scripts/start-workers.ps1`.<br>3. Inspect newspaper3k/Jina timeouts. |
| **HTTP 429 Gemini Quota Exceeded** | Daily request volume exceeded Google AI quota | 1. The service automatically attempts fallbacks (`gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-2.5-flash`).<br>2. Add or rotate `LLM_GEMINI_API_KEY` in `fetch-blogs/.env`. |
| **User receives wrong tech stack articles** | Outdated `user_profiles` cache in MongoDB | Trigger manual profile sync via `POST /api/v1/profiles/<userId>/sync`. Verify updated tokens in MongoDB collection `user_profiles`. |
| **Same-Day Duplicate Prevention** | User clicks Synthesize but sees previous digest | By design, only **one digest is permitted per calendar day (IST)**. Generate returns `cached: true` if today’s briefing exists. |

---
*Manual compiled by Creole Knowledge Portal Engineering Team.*
