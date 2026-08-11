---
title: 'ADR 0001: Next.js 15 App Router Architecture'
tags: [adr, architecture, nextjs]
created: 2026-05-27
updated: 2026-05-27
---

# ADR 0001: Next.js 15 App Router Architecture

## Status

**Approved**

---

## Context

The project requires a framework that supports fast rendering, optimized search crawler metrics, and unified routing. The application hosts server-side interactions (like fetching from PostgreSQL and communicating with APIs) alongside interactive dashboards (such as tag selectors and tab switchers).

Historically, Page router patterns in Next.js split client/server execution but suffered from heavier bundles and manual state sharing. Next.js 15 App Router architecture addresses this using React Server Components (RSC).

---

## Decision

We standardized on Next.js 15 and the App Router architecture, using the following conventions:

1. **Server Components by Default**: All files under `app/` are React Server Components unless explicitly marked with the `'use client'` directive. This ensures data-fetching code (like Supabase operations) runs server-side to limit browser bundle sizes.
2. **Explicit Client Boundaries**: Use `'use client'` for interactive elements that use React hooks (`useState`, `useEffect`, `useCallback`) or import libraries like Framer Motion (`motion/react`).
3. **App Directory Routing**: Follow App Router path routing (e.g. `/` mapped to `app/page.tsx`, and `/dashboard` mapped to `app/dashboard/page.tsx`). Do not include any components inside `pages/`.

---

## Consequences

- **Positive**:
  - Reduced bundle size: Server-side dependencies (like `@google/genai` and `@supabase/supabase-js`) do not get shipped to client web browsers.
  - Better performance: Server-side rendering (SSR) delivers pre-rendered HTML, resulting in faster initial page loading times.
- **Negative**:
  - Developers must manage the separation between Server and Client Components (e.g., passing data through serialize boundaries or boundaries demarcated by Client boundaries).
  - Hydration mismatch issues can occur if browser-only objects (like `window.location`) are accessed directly during Server compilation (resolved via `mounted` states).
