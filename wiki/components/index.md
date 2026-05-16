---
title: Components — Map of Content
tags: [components, moc, react, ui]
created: 2025-05-16
updated: 2025-05-16
---

# Components

All React components in the Creole Knowledge Portal, organized by type.

## Pages (App Router)

| Component | Path | Type | Description |
|-----------|------|------|-------------|
| [[login-page]] | `app/page.tsx` | Client | Magic Link + Google OAuth login |
| [[user-dashboard]] | `app/dashboard/page.tsx` | Client | Morning briefing with recommendations |
| [[admin-dashboard]] | `app/admin-dashboard` | Client | Blog sources + user management |

## Shared Components

| Component | Path | Type | Description |
|-----------|------|------|-------------|
| [[logout-button]] | `components/logout-button.tsx` | Client | Reusable sign-out button |
| [[user-management]] | `components/user-management.tsx` | Client | Admin user profile editor |

## Route Handlers

| Handler | Path | Description |
|---------|------|-------------|
| [[auth-callback]] | `app/auth/callback/route.ts` | OAuth/OTP code exchange |
| [[admin-users-api]] | `app/api/admin/users/route.ts` | User listing API |

## Library Modules

| Module | Path | Description |
|--------|------|-------------|
| [[supabase-clients]] | `lib/supabase/` | Browser, server, and admin clients |
| [[middleware]] | `middleware.ts` | Auth verification + route protection |
