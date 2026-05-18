---
title: System Architecture
tags: [architecture, design]
created: 2026-05-16
updated: 2026-05-16
---

# Architecture

The Creole Knowledge Portal is an internal office tool for morning tech blog recommendations and AI digests.

## High-Level Overview

The system consists of a Next.js 15 (App Router) frontend, Supabase for authentication and database, and a blog-fetching module written in Python/FastAPI.

```mermaid
graph TD
    User((User)) --> NextApp[Next.js App Router]
    NextApp --> Supabase[Supabase (Auth + DB)]
    NextApp --> PythonModule[Blog Fetch Module (Python)]
    PythonModule --> Blogs[External Tech Blogs]
```

## Stack Details

- **Frontend:** React 19, Tailwind CSS 4, TypeScript
- **Backend (Admin/DB):** Supabase (Magic Link + OAuth)
- **Data Module:** Python/FastAPI (blog scraping & AI synthesis)
