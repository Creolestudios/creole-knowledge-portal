---
name: blog-roulette-flow
description: End-to-end operational flow for the Blog Roulette platform
metadata:
  type: project
---

# Blog Roulette Flow

Based on the `BLOG_ROULETTE_FLOW.docx` specification, the Blog Roulette platform follows this E2E flow:

1. **Authentication**: SSO via CKP portal.
2. **Intent**: "Write Blog" dashboard trigger.
3. **SEO**: Title -> Keyword suggestions (Google Autocomplete/Trends).
4. **Drafting**: Markdown editor with live sidebar validation (word count, code blocks, diagrams).
5. **Checklist Gate**: Automatic validation of constraints before submission.
6. **AI Vetting**: LLM-generated quiz (3 deep questions) to verify human authorship.
7. **Publishing**: Markdown -> Pandoc -> .docx -> Google Drive API (share with marketing team).
8. **State Management**: Lifecycle state machine (DRAFT -> SUBMITTED -> QUIZ -> PUBLISHED/REJECTED).

## Technology Stack
- Next.js 15, TypeScript
- MDXEditor/Tiptap/Monaco
- PostgreSQL, Redis
- Local Llama-3 / Mistral (Vetting)
- Google Drive API v3
- Pandoc

## Database
- Tables: `blogs`, `seo_keywords`, `blog_tags`, `quiz_attempts`, `publish_logs`, `leaderboard`.

## Open Items
- Editor selection (MDXEditor vs Tiptap vs Monaco).
- Quiz lockout policy.
- Tag vocabulary control.
- Badge system design (Single vs Tiered).
