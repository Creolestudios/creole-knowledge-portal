**Blog Roulette — Implementation Status**

- **Summary:** This document maps the PDF "Blog Roulette — Final Flow" (v1.0) sections to the repository implementation, marking each step as: Done / Partially Done / Not Done / Stale / Issue. It also lists known problems and next actions.

**End-to-End Flow (PDF) — Status**

- **Step 1 — Authentication:** Partially Done
  - Status: UI and auth flows use Supabase auth (magic-link) and are wired into the Blog Roulette pages. See [app/blog-roulette/page.tsx](app/blog-roulette/page.tsx#L1-L400) and Supabase client usage across the module.
  - Note: PDF expects corporate SSO; repository uses Supabase. If SSO (SAML/OIDC) is required, an integration change is needed.

- **Step 2 — Intent (Start New Blog):** Done
  - Status: "Start New Blog" flows and `new` route exist. See [app/blog-roulette/new/page.tsx](app/blog-roulette/new/page.tsx#L1-L200).

- **Step 3 — Title + SEO Keyword Suggestions:** Done
  - Status: SEO suggestion API and helper exist. See [lib/blog-roulette/seo.ts](lib/blog-roulette/seo.ts#L1-L200) and the route [app/api/blog-roulette/seo-suggest/route.ts](app/api/blog-roulette/seo-suggest/route.ts#L1-L200).

- **Step 4 — Draft (Editor, live preview, autosave, images, mermaid):** Mostly Done
  - Status: Editor pages, preview pane with Mermaid support, image upload API, and autosave hooks are implemented in the editor and preview components: [app/blog-roulette/%5Bid%5D/edit/page.tsx](app/blog-roulette/%5Bid%5D/edit/page.tsx#L1-L700), [components/blog-roulette/preview-pane.tsx](components/blog-roulette/preview-pane.tsx#L1-L400), and upload route [app/api/blog-roulette/upload/route.ts](app/api/blog-roulette/upload/route.ts#L1-L200).
  - Notes: Editor choice was implemented in-place; MDX/Tiptap decision has been settled in code. Image storage leverages Supabase storage.

- **Step 5 — Pre-Submit Checklist Gate:** Done
  - Status: Checkpoint validation implemented in [lib/blog-roulette/validators.ts](lib/blog-roulette/validators.ts#L1-L300) and displayed by [components/blog-roulette/checklist-sidebar.tsx](components/blog-roulette/checklist-sidebar.tsx#L1-L200). Submit route exists at [app/api/blog-roulette/%5Bid%5D/submit/route.ts](app/api/blog-roulette/%5Bid%5D/submit/route.ts#L1-L200).

- **Step 6 — AI Vetting Quiz (generate 3 Qs, timed, grader):** Done (with fallbacks)
  - Status: Quiz generation and submission endpoints exist: [app/api/blog-roulette/%5Bid%5D/quiz/generate/route.ts](app/api/blog-roulette/%5Bid%5D/quiz/generate/route.ts#L1-L220) and [app/api/blog-roulette/%5Bid%5D/quiz/submit/route.ts](app/api/blog-roulette/%5Bid%5D/quiz/submit/route.ts#L1-L240). Frontend quiz pages implemented at [app/blog-roulette/%5Bid%5D/quiz/page.tsx](app/blog-roulette/%5Bid%5D/quiz/page.tsx#L1-L520).
  - Notes: LLM-powered generation/grading uses `lib/blog-roulette/gemini-client.ts` with rule-based fallbacks when API keys are missing. The retry policy is present (see `BLOG_RULES.QUIZ_RETRY_LIMIT` in [lib/blog-roulette/types.ts](lib/blog-roulette/types.ts#L1-L200)) and unlock endpoint exists.

- **Step 7 — Auto-Publish (Pandoc → .docx → Drive) + Marketing notify:** Partially Done / Stale
  - Status: Publishing pipeline is implemented and live: [lib/blog-roulette/publisher.ts](lib/blog-roulette/publisher.ts#L1-L240) calls Drive helpers in [lib/blog-roulette/google-drive.ts](lib/blog-roulette/google-drive.ts#L1-L300). The `POST /api/blog-roulette/:id/publish` route exists at [app/api/blog-roulette/%5Bid%5D/publish/route.ts](app/api/blog-roulette/%5Bid%5D/publish/route.ts#L1-L200).
  - Important change vs PDF: The repository uses Drive's native HTML → Google Doc conversion (see `uploadBlogAsGoogleDoc`) instead of the PDF's Pandoc → .docx step. `lib/blog-roulette/converter.ts` (pandoc helper) exists but is currently unused/stale.
  - Issue: DB migration adding `drive_url`/`drive_file_id` exists in repo notes but may not be applied to remote DB automatically (see [wiki/logs/2026-07-04.md](wiki/logs/2026-07-04.md#L1-L40)).

- **Step 8 — Portal State Update (status, logs, badge, leaderboard, notify author):** Done
  - Status: Status transitions, publish logs, and leaderboard badge awarding exist and are wired in [lib/blog-roulette/publisher.ts](lib/blog-roulette/publisher.ts#L1-L240) and DB types in [lib/blog-roulette/types.ts](lib/blog-roulette/types.ts#L1-L200). UI reflects statuses in [app/blog-roulette/page.tsx](app/blog-roulette/page.tsx#L1-L400).

**Other PDF items / System-wide notes**

- Database schema: The repo defines schema fields and rules in code ([lib/blog-roulette/types.ts](lib/blog-roulette/types.ts#L1-L200)). SQL migration files referenced by the feature branch appear in `supabase/migrations/` (search migration names containing "blog_roulette"). Confirm migrations are applied to the production Supabase project.

- SEO APIs: Implemented in `lib/blog-roulette/seo.ts` with route `seo-suggest` mentioned above.

- AI detection: Implemented (`lib/blog-roulette/ai-detection.ts`) and exposed via API route [app/api/blog-roulette/%5Bid%5D/ai-score/route.ts](app/api/blog-roulette/%5Bid%5D/ai-score/route.ts#L1-L120). Note: relies on external LLM/embedding provider keys or fallback heuristics.

**Known Issues / Wrong / Stale items**

- Pandoc + .docx publish step in PDF is stale: repo moved to Drive-native HTML import. See [lib/blog-roulette/google-drive.ts](lib/blog-roulette/google-drive.ts#L1-L300) and [wiki/logs/2026-07-04.md](wiki/logs/2026-07-04.md#L1-L40).
- Migration not applied: migration that adds `drive_url`/`drive_file_id` is present in repo notes but may not be applied to remote DB — manual run required (see logs). This can cause UI to not show Drive links until DB is migrated.
- Auth mismatch: PDF says SSO; repo uses Supabase auth. If corporate SSO is required, that needs design/implementation work.
- Controlled tag vocabulary: The PDF requires tags from a controlled vocab; there is no obvious tag-management file or UI. This item appears NOT DONE.
- External keys & rate limits: Gemini/Google Drive API usage requires env vars (e.g., `DRIVE_SERVICE_ACCOUNT_KEY`, `MARKETING_NOTIFY_EMAILS`, Gemini keys). If missing, code falls back to rule-based generators/graders; confirm keys in environment for production.

**Quick file references (key files)**

- UI list & entry: [app/blog-roulette/page.tsx](app/blog-roulette/page.tsx#L1-L400)
- Editor & edit flow: [app/blog-roulette/%5Bid%5D/edit/page.tsx](app/blog-roulette/%5Bid%5D/edit/page.tsx#L1-L700)
- Quiz UI: [app/blog-roulette/%5Bid%5D/quiz/page.tsx](app/blog-roulette/%5Bid%5D/quiz/page.tsx#L1-L520)
- Preview component: [components/blog-roulette/preview-pane.tsx](components/blog-roulette/preview-pane.tsx#L1-L400)
- Checklist & validators: [components/blog-roulette/checklist-sidebar.tsx](components/blog-roulette/checklist-sidebar.tsx#L1-L200) / [lib/blog-roulette/validators.ts](lib/blog-roulette/validators.ts#L1-L300)
- Publish pipeline: [lib/blog-roulette/publisher.ts](lib/blog-roulette/publisher.ts#L1-L240) / [lib/blog-roulette/google-drive.ts](lib/blog-roulette/google-drive.ts#L1-L300)
- SEO: [lib/blog-roulette/seo.ts](lib/blog-roulette/seo.ts#L1-L200)
- AI detection: [lib/blog-roulette/ai-detection.ts](lib/blog-roulette/ai-detection.ts#L1-L200)

**Next actions / Recommendations**

- Confirm whether corporate SSO is required and, if so, plan SSO integration (Supabase -> SAML/OIDC or replace authentication flows).
- Apply pending Supabase migrations to the target environment (or document manual steps). Without this, `drive_url`/`drive_file_id` may be missing on published records.
- If the Pandoc→.docx path is still desired, either re-enable `converter.ts` (install `pandoc` in the runtime image) or accept the Drive-native approach and remove `converter.ts` to avoid confusion.
- Add a controlled tag-vocabulary management UI or store if the product requires curated tags.

Document created from repository inspection on 2026-08-13.
