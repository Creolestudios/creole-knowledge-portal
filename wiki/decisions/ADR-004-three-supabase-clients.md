---
title: "ADR-004: Three Separate Supabase Client Factories"
tags: [adr, supabase, architecture, security, decision]
created: 2025-05-16
updated: 2025-05-16
---

# ADR-004: Three Separate Supabase Client Factories

## Status

Accepted

## Context

The application operates in three distinct execution contexts:
1. **Browser** — Client components with user interaction
2. **Server** — Server components, route handlers, middleware
3. **Admin** — Server-only operations requiring elevated privileges

Each context has different requirements for cookie handling, key exposure, and available APIs.

## Decision

Create three separate Supabase client factories in `lib/supabase/`:
- `client.ts` — Browser client using `createBrowserClient`
- `server.ts` — Server client using `createServerClient` with cookie store
- `admin.ts` — Admin client using `createClient` with service role key

## Consequences

### Positive
- Clear separation of privilege levels
- Impossible to accidentally expose the service role key to the browser
- Each client is optimized for its execution context
- Cookie handling is context-appropriate (browser vs server)
- Easy to audit which code has admin access

### Negative
- Three files to maintain for what is conceptually one service
- Developers must know which client to import for each context
- Placeholder fallbacks in client/server factories may mask configuration errors during development
- The admin client throws on missing env var while others silently fall back (inconsistent error handling)
