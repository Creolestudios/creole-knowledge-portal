---
title: "ADR-002: Centralize Auth Routing in Middleware"
tags: [adr, middleware, routing, auth, decision]
created: 2025-05-16
updated: 2025-05-16
---

# ADR-002: Centralize Auth Routing in Middleware

## Status

Accepted

## Context

The application has role-based routing requirements:
- Unauthenticated users should only see the login page
- Admin users should be directed to the admin dashboard
- Regular users should be directed to the user dashboard
- Neither role should access the other's dashboard

These redirects could be implemented in:
1. Each page component individually
2. A shared layout component
3. Next.js middleware

## Decision

Centralize all authentication-based routing logic in `middleware.ts`. Page components should not contain auth redirect logic.

## Consequences

### Positive
- Single source of truth for routing rules
- Runs before page rendering (no flash of unauthorized content)
- Easy to audit and modify routing rules
- Reduces code duplication across pages
- Works for both server and client components

### Negative
- Middleware runs on every matched request (slight performance overhead)
- Debugging middleware can be harder than component-level redirects
- Admin email is hardcoded in middleware (not easily configurable)
- Some pages still duplicate the auth check for safety (defense in depth), creating slight inconsistency
