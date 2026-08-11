---
title: 'Technical Design: Blog Validation & AI Gatekeeper Module'
tags: [plans, specifications, gatekeeper]
created: 2026-05-27
updated: 2026-06-09
---

# Technical Design: Blog Validation & AI Gatekeeper Module

This document outlines the technical design, architectural interfaces, and implementation plan for the **Blog Validation & AI Gatekeeper Module** in the Creole Knowledge Portal.

---

## 📋 Goal Description

The module provides an automated AI-driven gatekeeping pipeline for user-submitted blogs. It validates content quality, checks for duplicate content, and dynamically generates interactive quizzes to verify the submitter's comprehension before approving posts.

---

## 🏗️ Architecture & Modules

The feature consists of four main layers:

```
┌────────────────────────────────────────────────────────┐
│                      Client Web UI                     │
│    (Gatekeeper Submission Form & Admin Moderation)      │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐        ┌───────────────────────┐
│     AI Validator      │        │    JSON Database      │
│  (Gemini Quality,     │        │     Persistence       │
│  Spam & Quiz Engines)  │        │   (lib/data/db.ts)    │
└───────────────────────┘        └───────────────────────┘
```

### 1. Database & Persistence Layer (`lib/data/db.ts`)

Stores records in a local JSON database file `lib/data/db.json` inside the repository.
Schemas include:

- **Submission**:
  - `id`: unique UUID string.
  - `title`: title of the blog.
  - `content`: full markdown blog post.
  - `author`: email of the user.
  - `status`: `PENDING_QUIZ` | `APPROVED` | `REJECTED_QUIZ` | `REJECTED_AI` | `FLAGGED`.
  - `validationReport`: quality score, AI spam checks, plagiarism similarity overlap.
  - `quiz`: generated questions, correct answers, user selection, score.
- **AuditLog**:
  - `action`: `SUBMITTED` | `AI_VALIDATED` | `QUIZ_TAKEN` | `MODERATOR_APPROVED` | `MODERATOR_REJECTED`.
  - `performedBy`: `system` | user email | admin email.
  - `timestamp`: execution date/time.

### 2. AI Validator Pipeline (`lib/ai/validator.ts`)

Connects to Google Gemini API (model `gemini-2.5-flash`) via `@google/genai` client:

- **Quality check**: Detects gibberish (keyboard mash), low-quality content, and ChatGPT-style AI-spammed text.
- **Plagiarism & Duplication**: Computes Jaccard text similarity against existing local submissions, combined with Gemini semantic overlap checks.
- **Quiz Generation**: Dynamically extracts 3 technical multiple-choice questions from the content with 4 options per question.

### 3. API Routes

- `app/api/submissions/route.ts` (GET/POST): List or create submissions, triggering validation.
- `app/api/submissions/[id]/quiz/route.ts` (POST): Submit quiz answers and grade.
- `app/api/submissions/[id]/moderate/route.ts` (POST): Admin manual override.

### 4. Interactive UI Screens

- **User Page** (`app/dashboard/gatekeeper/page.tsx`): Submission forms, loading checkers, and interactive quiz containers.
- **Admin Dashboard** (`app/admin/dashboard/page.tsx`): Integrates a third tab `Submissions` leveraging a new modular component `SubmissionsModeration`.

---

## 🔒 Verification & Quality Gates

### Automated Checks

- Create unit tests under `lib/ai/validator.test.ts` to assert that validator checks return structured JSON records matching schemas.
- Execute styling compliance:
  ```bash
  npm run format:check
  ```

### Manual Scenarios

1. **Gibberish Input**: Verify that posting random letters flags `gibberishDetected` as true and rejects the request.
2. **Quiz Verification**: Verify that incorrect answers change status to `REJECTED_QUIZ`, while correct answers automatically transition status to `APPROVED`.
3. **Moderator Override**: Verify that the admin dashboard logs changes and updates state.

---

## 🚀 Implementation Status: COMPLETED (2026-06-09)

All planned layers have been successfully implemented and validated:
- **Persistence & Audit Logging**: `lib/data/db.ts` holds file-based mock db operations.
- **AI Pipelines**: `lib/ai/validator.ts` contains Gemini-powered structure filters.
- **API Endpoints**: Submissions, grading, and moderation overrides are operational.
- **Interactive UI**: Gorgeous Tailwind CSS 4 pages are integrated for standard users and administrators.
- **Testing**: Comprehensive unit and integration test suites run with 100% success rate.

