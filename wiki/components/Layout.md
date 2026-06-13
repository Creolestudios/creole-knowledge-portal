---
title: Layout Components
created: 2026-05-16
updated: 2026-05-16
tags: components, layout, ui
---
# Layout Components

This section covers the core layout components that structure the application's user interface.

## `MainLayout`

- **Purpose:** Provides the overall page structure, including navigation, headers, and footers.
- **File:** `components/Layout/MainLayout.tsx` (assumed path)
- **Features:**
    - Wraps page content.
    - Includes a persistent header (e.g., with logo, user profile/login button).
    - May include a persistent navigation sidebar or footer.
    - Handles routing based on user authentication status (redirecting to login if not authenticated for protected routes).
- **Dependencies:** Authentication components, navigation elements.

## `AdminLayout`

- **Purpose:** Provides a distinct layout for admin-specific pages.
- **File:** `components/Layout/AdminLayout.tsx` (assumed path)
- **Features:**
    - Similar to `MainLayout` but with admin-specific navigation or branding.
    - Ensures only authenticated admin users can access these routes.

## `Sidebar` / `Navbar` / `Footer` (if applicable)

- **Purpose:** Individual components for distinct layout sections.
- **File:** (e.g., `components/Layout/Sidebar.tsx`, `components/Layout/Navbar.tsx`, `components/Layout/Footer.tsx`)
- **Features:** Specific UI elements and functionality for each part of the layout.

TODO: Refine based on actual file structure and component implementations in the `components/Layout/` directory.