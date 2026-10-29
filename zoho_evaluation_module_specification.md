# Zoho Integration & User Task Evaluation Module — Specification & Timeline

---

## 1. Module Overview & Functionalities

This document defines the complete scope and functionality for the new **Zoho Integration & User Task Evaluation Module** within the Creole Knowledge Portal (CKP).

### 1.1 Zoho Data Ingestion & Integration
* **Zoho Free API Integration**: Integrates Zoho Projects REST API via OAuth 2.0 with automated token refresh.
* **Per-User Task Ingestion**: Syncs daily tasks for all CKP users mapped by their Zoho user profile.
* **Task Data Extraction**: Retrieves task title, task description, planned hours, actual logged timesheet hours, and status.
* **Task Comments & Technical Updates**: Ingests all comments, blockers, and notes logged by the user for every task.
* **Direct Zoho Task Link**: Generates a clickable link for each task on the CKP dashboard that opens directly into that specific task in Zoho Projects.

---

### 1.2 Evaluation & Scoring Engine
* **Multi-Parameter Task Evaluation**: Evaluates each task individually based on:
  * **Task Description**: Clarity and scope defined.
  * **Comments & Technical Notes**: Details, PR links, and progress logged by the user.
  * **User Experience Level**: Benchmarked against user seniority (e.g., 1.5 years).
  * **Task Status Compliance**: Verifies whether the user moved the task to **"QA Review"** upon completion.
  * **AI Subscription Context**: Normalizes expectations based on the AI tooling used (ChatGPT Plus, Copilot, Cursor, Antigravity, or None/Free).
  * **Time Taken vs. Planned Hours**: Adherence between estimated and logged time.
* **Time Adherence & Buffer Rules**:
  * **5-Minute Overrun Grace**: If a task is planned for 4 hours and the user spends 4 hours 5 minutes, it does **not** penalize the score.
  * **15-Minute Early Completion Buffer**: A 15-minute gap is allowed. If a user completes a task significantly faster than allocated (e.g., allocated 4 hours, finished in 3 hours 30 minutes), it affects the evaluation score unless justified in the task comments.
* **Repetitive Task Detection**: Detects and penalizes duplicate or repetitive tasks submitted under the same project to ensure genuine work logging.
* **Micro-Evaluation Summary**: Generates a 2–3 line concise AI summary for each task explaining the score and breakdown.
* **Full-Day Evaluation**: Automatically consolidates all task scores at the end of each day into a unified daily score and summary for each user.

---

### 1.3 Admin Evaluation Portal
* **Till-Date Weekly Summary Banner**: Prominently displayed above the user task list, showing:
  * Total Done Tasks.
  * Total Not Done / In-Progress Tasks.
  * Total Delayed Tasks.
  * Overall evaluation parameters and weekly score trend.
  * Updated and refreshed automatically on a weekly basis.
* **Per-User Task List**: Lists all daily tasks with planned vs. actual hours, QA status, and direct Zoho links.
* **Task Detail Drawer / Modal**: Clicking any task opens a detail drawer showing description, logged comments, evaluation score, and AI feedback.
* **Zoho-Style Filter Bar**: Filters evaluations by:
  * Current Week / Last Week.
  * Current Month / Last Month.
  * Custom Date Range.
* **Evaluation Report Generator**: Generates and exports comprehensive evaluation reports for selected users and date ranges.

---

### 1.4 User Evaluation Screen
* **Personal Evaluation View**: Dedicated dashboard where users can see their own daily tasks, time logs, AI evaluation summaries, and weekly performance metrics.
* **Strict Read-Only Permission**: Users can view their data but cannot modify scores, edit criteria, or trigger manual recalculations.

---

## 2. Date-Wise Implementation Timeline (Fast-Track: 29 Oct – 05 Nov 2026)

| Phase | Date & Day | Scope & Key Deliverables |
|---|:---:|---|
| **Phase 1: Backend Foundation & Zoho Sync** | **Thu, 29 Oct 2026** | • Supabase database schema (`zoho_user_mappings`, `zoho_tasks`, `zoho_task_evaluations`, `zoho_daily_summaries`, `zoho_weekly_summaries`) + RLS policies.<br>• Zoho API integration service (OAuth2 refresh flow, sync daily tasks, descriptions, timelogs, comments, direct Zoho task URLs). |
| **Phase 2: Evaluation Engine & Logic** | **Fri, 30 Oct 2026** | • Evaluation & Scoring Engine (5m overrun grace rule, 15m early completion buffer rule, QA Review compliance check).<br>• Repetitive/duplicate task detection algorithm. |
| **Phase 3: AI Micro-Evaluation & Consolidation** | **Mon, 02 Nov 2026** | • Gemini AI micro-evaluation integration (2–3 line task summaries).<br>• Daily and weekly automated score aggregation services.<br>• **Milestone 1**: Complete backend ingestion, evaluation pipeline & database storage ready. |
| **Phase 4: Admin Dashboard & Filters** | **Tue, 03 Nov 2026** | • Admin Dashboard Top KPI Cards (Till-date metrics: Done, Not Done, Delayed tasks, evaluation trends).<br>• Per-user task list, click-to-view detail drawer/modal, and direct Zoho deep links.<br>• Zoho-style filter bar (Current/Last Week, Current/Last Month, Custom Date Range). |
| **Phase 5: User Portal & Report Export** | **Wed, 04 Nov 2026** | • User Read-Only Portal (Personal daily task evaluations, AI summaries, and weekly performance trends with strict read-only lock).<br>• Evaluation report generation and export feature (PDF & CSV summaries). |
| **Phase 6: E2E Testing, BUGBOT & Production Delivery** | **Thu, 05 Nov 2026** | • End-to-end integration & edge-case testing (buffer tolerance tests, duplicate detection tests, API error handling).<br>• BUGBOT Quality Gate audit, documentation update, final code cleanup, and production deployment.<br>• **Milestone 2**: Final production-ready module delivered. |
