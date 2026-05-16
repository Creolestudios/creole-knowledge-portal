---
title: Architecture
tags: [architecture, system-design, next-js, supabase, gemini]
created: 2025-05-16
updated: 2025-05-16
---

# Architecture

## Overview

The Creole Knowledge Portal is a Next.js 15 application using the App Router pattern. It combines Supabase for authentication and data persistence with Google Gemini AI for content synthesis. The application follows a server-first component model with client components used only where interactivity is required.

## High-Level System Diagram

```mermaid
graph TB
    subgraph Client["Browser (React 19)"]
        LP[Login Page]
        UD[User Dashboard]
        AD[Admin Dashboard]
    end

    subgraph NextJS["Next.js 15 App Router"]
        MW[Middleware]
        CB[Auth Callback Route]
        API[Admin API Routes]
        SC[Server Components]
    end

    subgraph External["External Services"]
        SB[(Supabase)]
        GM[Gemini AI]
        BS[Blog Sources / RSS]
    end

    LP -->|Magic Link / OAuth| SB
    SB -->|Redirect with code| CB
    CB -->|Exchange code for session| SB
    MW -->|Verify session| SB
    MW -->|Route protection| NextJS
    AD -->|Manage sources & users| API
    API -->|Admin operations| SB
    UD -->|Fetch recommendations| GM
    GM -->|Synthesize from| BS
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant App as Next.js App
    participant MW as Middleware
    participant SB as Supabase
    participant CB as /auth/callback

    U->>App: Visit / (login page)
    alt Magic Link
        U->>App: Enter email, submit
        App->>SB: signInWithOtp(email)
        SB-->>U: Email with magic link
        U->>CB: Click link (code in URL)
    else Google OAuth
        U->>App: Click "Continue with Google"
        App->>SB: signInWithOAuth(google)
        SB-->>U: Google consent screen
        U->>CB: Redirect back (code in URL)
    end
    CB->>SB: exchangeCodeForSession(code)
    SB-->>CB: Session + User data
    alt Admin email
        CB-->>U: Redirect to /admin/dashboard
    else Regular user
        CB-->>U: Redirect to /dashboard
    end
    U->>App: Navigate to protected route
    MW->>SB: getUser() verify session
    MW-->>App: Allow or redirect
```

## Middleware Routing Logic

```mermaid
flowchart TD
    A[Incoming Request] --> B{Has valid session?}
    B -->|No| C{Accessing protected route?}
    C -->|Yes| D[Redirect to /]
    C -->|No| E[Allow through]
    B -->|Yes| F{Is admin email?}
    F -->|Yes| G{On / or /dashboard?}
    G -->|Yes| H[Redirect to /admin/dashboard]
    G -->|No| I[Allow through]
    F -->|No| J{On / or /admin/*?}
    J -->|Yes| K[Redirect to /dashboard]
    J -->|No| L[Allow through]
```

## Data Model

```mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
        string email
        timestamp created_at
        timestamp updated_at
    }

    USER_PROFILES {
        uuid user_id PK,FK
        string email
        string current_role
        int years_of_experience
        text[] primary_tech_stack
        text[] secondary_tech_stack
        string future_interests
        timestamp updated_at
    }

    BLOG_SOURCES {
        uuid id PK
        string url
        uuid added_by FK
        timestamp created_at
    }

    AUTH_USERS ||--o| USER_PROFILES : "has profile"
    AUTH_USERS ||--o{ BLOG_SOURCES : "adds sources"
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | ^15.4.9 |
| UI Library | React | ^19.2.1 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS | 4.1.11 |
| Animation | Motion (Framer Motion) | ^12.23.24 |
| Auth & DB | Supabase | ^2.105.1 |
| SSR Auth | @supabase/ssr | ^0.10.2 |
| AI | @google/genai (Gemini) | ^1.17.0 |
| Icons | Lucide React | ^0.553.0 |
| Forms | @hookform/resolvers | ^5.2.1 |
| Utilities | clsx, tailwind-merge, class-variance-authority | latest |

## Key Architectural Decisions

- **Server Components by default** — `'use client'` only added when hooks or browser APIs are needed
- **Middleware-based auth routing** — no auth redirects inside page components
- **Three Supabase clients** — browser (`client.ts`), server (`server.ts`), admin (`admin.ts`) for appropriate privilege levels
- **Standalone output** — enables Docker/Cloud Run deployment without a Node.js server dependency on the full `node_modules`
- **Cookie config: SameSite=none, Secure=true** — required for cross-origin Cloud Run deployments

## Folder Architecture

```
├── app/
│   ├── layout.tsx              # Root layout (Inter font, metadata)
│   ├── page.tsx                # Login page (client component)
│   ├── globals.css             # Tailwind + custom theme tokens
│   ├── dashboard/page.tsx      # User morning briefing
│   ├── admin/dashboard/page.tsx # Admin console (sources + users)
│   ├── auth/callback/route.ts  # OAuth/OTP callback handler
│   └── api/admin/users/route.ts # Admin user listing API
├── components/
│   ├── logout-button.tsx       # Reusable sign-out button
│   └── user-management.tsx     # Admin user profile editor
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   ├── server.ts           # Server Supabase client
│   │   └── admin.ts            # Service-role admin client
│   ├── utils.ts                # cn() utility (clsx + twMerge)
│   └── sanity.test.ts          # Vitest sanity check
├── middleware.ts               # Auth + route protection
├── scripts/ci-test.sh          # Local quality gate script
└── next.config.ts              # Next.js configuration
```
