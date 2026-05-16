---
title: "ADR-001: Use Supabase for Authentication"
tags: [adr, auth, supabase, decision]
created: 2025-05-16
updated: 2025-05-16
---

# ADR-001: Use Supabase for Authentication

## Status

Accepted

## Context

The portal needs authentication for team members with minimal friction. Requirements:
- Passwordless login (reduce credential management burden)
- Google OAuth (team already uses Google Workspace)
- Role-based access (admin vs regular user)
- Session management with SSR support
- Free tier sufficient for internal team size

Alternatives considered:
- **NextAuth.js** — More flexible but requires more configuration and a separate database adapter
- **Firebase Auth** — Good but would split the stack between Firebase (auth) and another DB
- **Clerk** — Excellent DX but paid for production use

## Decision

Use Supabase Auth with Magic Link (OTP) and Google OAuth as the authentication providers. Supabase provides both auth and database in a single platform, reducing operational complexity.

## Consequences

### Positive
- Single platform for auth + database (Supabase)
- Built-in Magic Link support (no email service configuration needed)
- Google OAuth integration is straightforward
- `@supabase/ssr` package handles cookie-based sessions for Next.js
- Free tier is generous for internal team use
- Row Level Security (RLS) available for fine-grained access control

### Negative
- Cookie handling requires careful configuration for cross-origin deployments (SameSite, Secure)
- `@supabase/ssr` requires three separate client factories (browser, server, admin)
- Admin operations require the service role key (must be kept server-side)
- Vendor lock-in to Supabase for both auth and data
