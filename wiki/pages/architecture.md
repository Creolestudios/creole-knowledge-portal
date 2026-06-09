---
title: System Architecture
tags: [architecture, design, diagrams]
created: 2026-05-27
updated: 2026-05-27
---

# System Architecture

This document details the software architecture, database design, and critical process flows of the **Creole Knowledge Portal**.

---

## 🏗️ Architectural Overview

The Creole Knowledge Portal is architected using a modern web application structure:

1. **Frontend / BFF (Backend for Frontend)**: Next.js 15 (App Router) executing React 19 Client and Server Components.
2. **Authentication & Database**: Supabase serves as the backend infrastructure, handling passwordless authentication (Magic Link), Google OAuth, and structured data storage (PostgreSQL).
3. **Blog Crawler & Synthesis Service** (Proposed/Planned): A separate Python microservice (`fetch-blogs`) built with FastAPI to crawler technical blogs, process payloads, and generate synthetic daily digests via Gemini AI models.

```mermaid
graph TD
    Client[Web Client - React 19] <--> NextJS[Next.js App Router Server]
    NextJS <--> SupabaseAuth[Supabase Auth Services]
    NextJS <--> SupabaseDB[Supabase DB PostgreSQL]
    NextJS <--> Gemini[Gemini AI SDK]
    FetchBlogs[fetch-blogs Microservice Python/FastAPI] -.-> SupabaseDB
    FetchBlogs -.-> Gemini
```

---

## 🔒 Authentication & Routing Flow

Application routing and security checkpoints are enforced at the Edge using Next.js Middleware. Security is not delegated directly to rendering components; instead, requests are verified during the HTTP traversal lifecycle.

### User Roles

- **Standard User**: Authenticated employees who access `/dashboard` to view their morning blog feeds and role-specific technical briefings.
- **Administrator**: Hardcoded to `priya.dhanani@creolestudios.com`. Administrators bypass normal routing to reach `/admin/dashboard`, where they configure blog feeds and manage user tags.

### Authentication Sequence Diagram

The diagram below details the OAuth callback loop:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant MW as Middleware (Edge)
    participant Next as Next.js Server (Callback Route)
    participant Supa as Supabase Auth Engine

    User->>Browser: Selects "Continue with Google" / Requests Magic Link
    Browser->>Supa: Requests login flow authorization
    Supa-->>Browser: Redirects to Callback Endpoint with OAuth ?code=
    Browser->>MW: Sends GET request to /auth/callback?code=X
    MW->>Next: Forwards requests (bypass auth guard rules)
    Next->>Supa: exchangeCodeForSession(code)
    alt Exchange Succeeded
        Supa-->>Next: Returns Auth Token / Sets Cookie
        Next->>Browser: Redirects to /dashboard (User) or /admin/dashboard (Admin)
    else Exchange Failed
        Supa-->>Next: Throws error (expired, invalid state)
        Next->>Browser: Redirects to /?error=details
    end
    Browser->>MW: Access protected route (/dashboard) with Session Cookie
    alt Authenticated Session Valid
        MW-->>Browser: Permit loading page (200 OK)
    else Authenticated Session Invalid / Empty
        MW-->>Browser: Redirect to Login Root (/)
    end
```

---

## 🗄️ Database Design

The database layers are hosted inside Supabase. Currently, the system uses two main custom tables in the PostgreSQL public schema:

### 1. Table: `user_profiles`

Maintains user details, role designations, experience metrics, and technical interests. This is used by the recommendation engine to fetch specialized documents.

### 2. Table: `blog_sources`

Tracks target web feeds configured by administrators to extract morning technical articles.

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    USERS ||--|| USER_PROFILES : "auth.users.id equals user_id"
    USERS ||--o{ BLOG_SOURCES : "added_by references auth.users.id"

    USERS {
        uuid id PK
        string email
        timestamp last_sign_in_at
    }

    USER_PROFILES {
        uuid user_id PK, FK
        string email
        string current_role
        integer years_of_experience
        text_array primary_tech_stack
        text_array secondary_tech_stack
        text future_interests
        timestamp updated_at
    }

    BLOG_SOURCES {
        bigint id PK
        text url
        uuid added_by FK
        timestamp created_at
    }
```

---

## 📂 Codebase Folder Structure

- `app/`: Contains Next.js Page components, API endpoints, and global styling layouts.
- `components/`: Holds reusable visual UI assets, including `LogoutButton` and `UserManagement`.
- `lib/`: Houses database connection initialization factories (`lib/supabase/`).
- `scripts/`: Quality assurance verification pipelines and CI check simulations.
- `fetch-blogs/`: Directory placeholder designated for the planned FastAPI python crawler service.
