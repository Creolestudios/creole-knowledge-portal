# Zoho Integration & Task Evaluation Module — Implementation Timeline

**Team Parameters:**
- **Resources:** 2 Full-Stack Developers (1.5 Years Experience)
- **Acceleration Tool:** Free Antigravity AI Coding Assistant
- **Mode:** Parallel execution (Dev 1: Backend/API/AI · Dev 2: Frontend/UI/Reporting)
- **Format:** Compact Task Chunk Matrix

---

## Task Chunks & Timeline Matrix

| Task Chunk Name | Functionality in Short | Time (Hours / Days) |
| :--- | :--- | :---: |
| **1. Database Schema & Zoho OAuth Setup** | Create Supabase migrations for Zoho credentials, task store, evaluations, and RLS policies. Implement OAuth 2.0 token refresh utility. | **6 Hours**<br>*(0.75 Day · Dev 1)* |
| **2. Zoho Data Sync Engine (Free API)** | Fetch tasks, timelogs (actual vs planned hours), comments, and status. Build deterministic Zoho task deep-links. Handle rate limits. | **8 Hours**<br>*(1 Day · Dev 1)* |
| **3. Tolerance & Repetition Heuristics** | Implement +5m overtime buffer, 15m early completion gap logic, and project-level Jaccard similarity detector to flag duplicate tasks. | **6 Hours**<br>*(0.75 Day · Dev 1)* |
| **4. Gemini AI Task Evaluator** | Integrate `@google/genai` with structured JSON schema. Evaluate task description, comments, seniority, AI tools, and output score + concise summary. | **8 Hours**<br>*(1 Day · Dev 1)* |
| **5. Daily & Till-Date Aggregator** | Build automated background logic for full-day user evaluation, daily scores, and weekly rolling Till-Date stats (Done, Pending, Delayed). | **6 Hours**<br>*(0.75 Day · Dev 1)* |
| **6. Admin Filter Bar & Layout** | Develop Admin screen layout with Zoho-style filter dropdowns (Week, Month, Custom Date Range) and responsive user listing. | **6 Hours**<br>*(0.75 Day · Dev 2)* |
| **7. Till-Date Summary & Task Cards (Admin)** | Build top summary header (Done, Pending, Delayed, Avg Score) and per-day task accordion with direct clickable Zoho task links. | **8 Hours**<br>*(1 Day · Dev 2)* |
| **8. Task Detail Modal & Report Generator** | Implement task drill-down modal showing comments, hours variance, AI evaluation breakdown, and exportable evaluation report. | **8 Hours**<br>*(1 Day · Dev 2)* |
| **9. User Portal (Read-Only View)** | Create `/dashboard/zoho-evaluation` for employees to view personal Till-Date metrics, daily tasks, AI scores, and coaching tips in read-only mode. | **6 Hours**<br>*(0.75 Day · Dev 2)* |
| **10. Vitest Testing, SonarQube & QA** | Write unit tests for tolerance rules, repetition checks, UI mock states, pass SonarQube quality gate, and verify end-to-end flow. | **8 Hours**<br>*(1 Day · Dev 1 & 2)* |

---

## Parallel Sprint Execution Overview

```
Sprint Days (Total: 5.5 Working Days)
Dev 1 (Backend & AI): [Chunk 1: 0.75d] ➔ [Chunk 2: 1.0d] ➔ [Chunk 3: 0.75d] ➔ [Chunk 4: 1.0d] ➔ [Chunk 5: 0.75d] ➔ [Chunk 10: 0.5d]
Dev 2 (Frontend & UI): [Chunk 6: 0.75d] ➔ [Chunk 7: 1.0d] ➔ [Chunk 8: 1.0d] ➔ [Chunk 9: 0.75d] ➔ [Integration: 0.5d] ➔ [Chunk 10: 0.5d]
```

- **Total Dev Hours (Combined):** ~70 hours
- **Total Project Elapsed Duration:** **5.5 working days** (assuming 2 developers working concurrently with Antigravity assistance).
