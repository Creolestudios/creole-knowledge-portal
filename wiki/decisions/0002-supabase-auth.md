---
title: 'ADR 0002: Supabase SSR Authentication & Magic Link'
tags: [adr, architecture, authentication, supabase]
created: 2026-05-27
updated: 2026-05-27
---

# ADR 0002: Supabase SSR Authentication & Magic Link

## Status

**Approved**

---

## Context

The Creole Knowledge Portal is an internal application designed for employees. The login process must support seamless SSO (Google OAuth) and passwordless magic links to prevent credential fatigue and simplify database administration.

In addition, standard user session state details must be securely sent to the server for authentication checks inside API routes and Edge-based routing middleware.

---

## Decision

We implemented authentication using **Supabase Auth** along with the **Supabase SSR** library (`@supabase/ssr`):

1. **Passwordless Magic Links**: Users input their work email to receive a login token link via SMTP.
2. **Google OAuth**: Fast integration mapping Google profile credentials to Supabase Auth user indexes.
3. **Cookie-Based Server-Side Sessions**: Use `createServerClient` to set and retrieve session cookies during client/server actions. This keeps credentials secure by storing auth tokens on the server instead of in client-side localStorage.

---

## Consequences

- **Positive**:
  - Improved security: Auth states are managed via secure cookies (using `sameSite: 'none'` and `secure: true`), protecting tokens from client-side script access.
  - Zero password storage overhead: The database does not need to store, hash, or manage password credentials.
  - Seamless authentication callback: `/auth/callback` handles code exchange and redirects users based on their role.
- **Negative**:
  - Relies on external SMTP providers for delivering Magic Links.
  - Verification links can trigger "invalid flow state" errors if clicked multiple times or if they are modified by corporate link-checkers. Remediation logic was added to intercept `error_code=otp_expired` and output clear user instructions.
