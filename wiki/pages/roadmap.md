---
title: Roadmap
tags: [roadmap, future, backlog, known-issues]
created: 2025-05-16
updated: 2025-05-16
---

# Roadmap

## Current State (v0.1.0)

The portal is in early development with core authentication and admin infrastructure in place. The recommendation engine and AI digest features are scaffolded but not yet fully implemented.

### What's Working

- [x] Supabase Magic Link authentication
- [x] Google OAuth authentication
- [x] Middleware-based route protection
- [x] Admin dashboard with blog source management
- [x] Admin user profile management (CRUD)
- [x] User dashboard UI (placeholder recommendations)
- [x] Responsive design (mobile + desktop)
- [x] CI quality gate script

### Known Issues

- [ ] Dashboard recommendations are placeholder cards — no real data fetched yet
- [ ] No Gemini AI integration in the frontend (key configured but unused in visible code)
- [ ] Blog fetch module (`fetch-blogs/`) referenced in CLAUDE.md but not present in repo
- [ ] Only one admin email is supported (hardcoded)
- [ ] No user self-service profile editing (admin-only currently)
- [ ] `user_profiles.current_tech_stack` field exists in API response but is not editable in the UI
- [ ] No pagination on user list in admin dashboard
- [ ] Test coverage is minimal (only a sanity check test exists)

## Short-Term Goals

- [ ] **Blog Fetch Module** — Implement the Python/FastAPI service to scrape blog sources and feed content to Gemini for synthesis
- [ ] **AI Digest Generation** — Use Gemini to create personalized daily digests based on user profiles
- [ ] **Real Recommendation Cards** — Replace placeholder cards with actual AI-generated recommendations
- [ ] **User Profile Self-Service** — Allow users to edit their own profiles from the dashboard
- [ ] **Notification System** — Implement the notifications feature (UI exists but is non-functional)

## Medium-Term Goals

- [ ] **Multi-Admin Support** — Move admin email(s) to a database table or environment variable list
- [ ] **Email Digest Delivery** — Send morning digests via email in addition to the dashboard
- [ ] **Reading History** — Track which articles users have read to improve recommendations
- [ ] **Search Functionality** — Make the dashboard search bar functional (currently UI-only)
- [ ] **Settings Page** — Implement user settings (currently a placeholder nav item)
- [ ] **Comprehensive Test Suite** — Add integration tests for auth flow, API routes, and components

## Long-Term Vision

- [ ] **Team Analytics** — Dashboard showing team-wide reading trends and knowledge gaps
- [ ] **Custom Digest Schedules** — Let users choose when they receive their digest
- [ ] **Slack/Teams Integration** — Push digests to team communication channels
- [ ] **Content Bookmarking** — Save articles for later reading
- [ ] **RSS Feed Support** — Auto-discover and parse RSS feeds from blog sources
- [ ] **Multi-Tenant** — Support multiple organizations/teams

## Technical Debt

- [ ] Remove hardcoded admin email — externalize to config
- [ ] Add proper error boundaries for React components
- [ ] Implement loading skeletons instead of spinner-only states
- [ ] Add proper TypeScript types for Supabase tables (generated from schema)
- [ ] Set up proper database migrations (currently manual SQL)
- [ ] Add rate limiting to API routes
- [ ] Implement proper logging (replace `console.log`/`console.error`)
