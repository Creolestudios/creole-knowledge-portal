---
title: User Management Component
tags: [components, admin]
created: 2026-06-13
updated: 2026-06-13
---
# 🛠️ User Management Component

The `UserManagement` component is a high-privilege administrative tool used to manage technical profiles for all users in the system.

## 🎯 Purpose
To ensure that the AI synthesis engine has accurate, up-to-date technical profiles for every user, enabling highly personalized daily digests.

## ⚙️ Functionality

### User Listing
- **Search**: Filter users by email or stated future interests.
- **Status Indicators**: Visual cues indicate whether a profile is "Complete" (has experience and primary tech stack) or "Incomplete".
- **Sorting/Filtering**: List view of all users retrieved via `/api/admin/users`.

### Profile Editing
Administrators can modify the following fields for any user:
- **Current Role**: Professional title (e.g., "Senior Frontend Developer").
- **Years of Experience**: Numerical value used to calibrate content complexity.
- **Primary Tech Stack**: Core skills (managed as tags).
- **Secondary Tech Stack**: Auxiliary skills (managed as tags).
- **Future Interests**: Text area for goals and learning paths.

## 🛠️ Implementation Details

### State Management
- Uses React `useState` and `useEffect` for local state and data fetching.
- Implements a "Form" vs "List" view toggle via `selectedUser` state.

### Data Persistence
- **Fetching**: Calls the internal admin API `/api/admin/users`.
- **Updating**: Uses `supabase.from('user_profiles').upsert()` to save profile changes directly to the database.

### UI/UX
- **Animations**: Leverages `motion/react` for transitions between the user list and the edit form.
- **Feedback**: Implements a toast system for success/error notifications during save operations.
- **Styling**: Tailwind CSS 4 with a clean, professional admin aesthetic (zinc-based palette with `#34c4f2` accents).

## 🔗 Related Files
- `app/admin/dashboard/page.tsx`: The page that hosts this component.
- `app/api/admin/users/route.ts`: The backend handler for fetching user lists.
- `lib/supabase/client.ts`: Used for the upsert operation.
