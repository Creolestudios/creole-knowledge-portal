---
title: Creole Knowledge Portal — Wiki Home
tags: [index, moc, wiki, creole-knowledge-portal]
created: 2025-05-16
updated: 2025-05-16
---

# Creole Knowledge Portal

An internal office tool delivering personalized morning tech blog recommendations and daily AI digests to team members at Creole Studios.

## Quick Links

| Section | Description |
|---------|-------------|
| [[pages/architecture]] | System design, data flow, and Mermaid diagrams |
| [[pages/setup-guide]] | Installation, environment variables, and local dev |
| [[pages/roadmap]] | Future plans, known issues, and backlog |
| [[components/index]] | All React components documented |
| [[decisions/index]] | Architectural Decision Records |
| [[logs/index]] | Changelog and development log |

## Project Identity

- **Name:** Creole Knowledge Portal
- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase · Gemini AI
- **Auth:** Supabase Magic Link (OTP) + Google OAuth
- **Deployment:** Standalone Docker / Google Cloud Run
- **Admin:** Gated by exact email match (`priya.dhanani@creolestudios.com`)

## Repository Structure

```
app/                  # Next.js App Router pages
  page.tsx            # Login (Magic Link + Google OAuth)
  dashboard/          # User digest view
  admin/dashboard/    # Admin: blog sources + user management
  auth/callback/      # Supabase auth callback handler
  api/admin/          # Server-side admin API routes
components/           # Shared React components
lib/supabase/         # Supabase client factories (browser, server, admin)
scripts/              # CI/CD shell scripts
wiki/                 # This documentation
```
