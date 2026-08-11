---
title: 'ADR 0003: Middleware-Based Router Security & Admin Gates'
tags: [adr, architecture, security, middleware]
created: 2026-05-27
updated: 2026-05-27
---

# ADR 0003: Middleware-Based Router Security & Admin Gates

## Status

**Approved**

---

## Context

We must prevent unauthenticated users from accessing protected dashboard routes, and ensure administrative views are restricted to administrators.

Checking access permission within every page component is error-prone, increases code complexity, and can result in client-side flashes of private content. We need a way to block unauthorized requests before pages are processed by the rendering server.

---

## Decision

We implemented route protection at the HTTP layer using **Next.js Middleware** (`middleware.ts`):

1. **Centralized Access Guards**: The middleware intercepts requests matching `/`, `/dashboard/:path*`, and `/admin/:path*`.
2. **Session Verification**: Query `supabase.auth.getUser()` during route execution to verify session authenticity.
3. **Hardcoded Administrative Identity Gate**: Standard users are blocked from admin resources. The administrative role is verified by checking the user's email against the hardcoded value `priya.dhanani@creolestudios.com`.
4. **Cookie Propagation**: Redirect utilities copy session cookies back into redirection responses to maintain login state.

---

## Consequences

- **Positive**:
  - Secure-by-default routing: Unauthenticated requests are blocked at the Edge before server resources are spent on page generation.
  - Consistent routing rules: Authentication logic is managed in a single file instead of across multiple pages.
- **Negative**:
  - Hardcoding admin credentials in code is rigid. Role configurations should be migrated to a database schema (such as `user_profiles.role` flags) to make user role management dynamic.
  - Checking sessions on every request adds minimal processing overhead at the Middleware layer.
