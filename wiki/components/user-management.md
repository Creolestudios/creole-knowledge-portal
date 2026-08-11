---
title: UserManagement Component
tags: [components, admin, users]
created: 2026-05-27
updated: 2026-05-27
---

# UserManagement Component

The `UserManagement` component provides administrators with an interface to list system users, evaluate their profile completion metrics, and edit user profile attributes.

- **File Path**: [user-management.tsx](file:///var/www/html/creole-knowledge-portal/components/user-management.tsx)
- **Component Type**: Client Component (`'use client'`)
- **Route Usage**: Embedded within the `/admin/dashboard` route.

---

## ⚙️ Functionality and Sub-modules

### 1. User Listing & Filtering

- Retrieves the complete list of system users and profiles by hitting `/api/admin/users` (GET request).
- Calculates user profile completeness based on whether the user has set their `years_of_experience` and added at least one tag to their `primary_tech_stack`.
- Implements text-based search filtering. The input query checks against user email records and `future_interests` descriptions.

### 2. Tag-Based Tech Stack Editor

- Leverages comma-separated inputs or Enter key events to generate arrays of tech stacks.
- Manages separate arrays for `primary_tech_stack` and `secondary_tech_stack`.
- Provides clickable dismiss buttons on individual badges to remove tags.

### 3. Supabase Upsert Transaction

- Submits form values to the `user_profiles` table using `supabase.from('user_profiles').upsert(...)`.
- Resolves conflicts by targeting `user_id`.
- Refreshes the active database list and triggers a confirmation notification toast.

---

## 📊 State and Internal Data Structures

```typescript
interface UserProfile {
  user_id: string;
  email: string;
  current_role: string;
  years_of_experience: number;
  current_tech_stack: string[];
  primary_tech_stack: string[];
  secondary_tech_stack: string[];
  future_interests: string;
  updated_at: string;
}
```

### Key State Hooks

- `users`: Array of `UserProfile` objects fetched from the server.
- `selectedUser`: The `UserProfile` object currently selected for editing. If null, the component renders the user list.
- `formData`: Structured form fields bindings.
- `primaryTechInput` / `secondaryTechInput`: Temporary buffers for typing custom tags.
- `toast`: Notification banner settings.

---

## 🎨 Layout & Animations

- Leverages Framer Motion (`motion/react`) to slide cards left or right when transitioning from the main user list into the profile edit pane.
- Renders green badges (`Profile Complete`) and amber badges (`Profile Incomplete`) for scan-read tracking.
