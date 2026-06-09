# Creole Knowledge Portal — Claude Code Harness

## Project Identity
- **Name:** Creole Knowledge Portal
- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Auth + DB) · Gemini AI
- **Purpose:** Internal office tool — personalized morning tech blog recommendations + daily AI digest
- **Auth:** Supabase Magic Link (OTP) + Google OAuth. Admin gated by exact email match.

## Quick Commands
```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest unit tests
npm run lint:report  # ESLint → reports/eslint-report.json
bash scripts/ci-test.sh  # Full local quality gate
```

## Architecture Rules
- **App Router only** — never use `pages/` directory patterns
- **Server Components by default** — add `'use client'` only when needed (hooks, browser APIs)
- **Supabase clients:** use `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server), `lib/supabase/admin.ts` (admin API only)
- **Middleware** handles all auth routing — do not add auth redirects inside page components
<!-- - Admin email hardcoded: `priya.dhanani@creolestudios.com` (see `middleware.ts`) -->

## Critical Constraints
- Never commit real secrets — use `.env.local` only (gitignored)
- `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` must stay server-side only
- `NEXT_PUBLIC_*` vars are browser-safe
- Respect `robots.txt` for all external scraping (blog fetch module)
- All scraped content must go through the free-tier pipeline (no paid APIs)

## Key Docs (read on demand)
- Architecture deep-dive → `.claude/docs/architecture.md`
- Blog fetch module plan → `.claude/docs/blog-fetch-plan.md`
- Coding standards → `.claude/rules/coding-standards.md`
- Supabase patterns → `.claude/rules/supabase-patterns.md`
- Blog fetch skills → `.claude/skills/blog-fetch.md`
- Component skills → `.claude/skills/new-component.md`

## Folder Map
```
app/                  # Next.js App Router pages
  page.tsx            # Login (Magic Link + Google OAuth)
  dashboard/          # User digest view
  admin/dashboard/    # Admin: user management + digest oversight
  auth/callback/      # Supabase auth callback handler
  api/admin/          # Server-side admin API routes
components/           # Shared React components
lib/supabase/         # Supabase client factories
scripts/              # CI/CD shell scripts
fetch-blogs/          # Blog fetch & AI synthesis module (Python/FastAPI)
```
