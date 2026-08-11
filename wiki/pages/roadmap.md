---
title: Product Roadmap
tags: [roadmap, plans, technical-debt]
created: 2026-05-27
updated: 2026-06-13
---

# Product Roadmap

This document outlines the planned integrations, future feature releases, and active technical debt/known issues for the **Creole Knowledge Portal**.

---

## 🗺️ Feature Roadmap

### Phase 1: Authentication & User Profiles Baseline (Completed)

- [x] Configure Google OAuth and email Magic Link login mechanisms.
- [x] Build user profile management fields for tracking technical tags.
- [x] Secure application pages at the Edge level using Next.js Middleware routers.

### Phase 2: Feed Configuration & Admin Controls (Completed)

- [x] Construct admin controls to manage and validate target blog resource URLs.
- [x] Design user management grid to view profile configurations and update metadata.
- [x] Standardize code testing pipelines and local quality gate reporting workflows.
- [x] Implement the AI Gatekeeper validation system and technical quiz gates.

### Phase 3: Crawling & AI Summarization Engine (Proposed / Upcoming)

- [ ] Implement the `fetch-blogs` FastAPI microservice in Python.
- [ ] Connect crawl algorithms to obey remote site `robots.txt` specifications.
- [ ] Feed crawled technical articles into the Gemini AI pipeline, generating digests tailored to each user profile's tags (`primary_tech_stack`, `future_interests`, `current_role`).
- [ ] Save processed digests inside Supabase schema tables.
- [ ] Support expanded RSS blog sources, potentially with a UI for users to suggest custom feeds.

### Phase 4: Active Delivery & Subscriptions (Planned)

- [ ] Add real-time email delivery templates via Resend or SendGrid integration.
- [ ] Establish automated cron triggers to dispatch customized digest summaries every morning.
- [ ] Integrate user feedback actions (upvote, downvote, read metrics) to refine recommended summaries.
- [ ] Explore community features for users to share or comment on recommended articles.

---

## ⚠️ Known Issues & Technical Debt

### 1. Hardcoded Administrator Check

- **Context**: The admin dashboard requires secure authorization. Currently, checks are hardcoded to the exact email match `priya.dhanani@creolestudios.com` in `middleware.ts` and the `/api/admin/users` router file.
- **Remediation**: Transition to a database-driven Role-Based Access Control (RBAC) model. Add a `role` column (`admin` vs `user`) in `user_profiles` or a separate `user_roles` table, and evaluate permission flags dynamically during the Middleware validation phase.

### 2. Database Integrity & Integration Tests

- **Context**: Existing unit tests are restricted to simple arithmetic sanity check files (`sanity.test.ts`). There are no active unit or integration tests verifying connection logic inside `lib/supabase/`.
- **Remediation**: Build mocked Supabase database contexts and route handlers using Vitest to assert CRUD reliability on `user_profiles` and `blog_sources`.

### 3. Initial Blog Fetch Reliability

- **Context**: Some RSS feeds may occasionally fail to parse correctly due to non-standard formatting.
- **Remediation**: Further refine blog fetching and parsing robustness in the `fetch-blogs` Python microservice.

### 4. Supabase Connection Stability

- **Context**: Under heavy concurrent loads, intermittent connection latency or timeouts may occur.
- **Remediation**: Implement client pooling or backoff retry behaviors when querying remote Supabase instances.
