---
title: Authentication Components
created: 2026-05-16
updated: 2026-05-16
tags: components, auth
---
# Authentication Components

This section documents the components related to user authentication.

## Supabase Authentication

### `MagicLinkLogin`

- **Purpose:** Handles user login via email One-Time Password (OTP) using Supabase Magic Link.
- **File:** `components/Auth/MagicLinkLogin.tsx` (assumed path)
- **Features:**
    - Input for email address.
    - Sends OTP to the provided email.
    - Handles OTP verification and user session creation.
- **Dependencies:** Supabase Auth client.

### `GoogleOAuthButton`

- **Purpose:** A button component that initiates the Google OAuth flow for user login.
- **File:** `components/Auth/GoogleOAuthButton.tsx` (assumed path)
- **Features:**
    - Renders a Google Sign-In button.
    - Initiates the OAuth redirect to Google.
- **Dependencies:** Supabase Auth client, Next.js app configuration for OAuth.

## Admin Authentication

*   **Admin Access:** Access to admin dashboards is restricted to a hardcoded email (`priya.dhanani@creolestudios.com`) as per `middleware.ts`.

TODO: Add details on any specific admin-only components if they exist.