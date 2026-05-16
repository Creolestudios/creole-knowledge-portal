---
title: Admin Dashboard
tags: [component, page, admin, dashboard, client-component]
created: 2025-05-16
updated: 2025-05-16
---

# Admin Dashboard

**File:** `app/admin/dashboard/page.tsx`
**Type:** Client Component (`'use client'`)

## Purpose

The administrative control panel for managing blog sources and user profiles. Access restricted to the admin email (`priya.dhanani@creolestudios.com`).

## UI Structure

```mermaid
graph TB
    subgraph Sidebar["Sidebar Navigation"]
        Logo[Admin Console + Secure Access Badge]
        Tab1[Blog Sources Tab]
        Tab2[Users Tab]
        UserInfo[Logged-in email]
        SignOut[Sign Out]
    end

    subgraph Content["Main Content Area"]
        subgraph Sources["Blog Sources Tab"]
            URLList[URL Input Fields x10 max]
            AddBtn[Add Another URL]
            SaveBtn[Save Sources]
        end

        subgraph Users["Users Tab"]
            UM[UserManagement Component]
        end
    end
```

## Tabs

### Blog Sources

- Add up to 10 blog source URLs
- Validates URL format before saving
- CRUD operations against `blog_sources` Supabase table
- Delete-and-reinsert pattern for updates (replaces all sources for the admin user)

### Users

- Embeds the [[user-management]] component
- Lists all non-admin users with profile status
- Edit user profiles (role, experience, tech stacks, interests)

## Key Behaviors

- **Admin gate:** Checks authenticated user email against hardcoded admin email; redirects non-admins to `/`
- **Tab switching:** Animated transitions between Sources and Users views
- **URL validation:** Client-side URL format validation before save
- **Responsive:** Sidebar on desktop, compact header with tab icons on mobile

## Dependencies

- `@/lib/supabase/client` — Browser Supabase client
- `@/components/user-management` — User profile management
- `motion/react` — Tab transition animations
- `lucide-react` — Icons (Plus, Trash2, Save, LogOut, Globe, ShieldCheck, etc.)

## State

| State | Type | Purpose |
|-------|------|---------|
| `activeTab` | 'sources' \| 'users' | Current active tab |
| `urls` | string[] | Blog source URL list |
| `loading` | boolean | Initial data fetch |
| `saving` | boolean | Save operation in progress |
| `error` | string \| null | Error message |
| `success` | boolean | Save success feedback |
| `user` | any | Authenticated admin user |

## Database Interaction

```mermaid
sequenceDiagram
    participant Admin as Admin Dashboard
    participant SB as Supabase

    Admin->>SB: SELECT url FROM blog_sources ORDER BY created_at
    SB-->>Admin: Existing URLs

    Admin->>SB: DELETE FROM blog_sources WHERE added_by = user.id
    Admin->>SB: INSERT INTO blog_sources (url, added_by) VALUES (...)
    SB-->>Admin: Success/Error
```
