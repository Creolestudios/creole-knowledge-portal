---
title: Logout Button
tags: [component, shared, auth, client-component]
created: 2025-05-16
updated: 2025-05-16
---

# Logout Button

**File:** `components/logout-button.tsx`
**Type:** Client Component (`'use client'`)

## Purpose

A reusable sign-out button with two visual variants. Handles Supabase session termination and navigation back to the login page.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'sidebar'` | `'default'` | Visual style variant |

## Variants

### Default

A compact inline button with icon + text, styled for headers or toolbars.

```
[LogOut icon] Sign Out
```

### Sidebar

A full-width button designed for dark sidebar navigation panels.

```
[LogOut icon with hover animation] Sign Out
```

## Behavior

1. Calls `supabase.auth.signOut()` to terminate the session
2. Redirects to `/` (login page)
3. Calls `router.refresh()` to clear any cached server component data

## Dependencies

- `@/lib/supabase/client` — Browser Supabase client
- `next/navigation` — `useRouter` for navigation
- `lucide-react` — LogOut icon
