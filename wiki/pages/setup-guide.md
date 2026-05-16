---
title: Setup Guide
tags: [setup, installation, environment, development]
created: 2025-05-16
updated: 2025-05-16
---

# Setup Guide

## Prerequisites

- **Node.js** — v18+ recommended (v20 LTS preferred)
- **npm** — comes with Node.js
- **Supabase project** — with Auth enabled (Magic Link + Google OAuth)
- **Google Gemini API key** — from [Google AI Studio](https://ai.google.dev/)

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd creole-knowledge-portal

# Install dependencies
npm install
```

## Environment Variables

Create a `.env.local` file in the project root (never commit this file):

```bash
# Required: Supabase
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Required: Gemini AI
GEMINI_API_KEY="your-gemini-api-key"

# Optional: App URL (auto-injected in AI Studio)
APP_URL="http://localhost:3000"
```

### Variable Details

| Variable | Scope | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Public anon key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin key — never expose to client |
| `GEMINI_API_KEY` | Server only | Google Gemini API key |
| `APP_URL` | Server only | Deployment URL for callbacks |

## Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Enable **Email (Magic Link)** auth provider
3. Enable **Google OAuth** provider (configure OAuth consent screen in Google Cloud Console)
4. Set the redirect URL in Supabase Auth settings to: `https://your-domain.com/auth/callback`
5. Create the required database tables:

```sql
-- Blog sources table
CREATE TABLE blog_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User profiles table
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  current_role TEXT,
  years_of_experience INTEGER,
  current_tech_stack TEXT[],
  primary_tech_stack TEXT[],
  secondary_tech_stack TEXT[],
  future_interests TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE blog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
```

## Running Locally

```bash
# Development server (hot reload)
npm run dev

# Production build
npm run build
npm run start
```

The app runs on `http://localhost:3000` by default.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Create production build |
| `npm run start` | Run production server |
| `npm run lint` | Run ESLint |
| `npm run lint:report` | ESLint → `reports/eslint-report.json` |
| `npm run format:check` | Check Prettier formatting |
| `npm run format:report` | Prettier → `reports/prettier-report.txt` |
| `npm run test` | Run Vitest unit tests |
| `npm run test:report` | Vitest → `reports/test-report.json` |
| `npm run audit:report` | npm audit → `reports/npm-audit-report.json` |
| `npm run clean` | Clear Next.js cache |
| `bash scripts/ci-test.sh` | Full local quality gate |

## Quality Gate (CI)

Run the full local quality gate before pushing:

```bash
bash scripts/ci-test.sh
```

This runs lint, format check, npm audit, and unit tests, outputting reports to the `reports/` directory.

## Code Style

- **ESLint:** Flat config extending `eslint-config-next`
- **Prettier:** Semi-colons, trailing commas (ES5), single quotes, 100 char width, 2-space indent
- **TypeScript:** Strict mode, bundler module resolution

## Path Aliases

The project uses `@/*` as a path alias mapping to the project root:

```typescript
import { createClient } from '@/lib/supabase/client';
import LogoutButton from '@/components/logout-button';
```

## Deployment

The app is configured for standalone output (`output: 'standalone'` in `next.config.ts`), making it suitable for:

- **Docker containers**
- **Google Cloud Run** (primary target)
- **Firebase Hosting** (firebase-tools included as dev dependency)

### Cloud Run Notes

- Cookies are configured with `SameSite=none` and `Secure=true` for cross-origin compatibility
- The layout includes a script to strip non-standard ports from `.run.app` URLs
- HMR can be disabled via `DISABLE_HMR=true` environment variable (used in AI Studio)
