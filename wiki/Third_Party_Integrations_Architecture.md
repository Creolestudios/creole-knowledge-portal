# Third-Party Services & Integrations Architecture

This document provides a concise overview of all third-party services, APIs, databases, and external platforms used across the **Creole Knowledge Portal** (Next.js) and the **Blog Fetch & Synthesis Module** (`fetch-blogs`), including why each is used and its exact role in the system.

---

## Architecture Summary Matrix

| Service / Platform | Category | Module Used In | Primary Purpose |
| :--- | :--- | :--- | :--- |
| **Supabase** | BaaS / PostgreSQL | AI Interview Portal & Core App | Relational DB, Auth, Document Storage, & Real-time WebSockets |
| **Google Cloud & Drive API** | Cloud Storage & IAM | AI Interview Recording Engine | Storing heavy video files & M2M automated uploads via Service Account |
| **Google Gemini AI** | Large Language Model (LLM) | Interview Engine & Blog Synthesizer | Question generation, transcript evaluation, Copilot chatbot, & embeddings |
| **MongoDB** | NoSQL Document DB | Python Blog Fetch Module | Content lake for unstructured crawled blog posts & vector embeddings |
| **Redis** | In-Memory Broker | Celery Worker Pipeline | Asynchronous task queue broker for multi-stage blog processing |

---

## 1. Supabase (PostgreSQL + Auth + Storage + Realtime)

* **What it is**: A managed Backend-as-a-Service built on top of PostgreSQL.
* **Why we use it**: Rather than setting up and maintaining separate servers for database, authentication, file storage, and WebSockets, Supabase provides all four in a single unified platform.
* **Specific Roles in the Application**:
  1. **Relational Database**: Stores all structured business records:
     - `interview_sessions` (candidate profiles, interview state, proctoring warning tallies).
     - `interview_questions` & `interview_answers` (generated questions, transcripts, durations).
     - `interview_events` (proctoring violation logs, snapshots, recording metadata).
     - `interview_reports` (final evaluations, cognitive & fluency scores, recommendations).
  2. **User Authentication**: Manages secure email/password logins, session cookies, and JWT token verification for HR and Admin portals (`lib/supabase/admin.ts`, `middleware.ts`).
  3. **Document Storage**: Manages the private **`ai-interview-documents`** bucket for securely uploading and generating signed download links for candidate resumes and Job Descriptions (JDs).
  4. **Realtime WebSockets**: Powers live bidirectional channels (`interview-monitor:${sessionId}`) so proctoring strikes, warnings, and session pauses broadcast instantly to the HR monitor screen.

---

## 2. Google Cloud & Google Drive API (Service Account)

* **What it is**: Cloud storage integrated with a Google Cloud Service Account (Machine-to-Machine identity).
* **Why we use it**:
  - Full interview video recordings are heavy (100 MB – 500 MB per interview). Saving them in the primary PostgreSQL database would bloat database storage, spike costs, and degrade performance.
  - Candidates do not have accounts on our system's Google Drive. A **Service Account** allows our backend server to securely authenticate with Google Drive behind the scenes and upload videos without requiring candidate or admin Google logins.
* **Specific Roles in the Application**:
  1. **Background Resumable Chunk Streaming**: Streams video chunks to a dedicated Google Drive folder during the interview so the candidate experiences zero waiting time at submission.
  2. **HR Playback**: Provides direct, secure streaming links (`webViewLink`) for HR to review candidate recordings directly from the Admin Report view.
  3. **Automated 90-Day Retention Dispatcher**: An automated nightly cron job uses the Service Account to permanently delete videos older than 90 days from Google Drive to reclaim storage, while leaving the candidate evaluation reports permanently intact in the database.

---

## 3. Google Gemini AI (Google AI Studio / Vertex AI)

* **What it is**: High-performance Multimodal Large Language Model (LLM) API (`gemini-3.6-flash` and `text-embedding-004`).
* **Why we use it**: Powers all automated natural language understanding, generative evaluation, and vector embedding across both modules.
* **Specific Roles in the Application**:
  1. **Job Description & Resume Parsing**: Extracts skills, seniority level, and core responsibilities from candidate resumes and JDs.
  2. **Dynamic Question Bank Generation**: Formulates custom, multi-category technical questions and behavioral scenarios tailored to the target role.
  3. **Candidate Evaluation & Scoring**: Evaluates candidate speech transcripts against rubric criteria to generate cognitive scores, CEFR fluency ratings, and executive summaries.
  4. **Report AI Copilot**: Powers the interactive chat assistant in the admin drawer, providing grounded answers about candidate answers, flags, and competencies.
  5. **Blog Embeddings & Synthesis**: Generates 768-dimensional vector embeddings for crawled articles and synthesizes personalized executive digests.

---

## 4. MongoDB (NoSQL Document Store)

* **What it is**: Distributed, schema-free document database used exclusively by `fetch-blogs/`.
* **Why we use it**:
  - Web scraping collects heterogeneous, arbitrary data from multiple external sources (RSS feeds, Dev.to, HackerNews, Reddit). Each site returns different HTML structures, nested author schemas, and varying metadata.
  - MongoDB stores unstructured JSON documents and embedding arrays natively without requiring rigid SQL table schema migrations.
* **Specific Roles in the Application**:
  1. Stores raw scraped articles, extracted body text, and article metadata in the `articles` collection.
  2. Stores user personalization profiles and topic interest vectors in the `user_profiles` collection.
  3. Provides fast read/write throughput for asynchronous Python workers using **Beanie ODM + Motor**.

---

## 5. Redis (In-Memory Broker & Cache)

* **What it is**: Ultra-fast in-memory data store used as a message broker.
* **Why we use it**: Scraped web crawling, text extraction, embedding generation, and newsletter synthesis are heavy, long-running background tasks that cannot run inside the HTTP request loop.
* **Specific Roles in the Application**:
  1. **Celery Message Broker (`db=0`)**: Buffers and distributes tasks across 5 dedicated Celery worker queues:
     - `scrape_queue`
     - `extract_queue`
     - `rank_queue`
     - `generate_queue`
     - `publish_queue`
  2. **Celery Result Backend (`db=1`)**: Stores task execution state, task IDs, and completion outputs.

---


