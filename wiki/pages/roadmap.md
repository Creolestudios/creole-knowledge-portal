---
title: Product Roadmap
tags: [roadmap, plans, technical-debt]
created: 2026-05-27
updated: 2026-05-27
---

# Product Roadmap

This document outlines the planned integrations, future feature releases, and active technical debt/known issues for the **Creole Knowledge Portal**.

---

## 🗺️ Feature Roadmap

### Phase 1: Authentication & User Profiles Baseline (Completed)

- [x] Configure Google OAuth and email Magic Link login mechanisms.
- [x] Build user profile management fields for tracking technical tags.
- [x] Secure application pages at the Edge level using Next.js Middleware routers.

### Phase 2: Feed Configuration & Admin Controls (Current)

- [x] Construct admin controls to manage and validate target blog resource URLs.
- [x] Design user management grid to view profile configurations and update metadata.
- [x] Standardize code testing pipelines and local quality gate reporting workflows.

### Phase 3: Crawling & AI Summarization Engine (Proposed / Upcoming)

- [ ] Implement the `fetch-blogs` FastAPI microservice in Python.
- [ ] Connect crawl algorithms to obey remote site `robots.txt` specifications.
- [ ] Feed crawled technical articles into the Gemini AI pipeline, generating digests tailored to each user profile's tags (`primary_tech_stack`, `future_interests`, `current_role`).
- [ ] Save processed digests inside Supabase schema tables.

### Phase 4: Active Delivery & Subscriptions (Planned)

- [ ] Add real-time email delivery templates via Resend or SendGrid integration.
- [ ] Establish automated cron triggers to dispatch customized digest summaries every morning.
- [ ] Integrate user feedback actions (upvote, downvote, read metrics) to refine recommended summaries.

---

## ⚠️ Known Issues & Technical Debt

### 1. Hardcoded Administrator Check

- **Context**: The admin dashboard requires secure authorization. Currently, check checks are hardcoded to the exact email match `priya.dhanani@creolestudios.com` in `middleware.ts` and the `/api/admin/users` router file.
- **Remediation**: Transition to a database-driven Role-Based Access Control (RBAC) model. Add a `role` column (`admin` vs `user`) in `user_profiles` or a separate `user_roles` table, and evaluate permission flags dynamically during the Middleware validation phase.

### 2. Static Recommendation Feed Placeholders

- **Context**: Standard users navigating to `/dashboard` see visual feed containers populated with mock data (e.g., Recommendation 1, 2, 3).
- **Remediation**: Query actual compiled digests table records matched against the user's saved tech tags.

### 3. Database Integrity & Integration Tests

- **Context**: Existing unit tests are restricted to simple arithmetic sanity check files (`sanity.test.ts`). There are no active unit or integration tests verifying connection logic inside `lib/supabase/`.
- **Remediation**: Build mocked Supabase database contexts and route handlers using Vitest to assert CRUD reliability on `user_profiles` and `blog_sources`.
