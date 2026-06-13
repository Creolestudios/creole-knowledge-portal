---
title: Authentication Components
tags: [components, auth]
created: 2026-05-16
updated: 2026-06-13
---
# 🔑 Authentication Components

Documentation for the authentication interface and logic.

## 🛠️ Implementation

Authentication is handled via **Supabase Auth**, providing a passwordless experience.

### Magic Link Login
- **Purpose**: Allows users to log in via email OTP (One-Time Password).
- **Logic**: Uses `supabase.auth.signInWithOtp`.
- **UI**: Simple email input field with a "Send Link" action.

### Google OAuth
- **Purpose**: Integration with corporate Google accounts.
- **Logic**: Uses `supabase.auth.signInWithOAuth` with provider `google`.
- **UI**: Dedicated "Sign in with Google" button.

## 🛡️ Authorization Logic

### User Access
- All authenticated users can access the `/dashboard` route.
- Authorization is enforced in `middleware.ts`.

### Admin Access
- **Hardcoded Rule**: Only users with the email `priya.dhanani@creolestudios.com` are granted access to `/admin/*` routes.
- **Enforcement**: The middleware checks the authenticated user's email against this literal string.

## 🔗 Related Files
- `middleware.ts`: Global auth routing and enforcement.
- `app/page.tsx`: The primary login landing page.
- `app/auth/callback/route.ts`: Handles the Supabase auth redirect.
