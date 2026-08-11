# Coding Standards

## TypeScript
- Strict mode is ON — never use `any` without a comment explaining why
- Use Pydantic-style discriminated unions over loose `string | undefined`
- Export types/interfaces from the file they describe — no barrel re-exports unless intentional
- Prefer `type` over `interface` for pure shapes; use `interface` when extending

## React / Next.js
- Server Components default. Add `'use client'` only for: hooks, event handlers, browser APIs
- Data fetching in Server Components via `async/await` — no `useEffect` for initial loads
- Error boundaries belong at the route segment level (`error.tsx`)
- Loading UI lives in `loading.tsx`, not inside page components
- All interactive elements need a unique `id` attribute (for browser testing)
- Use `motion` (Framer Motion) for animations — already installed as `motion/react`

## Styling
- Tailwind CSS 4 — utility classes in JSX, no inline `style` unless for dynamic values
- Brand colour token: `bg-brand`, `text-brand`, `shadow-brand` (defined in globals.css)
- Dark panels use `bg-[#0a0a0a]` + `text-white`; light panels use `bg-[#f8f9fa]`
- Icon library: `lucide-react` only

## File Naming
- Pages: `page.tsx` (Next.js convention)
- Components: PascalCase (`UserManagement.tsx`)
- Utilities: camelCase (`utils.ts`)
- Hooks: `use` prefix (`useDigest.ts`)

## Imports
- Use path alias `@/` for all non-relative imports
- Order: external libs → internal `@/lib` → internal `@/components` → local

## Error Handling
- API routes: always return `{ error: string }` on failure with appropriate HTTP status
- Client components: show user-facing messages via `error` state, log technical details to console
- Never expose stack traces or internal errors to the browser

## Testing
- Test runner: Vitest
- Test files: `*.test.ts` or `*.test.tsx` co-located with the module
- Mock external HTTP calls — never hit real Supabase/Gemini in unit tests
- Run with: `npm run test`

## Git
- Commit messages: imperative present tense ("Add digest card component")
- Never commit: `.env.local`, `reports/`, `node_modules/`, `.next/`
