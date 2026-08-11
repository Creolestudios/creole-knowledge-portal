---
title: Architectural Decisions Index
tags: [moc, adr, architecture]
created: 2026-05-27
updated: 2026-06-13
---

# Architectural Decision Records (ADRs)

This index hosts all Architectural Decision Records (ADRs) documenting choices made during the conception, structuring, and development of the **Creole Knowledge Portal**.

---

## ⚡ Active ADRs

- [[decisions/001-app-router|ADR 001: Use Next.js App Router (Base)]]
  - _Status:_ Approved
  - _Summary:_ Foundation ADR to use Next.js App Router.
- [[decisions/0001-nextjs-app-router|ADR 0001: Next.js 15 App Router Structure]]
  - _Status:_ Approved
  - _Summary:_ Standardizing on Next.js 15's App Router architecture for pages, API routes, and layouts to utilize React Server Components (RSC).
- [[decisions/0002-supabase-auth|ADR 0002: Supabase SSR Authentication & Magic Link]]
  - _Status:_ Approved
  - _Summary:_ Moving to server-side auth integration via `@supabase/ssr` to ensure secure, passwordless authentication using Magic Link and Google OAuth.
- [[decisions/0003-middleware-auth-guards|ADR 0003: Middleware-Based Router Security & Admin Gates]]
  - _Status:_ Approved
  - _Summary:_ Implementing routing, guards, and redirection policies within a unified Next.js Middleware instance, alongside hardcoded checks for the administrative role email.
- [[decisions/0004-decoupled-blog-fetcher|ADR 0004: Decoupled Python Blog Crawler & Summarizer]]
  - _Status:_ Proposed
  - _Summary:_ Architecture boundaries between the Next.js frontend application and the Python-based FastAPI scraping & synthesis microservice (`fetch-blogs`).
