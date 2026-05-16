---
title: Auth Callback
tags: [route-handler, auth, supabase, server]
created: 2025-05-16
updated: 2025-05-16
---

# Auth Callback

**File:** `app/auth/callback/route.ts`
**Type:** Route Handler (Server-side)

## Purpose

Handles the OAuth/OTP redirect from Supabase after a user authenticates. Exchanges the authorization code for a session and redirects the user to the appropriate dashboard.

## Flow

```mermaid
flowchart TD
    A[GET /auth/callback] --> B{Error param?}
    B -->|Yes| C[Redirect to / with error message]
    B -->|No| D{Code param?}
    D -->|No| E[Redirect to / with 'Authentication failed']
    D -->|Yes| F[Exchange code for session]
    F --> G{Exchange successful?}
    G -->|No| H[Redirect to / with error]
    G -->|Yes| I{Is admin email?}
    I -->|Yes| J[Redirect to /admin/dashboard]
    I -->|No| K[Redirect to /dashboard]
```

## URL Parameters

| Param | Description |
|-------|-------------|
| `code` | Authorization code from Supabase |
| `error` | Error type (if auth failed) |
| `error_code` | Specific error code (e.g., `otp_expired`) |
| `error_description` | Human-readable error message |
| `next` | Optional redirect path (defaults to `/dashboard`) |

## Origin Detection

The handler uses robust origin detection for redirect URLs:
- **Localhost:** Preserves full origin including port
- **Production:** Uses `https://` + hostname only (strips non-standard ports from Cloud Run URLs)

## Error Handling

- **Invalid flow state:** Provides user-friendly message about expired sessions
- **Missing user data:** Redirects with "No user found" error
- **Fatal errors:** Catches all exceptions and redirects with generic error

## Dependencies

- `@/lib/supabase/server` — Server-side Supabase client
- `next/server` — NextResponse for redirects
