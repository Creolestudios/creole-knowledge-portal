---
title: Roadmap & Known Issues
tags: [roadmap, issues, future]
created: 2026-05-16
updated: 2026-06-13
---
# Roadmap & Known Issues

This page tracks the evolution of the Creole Knowledge Portal, including planned features and existing technical debt.

## 🎯 Future Plans

### Short-Term (Q3 2026)
- [ ] **User-Defined Sources**: Allow users to add their own RSS feeds via the dashboard.
- [ ] **Digest Feedback Loop**: Implement "Thumbs Up/Down" on digest sections to refine AI personalization.
- [ ] **Enhanced Admin UI**: Move admin user management to a more robust interface.

### Medium-Term (Q4 2026)
- [ ] **Semantic Search**: Implement a search interface for past digests using `pgvector` embeddings.
- [ ] **Multi-Modal Synthesis**: Incorporate images and video summaries into the daily digests.
- [ ] **Collaborative Digests**: Shared digests for specific office teams or projects.

### Long-Term (2027+)
- [ ] **Agentic Curation**: Fully autonomous agents that scout for niche blogs based on emerging tech trends.
- [ ] **Self-Correcting Pipeline**: AI-driven validation of scraped content to reduce parsing errors.

## ⚠️ Known Issues & Technical Debt

- **Admin Hardcoding**: The admin email is currently hardcoded in `middleware.ts`.
  - *Plan*: Move to a `profiles` table `role` column or a config file.
- **Parsing Fragility**: Certain RSS feeds have non-standard XML, leading to occasional fetch failures.
  - *Plan*: Implement more robust fallback parsers in the `fetch-blogs/` module.
- **Connection Latency**: Intermittent latency when fetching large vector sets from Supabase.
  - *Plan*: Optimize index strategies (HNSW) and implement caching.
