# Zoho Task Evaluation — 25 Real-World Scoring Scenarios & Criteria Guide

This guide provides **25 concrete test cases and real-world scenarios** illustrating how the evaluation engine scores task descriptions and comments across different developer experience levels and AI subscriptions, without complex mathematical formulas.

---

## ⚡ Critical Engineering Updates (November 2026)

### 1. Strict Buffer Breach Timing Policy
* **Allowed Buffer**: Up to **+5 minutes overtime** and down to **-15 minutes early**.
* **Strict Overtime Rule**: If actual spent time exceeds planned time by more than 5 minutes (e.g. Planned 3:00 hrs, Actual 3:12 hrs = 7m excess), the time score **immediately drops from 10.0 to a maximum of 8.0 / 10** or lower (scaling down to 2.0 / 10 for larger overruns).
* **Strict Early Completion Gap Rule**: If a task finishes more than 15 minutes earlier than estimated (e.g. Planned 8:00 hrs, Actual 1:36 hrs = 369m gap), the time score **immediately drops to a maximum of 8.0 / 10** and scales down to 2.5 / 10.
* **Unlogged Tasks**: If actual hours are 0, time score is strictly `0.0 / 10` (`NOT_LOGGED`).

### 2. Strict Comment-to-Description Relevance (Topical Alignment)
* **Domain Topic Validation**: The engine tokenizes the task title and description into domain keywords (filtering generic verbs and stop words).
* **Off-Topic Penalization**: If a progress comment discusses completely different deliverables (e.g. task is *"Admin Portal UI Improvements & Tab-Based Routing Fixes"*, but comment discusses *"mail server, SMTP settings, automated email delivery"*):
  - Generic action verbs alone ("updated", "configured", "implemented") **CANNOT** award a high score.
  - The Work Match score is strictly capped at **3.5 – 4.5 / 10** with label `OFF_TOPIC` or `WEAK_ALIGNMENT`.
  - Actionable feedback highlights: *"Comments do not topically align with the assigned task description or requirements. Progress notes must directly substantiate the specific deliverable."*
* **Strong Alignment**: Awarded (8.5 – 10.0 / 10) only when comments contain core topical keywords directly matching the assigned task scope alongside technical verification.

### 3. Task Date Persistence & Historical Backlog Isolation
* **Backlog Tasks**: Open tasks created weeks or months ago retain their genuine historical `created_time` / `last_updated_time`.
* **No Forced Dating**: Open backlog tasks with no timelogs or updates today are **never** stamped with today's date (`YYYY-MM-DD`).
* **Clean Daily View**: On today's date view, only tasks that were created, updated, or logged today appear.

### 4. Single Source of Truth Between Modals
* `ZohoTaskModal` and `ZohoDailyEvaluationModal` share identical scoring logic derived directly from `task.evaluation`.
* Eliminates discrepancies where a task displayed different scores between the daily overview and the task detail modal.

### 5. Pending Scope & Checklist Stamping Penalization (The Navratan Rule)
* **Unfinished Deliverables on Extended Tickets**: When a task has 4–8 hours planned and items are marked "Pending", "Testing is pending", or "Not done" in progress updates:
  - If 4 to 8 hours were logged, leaving deliverables pending without escalating roadblocks early indicates incomplete delivery.
  - The Work Match score is strictly capped at **5.0 – 5.5 / 10** with label `PARTIAL_DELIVERY`.
  - Actionable feedback highlights: *"Resolve Pending Deliverables & Escalate Blockers: Work was logged with items explicitly marked 'Pending' on an extended duration ticket. Fully complete and test deliverables within the allocated timeframe, or proactively escalate blockers during the day rather than closing tasks with pending items."*
* **Checklist Stamping ("Done / Pending")**: Comments that copy description items and suffix them with `- Done` or `- Pending` without technical explanation (no code files, test proofs, or configuration notes) are flagged as checklist updates and capped at **5.0 – 5.2 / 10**.
* **Meeting Hours Segregation**: Meeting hours (e.g. "1Hr of meeting is logged in this task itself") must not be logged inside development feature tickets. The evaluation flags this in *Key Areas to Improve* to separate administrative meetings from technical feature work.

### 6. Developer-Led Testing & Status Lifecycle ("In Progress" & "In QA Review")
* **No Dedicated QA Testers**: In our engineering workflow, developers execute development and self-testing together. There are no separate QA testers.
* **"In Progress"**: Evaluates day-to-day ongoing development, timelog discipline, and daily technical progress comments.
* **"In QA Review"**: When a developer finishes the feature and completes their comprehensive self-testing, they transition the task to **"In QA Review"** with their self-testing verification notes. Formally moving a completed, self-tested task to In QA Review awards a **+0.3 to +0.5 quality bonus** on the composite score.

### 7. Early & Post-Delivery Permutations: Full Complete Comment vs. Less Accurate Comment

| Scenario | Comment Quality & Evidence | Time Score | Work Match Score | Overall Score | What the Engine Evaluates |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Early Delivery (e.g. finished 1h 15m early on 4h task)** | **FULL, COMPLETE & DETAILED**: >50 words, specifies modified files, architecture decisions, and exhaustive self-testing proof (e.g. 12 automated unit tests passing). | **6.8 / 10** | **10.0 / 10** | **8.6 / 10** | **High Quality Preserved**: The deep technical explanation and self-testing prove full delivery. Feedback praises the quality while advising calibration of future estimates. |
| **Early Delivery (e.g. finished 1h 15m early on 4h task)** | **LESS ACCURATE / BRIEF**: "Finished quickly using AI. Done." (<15 words, zero test proof). | **6.8 / 10** | **4.5 / 10** | **5.3 / 10** | **Penalized**: Rushed completion without technical commentary or test verification triggers the unverified velocity penalty. |
| **Post-Delivery / Overdue (e.g. 1h 15m overtime on 4h task)** | **FULL, COMPLETE & DETAILED**: >60 words, details the unexpected edge-case or technical roadblock, root cause analysis, code fix, and self-testing verification. | **6.0 / 10** | **10.0 / 10** | **8.3 / 10** | **Documented Excellence**: While the time buffer was exceeded, the thorough technical documentation justifies the effort and prevents a score collapse. Feedback reminds developer to flag blockers early in task comments. |
| **Post-Delivery / Overdue (e.g. 1h 15m overtime on 4h task)** | **LESS ACCURATE / BRIEF**: "Took longer due to bug. Fixed now." (Zero technical explanation). | **6.0 / 10** | **4.5 / 10** | **5.1 / 10** | **Penalized**: Overtime combined with superficial commentary and lack of blocker escalation results in a poor evaluation score. |

---

## ⏱️ Verbal Time Spent & Score Gap Guide (How Hours & Gaps Affect Points)

This section explains verbally—without algebraic formulas—how the evaluation engine scores time spent based on real-world scenarios:

### 1. The Grace Buffer Window (+5m Overtime / -15m Early)
* **Full Marks (10.0 / 10)**: Every developer is given a reasonable grace window.
  - Up to **5 minutes extra** (e.g., a 4-hour task logged at 4h 05m).
  - Down to **15 minutes early** (e.g., a 4-hour task logged at 3h 45m).
* Finishing anywhere within this window receives a **perfect 10.0 / 10** time score.

### 2. Overtime: How Exceeding the Buffer Costs Points
As soon as actual time exceeds the planned estimate by more than the 5-minute buffer, the 10/10 mark is forfeited immediately and drops to a **baseline maximum of 8.0 / 10**:
* **Small Overrun (10 to 30 minutes over on a 4-hour task)**:
  - *Scenario*: Planned 4:00 hrs, logged 4:20 hrs (15 minutes past the buffer).
  - *Score Cost*: Deducts about 0.5 to 1.0 point, scoring **7.0 to 7.5 / 10**.
* **Moderate Overrun (1 hour over on a 4-hour task, or 2 hours on an 8-hour task)**:
  - *Scenario*: Planned 4:00 hrs, logged 5:00 hrs.
  - *Score Cost*: Deducts about 2.0 to 2.5 points, scoring **5.5 to 6.0 / 10**.
* **Significant Overrun (2 hours over on a 4-hour task, +50% delay)**:
  - *Scenario*: Planned 4:00 hrs, logged 6:00 hrs.
  - *Score Cost*: Deducts about 4.0 points, scoring **4.0 / 10**.
* **Severe Overrun (3+ hours over or taking double the estimated duration)**:
  - *Scenario*: Planned 4:00 hrs, logged 8:00 hrs without prior scope renegotiation.
  - *Score Cost*: Drops to the minimum floor of **2.0 / 10** (`OVERDUE`).

### 3. Early Completion: How Finishing Too Fast Costs Points
Finishing significantly ahead of the estimate is also penalized because completing too early indicates either an inflated estimate or that the developer rushed without performing thorough automated testing, edge-case validation, or QA verification:
* **Slightly Early (30 to 45 minutes early on a 4-hour task)**:
  - *Scenario*: Planned 4:00 hrs, finished in 3h 15m (30 minutes beyond the 15-minute buffer).
  - *Score Cost*: Drops from the 8.0 baseline down to **6.8 to 7.2 / 10**.
* **Moderately Early (1 to 2 hours early on a 4-hour task)**:
  - *Scenario*: Planned 4:00 hrs, finished in 2h 30m.
  - *Score Cost*: Drops to **5.0 to 5.5 / 10**.
* **Severe Rush (Finishing an 8-hour task in 2 or 3 hours without test notes)**:
  - *Scenario*: Planned 8:00 hrs, logged 2:30 hrs without attaching test suites.
  - *Score Cost*: Drops to **2.5 to 3.0 / 10** (`UNEXPECTED_EARLY`).

### 4. Zero Hours Logged (Unlogged Ticket)
* *Scenario*: A task is closed or marked Done, but 0 minutes were recorded in Zoho Projects timelogs.
* *Score Cost*: Strictly **0.0 / 10** (`NOT_LOGGED`). Time logs are mandatory.

---

## 🎯 Scoring Criteria Overview

| Scoring Tier | Score Range | Description Quality | Comment Quality | Impact of Experience & AI Subscriptions |
| :--- | :---: | :--- | :--- | :--- |
| **High Scoring** | **9.0 – 10.0 / 10** | Detailed scope (>40 words), acceptance criteria, technical context. | Technical details, files modified, PR/commit links, test verification, blocker details. | AI tools (Copilot, Cursor, Claude) actively utilized to produce verified code; Junior rewarded for test verification; Senior displays architectural leadership. |
| **Moderate Scoring** | **7.0 – 8.9 / 10** | Clear but brief scope, or detailed scope with minor gaps. | Status updates with some technical context, or detailed comment offsetting brief description. | Senior penalized if comments lack technical depth; AI tools expected to yield cleaner documentation; minor overtime (+10m to +30m) justified by blockers. |
| **Low / Weak Scoring** | **4.6 – 6.9 / 10** | Vague, single-sentence, or copy-pasted scopes. | Superficial comments ("Done", "Fixed"), checklist mirroring with "- Done", no test proof. | High-tier AI tools with inflated time on simple tasks heavily penalized; fast completion without test verification flagged as rushed. |
| **Critical / Failing** | **1.0 – 4.5 / 10** | Completely missing or 1-word description. | **Zero comments logged**, or missing timelog (0h 00m actual logged). | Automatic cap at 4.5/10 enforced when zero comments exist, regardless of developer seniority or AI subscription. |

---

## 🧭 Impact of Experience & AI Subscriptions

1. **Junior Developers (0 – 1 Year)**:
   - Evaluated with higher tolerance for learning curve.
   - Using AI tools (GitHub Copilot, Cursor AI) to scaffold code, write unit tests, and provide clear comments earns maximum bonus.
2. **Mid-Level Developers (2 – 4 Years)**:
   - Expected to deliver punctual tasks with independent troubleshooting notes, PR links, and clear progress logs.
3. **Senior Developers (5+ Years)**:
   - Higher standard for documentation: expected to document architectural decisions, edge cases, and performance considerations. Brief comments trigger larger penalties.
4. **Active AI Subscriptions (Cursor, Copilot, Antigravity, Claude, ChatGPT)**:
   - **Velocity Expectation**: Developers with premium AI subscriptions are expected to finish boilerplate and repetitive tasks faster. Taking excessive time on simple tasks triggers `TIME_INFLATED_FOR_AI_TIER`.
   - **Quality Boost**: When substantive technical comments and test verification are present, active subscriptions earn a **+0.2 to +0.3 quality bonus**.
   - **Verification Requirement**: Completing tasks unusually fast with AI without attaching test evidence triggers `RUSHED_WITHOUT_VERIFICATION`.

---

## 🌟 Tier 1: High Scoring Scenarios (9.0 – 10.0 / 10)

### Case 01: Full-Stack Feature with AI Scaffolding & Unit Tests
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Implement Supabase Row-Level Security for evaluation tables`
* **Timing**: Planned `4:00 hrs` | Logged `4:00 hrs` (Punctual)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Write PostgreSQL Row Level Security (RLS) policies for `zoho_tasks` and `zoho_task_evaluations` tables. Restrict SELECT/UPDATE operations so non-admin users only view their own records, while administrators have full access. Add migration scripts and test policies with pgTAP."
* **Logged Comments**:  
  > "Created migration `20261030_zoho_rls.sql`. Added `auth.is_admin()` helper and applied tenant filters on `zoho_tasks`. Authored 8 automated pgTAP test assertions; verified non-admin token receives 403 on colleague evaluations. Moving task to QA Review."
* **Score**: **9.9 / 10** (High)
* **Why**: Detailed description, rich technical comment citing files and tests, punctual timing, junior properly leveraging Copilot, and moving to QA Review (+0.3 bonus).

---

### Case 02: Complex Architecture Refactor by Senior Engineer
* **Developer Profile**: Senior Backend Engineer (6 yrs exp) | **AI Subscriptions**: Claude Pro
* **Task Title**: `Migrate in-memory session cache to Redis Cluster with sentinel fallback`
* **Timing**: Planned `6:00 hrs` | Logged `5:50 hrs` (Punctual)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Refactor auth session validation to use distributed Redis caching. Implement redis-py connection pooling, cluster node failover handling, and local memory fallback if Redis cluster is unreachable. Verify zero downtime under 500 req/sec load test."
* **Logged Comments**:  
  > "Configured Redis client with exponential backoff and circuit breaker in `lib/redis/cluster.ts`. Ran k6 benchmark maintaining <12ms p95 latency under 600 req/sec. Claude Pro assisted in reviewing thread safety on token eviction. PR #214 opened and passed all integration suites."
* **Score**: **10.0 / 10** (High)
* **Why**: Meets high senior expectations; rich technical commentary with benchmark data; proper AI leverage; QA review bonus.

---

### Case 03: Bug Fix with Tolerated Overrun (+5m) & Root Cause Analysis
* **Developer Profile**: Mid-Level Frontend Dev (3 yrs exp) | **AI Subscriptions**: Cursor AI
* **Task Title**: `Fix candidate video stream freeze during WebRTC renegotiation`
* **Timing**: Planned `2:00 hrs` | Logged `2:05 hrs` (+5 min overrun)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Investigate video track freezing when candidate toggles camera inputs during AI interview session. Ensure peer connection renegotiation correctly replaces sender track without tearing down ICE connection."
* **Logged Comments**:  
  > "Identified race condition in `use-webrtc-stream.ts` where renegotiation was triggered before previous track was stopped. Implemented mutex lock on track replacement. Ran local verification with dual camera devices. Slight 5m overrun to document test edge cases."
* **Score**: **9.9 / 10** (High)
* **Why**: The engine tolerates up to a +5-minute overrun with zero penalty. High technical comment quality and clear root cause explanation.

---

### Case 04: Full-Stack Developer Implementing Feature with Automated End-to-End Self-Testing
* **Developer Profile**: Mid-Level Full-Stack Developer (3 yrs exp) | **AI Subscriptions**: Antigravity Pro
* **Task Title**: `Implement Evaluation Email Dispatch with E2E Self-Testing`
* **Timing**: Planned `4:00 hrs` | Logged `4:00 hrs` (Punctual)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Build the evaluation email dispatch service and author automated end-to-end integration tests covering the full lifecycle: cron trigger, heuristic scoring, digest preview, and email dispatch with error handling. Ensure comprehensive self-testing for edge cases like missing comments and clock format parsing."
* **Logged Comments**:  
  > "Implemented email dispatch service in `lib/email-service.ts`. Authored 16 automated Playwright and Vitest integration tests in `tests/e2e/zoho-evaluation.spec.ts`. Verified all scoring tiers: high, moderate, low, and critical caps. Passed 100% on headless Chromium and Firefox. Moving task to In QA Review with complete verification."
* **Score**: **10.0 / 10** (High)
* **Why**: Comprehensive feature delivery combined with thorough automated self-testing by the developer, verified before handoff. Zero dedicated QA dependency.

---

### Case 05: Tolerated Early Delivery (-15m) with Full Verification
* **Developer Profile**: Mid-Level Developer (2.5 yrs exp) | **AI Subscriptions**: ChatGPT Plus
* **Task Title**: `Add CSV export for daily task evaluation summaries`
* **Timing**: Planned `3:00 hrs` | Logged `2:45 hrs` (15 min early)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Build client-side CSV download action in Zoho evaluation manager. Format columns for Date, Developer, Planned Hours, Actual Hours, Score, and Status."
* **Logged Comments**:  
  > "Built `generateCsvBlob` utility using PapaParse. Added UTF-8 BOM encoding for Excel compatibility. Tested export across Chrome and Edge with 50+ rows. Finished 15 mins early."
* **Score**: **9.8 / 10** (High)
* **Why**: Finishing up to 15 minutes early falls within the zero-penalty efficiency window. Strong verification comments prove work was not rushed.

---

### Case 06: Junior Developer Delivering Without AI (Manual Excellence)
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: None (Free Tier)
* **Task Title**: `Build debounce hook and search filter for candidate roster`
* **Timing**: Planned `3:00 hrs` | Logged `3:00 hrs` (Punctual)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Implement a generic `useDebounce` hook with 300ms delay. Connect hook to candidate search input in `app/admin/candidates/page.tsx` to prevent redundant API queries on every keystroke."
* **Logged Comments**:  
  > "Created `hooks/use-debounce.ts` with cleanup timer on unmount. Connected to candidate filter input and verified network tab shows single API request after typing stops. Added unit test in `use-debounce.test.ts`. Ready for QA."
* **Score**: **9.5 / 10** (High)
* **Why**: Shows that high scores are completely achievable without paid AI tools when comments provide file names, test evidence, and PR readiness.

---

## ⚖️ Tier 2: Moderate Scoring Scenarios (7.0 – 8.9 / 10)

### Case 07: Senior Developer Providing Generic Comments (Missing Architecture Depth)
* **Developer Profile**: Senior Developer (7 yrs exp) | **AI Subscriptions**: ChatGPT Plus
* **Task Title**: `Refactor database connection pool and query optimization`
* **Timing**: Planned `4:00 hrs` | Logged `4:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "Analyze slow queries on `zoho_task_evaluations` table. Add composite indexes on `(user_id, task_date)` and tune PgBouncer connection pooling limits to handle concurrent sync cron jobs."
* **Logged Comments**:  
  > "Optimized queries and updated pool settings. Everything works fine and closed."
* **Score**: **7.6 / 10** (Moderate)
* **Why**: For a 7-year senior with ChatGPT Plus, a 10-word generic comment without index names, execution plan changes, or PR links triggers a moderate alignment penalty.

---

### Case 08: High Technical Quality with Moderate Overtime (+25m) & Blocker Explanation
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: Cursor AI
* **Task Title**: `Integrate OAuth2 SSO with Google Workspace`
* **Timing**: Planned `4:00 hrs` | Logged `4:25 hrs` (+25 min overtime)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Implement Google OAuth 2.0 PKCE authentication flow for enterprise domains. Enforce email domain restriction to `@creolestudios.com` only. Handle refresh token rotation and session revocation."
* **Logged Comments**:  
  > "Encountered OAuth client consent mismatch on staging redirect URI which stalled testing by 20m. Fixed URI in Google Cloud Console. PKCE flow completed with state verification in `lib/auth/google.ts`. Unit tests passing."
* **Score**: **8.6 / 10** (Moderate)
* **Why**: Overtime past the 5m buffer incurs a slight time penalty, but the detailed comment explaining the blocker protects the comment score.

---

### Case 09: Brief Description Rescued by Detailed Technical Comments
* **Developer Profile**: Full Stack Developer (2 yrs exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Update user profile settings`
* **Timing**: Planned `2:00 hrs` | Logged `2:00 hrs` (Punctual)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Update user profile settings page." *(6 words — Brief)*
* **Logged Comments**:  
  > "Added multi-select dropdown for `ai_subscriptions`, added toggle for daily email digest, created Supabase schema migration `20261102_user_subs.sql`, and validated inputs using Zod. Unit tests pass in `profile.test.ts`."
* **Score**: **8.4 / 10** (Moderate)
* **Why**: The description is brief (<40 words), but the developer thoroughly documented files, migrations, and test results in comments.

---

### Case 10: Unexpected Early Finish (Finished 45m Early on 3h Task)
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Add pagination to Zoho projects table`
* **Timing**: Planned `3:00 hrs` | Logged `2:15 hrs` (45 min early)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Implement server-side pagination with next/prev buttons and page size selector (10, 25, 50) for the Zoho projects table."
* **Logged Comments**:  
  > "Used GitHub Copilot to quickly generate pagination controls and URL query state sync in `components/zoho/pagination.tsx`. Tested with 120 items and confirmed page bounds."
* **Score**: **7.8 / 10** (Moderate)
* **Why**: Finishing 45 minutes early exceeds the 15-minute buffer, indicating minor estimation padding. However, solid comments and verification keep the score in the high 7s.

---

### Case 11: Repetitive Task Scope in Same Project (>65% Token Overlap)
* **Developer Profile**: Frontend Developer (2 yrs exp) | **AI Subscriptions**: None
* **Task Title**: `Update button styles and border colors on login modal`
* **Timing**: Planned `2:00 hrs` | Logged `2:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "Update button styling, padding, and border radius on the login modal to align with updated design system tokens."
* **Logged Comments**:  
  > "Updated Tailwind classes on `LoginForm.tsx` and verified button states on hover and focus."
* **Score**: **7.0 / 10** (Moderate)
* **Why**: Repetition detector flags high similarity (>65%) to two previous styling tickets this week. Deducts originality points.

---

### Case 12: High Technical Quality but Closed Directly (Skipped QA Review)
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: Antigravity Pro
* **Task Title**: `Implement webhook signature verification for Zoho Projects`
* **Timing**: Planned `4:00 hrs` | Logged `4:00 hrs` (Punctual)
* **Status**: `Closed` *(Bypassed QA Review)*
* **Task Description**:  
  > "Implement HMAC-SHA256 signature verification on `/api/webhooks/zoho` route. Reject requests with invalid signatures or timestamps older than 5 minutes."
* **Logged Comments**:  
  > "Implemented constant-time crypto comparison in `lib/zoho/webhook-auth.ts`. Added unit tests for replay attacks and tampered payloads. Directly deployed and closed."
* **Score**: **8.8 / 10** (Moderate)
* **Why**: High quality description and comments, but missed the +0.3 to +0.5 bonus by directly closing the task instead of moving to `In QA Review`.

---

### Case 13: Heavy Overtime (+1h 45m) with Documented Third-Party Outage
* **Developer Profile**: Senior Backend Developer (5 yrs exp) | **AI Subscriptions**: Cursor AI
* **Task Title**: `Integrate Resend transactional email API for evaluation digests`
* **Timing**: Planned `4:00 hrs` | Logged `5:45 hrs` (+1h 45m overtime)
* **Status**: `In QA Review`
* **Task Description**:  
  > "Implement Resend API client to send HTML evaluation digests to senior reviewers. Add retry logic with exponential backoff on 429 rate limit errors."
* **Logged Comments**:  
  > "Encountered upstream DNS outage on Resend staging sandbox resulting in 503 errors for 90 minutes. Documented incident in status link, added fallback logging, and completed retry queue logic. All tests pass."
* **Score**: **7.7 / 10** (Moderate)
* **Why**: Overdue by 1h 45m lowers the time score, but the incident notes and workaround prevent the comment score from dropping.

---

## ⚠️ Tier 3: Low / Weak Scoring Scenarios (4.6 – 6.9 / 10)

### Case 14: Checklist Copy-Paste Comment (Description Mirrored with "- Done")
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Setup Redis caching for daily digest endpoint`
* **Timing**: Planned `4:00 hrs` | Logged `4:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "1. Install redis client package.  
  > 2. Add connection pooling helper in `lib/redis.ts`.  
  > 3. Cache latest digest endpoint with 15-minute TTL.  
  > 4. Test cache invalidation on new digest creation."
* **Logged Comments**:  
  > "1. Install redis client package - Done  
  > 2. Add connection pooling helper in `lib/redis.ts` - Done  
  > 3. Cache latest digest endpoint with 15-minute TTL - Done  
  > 4. Test cache invalidation on new digest creation - Done"
* **Score**: **6.6 / 10** (Low)
* **Why**: Checklist detection heuristic flags comments that mirror the description with `<15` novel technical words. Lacks explanation of how features were built or tested.

---

### Case 15: Single-Word Comment on Multi-Hour Task ("Fixed")
* **Developer Profile**: Mid-Level Developer (2 yrs exp) | **AI Subscriptions**: ChatGPT Plus
* **Task Title**: `Investigate memory leak in WebSocket connection handler`
* **Timing**: Planned `3:00 hrs` | Logged `3:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "Profile memory consumption during active audio streaming sessions. Identify uncollected listeners on socket disconnections and ensure garbage collection frees buffers."
* **Logged Comments**:  
  > "Fixed."
* **Score**: **6.1 / 10** (Low)
* **Why**: A 3-hour complex technical ticket documented with only a single word ("Fixed") yields a heavy superficial comment penalty (4.0/10 comment score).

---

### Case 16: Vague Description + Superficial Comment ("Fix bug" / "Done")
* **Developer Profile**: Mid-Level Developer (2 yrs exp) | **AI Subscriptions**: None
* **Task Title**: `Fix portal bug`
* **Timing**: Planned `2:00 hrs` | Logged `2:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "Fix the bug reported by client on the portal." *(9 words — Vague)*
* **Logged Comments**:  
  > "Done and resolved." *(3 words — Superficial)*
* **Score**: **6.4 / 10** (Low)
* **Why**: Both description and comment lack technical substance. Time is punctual, but evaluator has zero proof of what code changed.

---

### Case 17: Severe Early Rush (Finished in 1h of 4h Planned) Without Test Proof
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: Cursor AI
* **Task Title**: `Implement RBAC permission middleware for 12 admin routes`
* **Timing**: Planned `4:00 hrs` | Logged `1:00 hrs` (3 hours early)
* **Status**: `Closed`
* **Task Description**:  
  > "Create Next.js middleware rules to restrict `/api/admin/*` endpoints to users with `admin` role. Ensure token extraction handles bearer tokens and secure cookies."
* **Logged Comments**:  
  > "Used Cursor AI to quickly write the middleware rules. Finished quickly."
* **Score**: **5.5 / 10** (Low)
* **Why**: Triggers `RUSHED_WITHOUT_VERIFICATION` penalty. Taking only 25% of planned time on a sensitive security task without attaching unit test verification.

---

### Case 18: Time-Inflated Task for AI-Equipped Senior Developer
* **Developer Profile**: Senior Developer (6 yrs exp) | **AI Subscriptions**: Antigravity Pro & Cursor AI
* **Task Title**: `Add boolean column to user preferences table`
* **Timing**: Planned `4:00 hrs` | Logged `5:30 hrs` (+1h 30m overtime)
* **Status**: `Closed`
* **Task Description**:  
  > "Add `daily_digest_enabled` boolean column to `user_profiles` table with default true, and expose it in user settings."
* **Logged Comments**:  
  > "Added column and updated user settings form."
* **Score**: **5.1 / 10** (Low)
* **Why**: Triggers `TIME_INFLATED_FOR_AI_TIER`. A senior engineer equipped with top-tier AI tools taking 5.5 hours for a single column and form checkbox without documented blockers.

---

### Case 19: Repetitive Task + Unjustified Overdue (+45m)
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: None
* **Task Title**: `Update CSS padding on modal header`
* **Timing**: Planned `1:00 hrs` | Logged `1:45 hrs` (+45 min overtime)
* **Status**: `Closed`
* **Task Description**:  
  > "Adjust header padding from 16px to 24px on candidate summary modal."
* **Logged Comments**:  
  > "Updated classes."
* **Score**: **5.3 / 10** (Low)
* **Why**: Cumulative penalties: high task repetition (low originality) + 75% overtime + brief 2-word comment.

---

### Case 20: Extreme Overrun (Double Planned Time) Without Technical Details
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Create summary card component for task metrics`
* **Timing**: Planned `4:00 hrs` | Logged `8:00 hrs` (+4h 00m overtime / 200% time)
* **Status**: `Closed`
* **Task Description**:  
  > "Build responsive KPI card component displaying Completed Tasks, In Progress Tasks, and Average Score."
* **Logged Comments**:  
  > "Took longer than expected due to CSS issues. Finally completed."
* **Score**: **5.8 / 10** (Low)
* **Why**: Taking double the planned hours with only a generic "CSS issues" explanation severely penalizes the time adherence score.

---

## 🛑 Tier 4: Critical / Failing Scenarios (1.0 – 4.5 / 10)

### Case 21: The Missing Comment Trap (Detailed Description + Punctual Time + 0 Comments)
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: GitHub Copilot
* **Task Title**: `Task Automation & Evaluation cron job setup`
* **Timing**: Planned `8:00 hrs` | Logged `8:15 hrs` (Punctual)
* **Status**: `Completed` / `In QA Review`
* **Task Description**:  
  > "Implement a scheduled cron job to automatically fetch task information for every user from Zoho, including task details, status, assigned users, and associated comments. Configure scheduled execution to ensure regular synchronization of task information and comments with the database. Add error handling for API failures, missing task information, and timelog accuracy. Define and implement evaluation criteria for assessing task completion, work quality, and timelog accuracy."
* **Logged Comments**:  
  > *(Zero comments logged in Zoho Projects)*
* **Score**: **4.5 / 10** (Critical)
* **Why**: Comments represent 45% of the evaluation. Without comments, there is zero technical audit trail proving what code was written. The system enforces an **automatic cap of 4.5/10**.

---

### Case 22: Senior Developer with Premium AI Tools Logging Zero Comments
* **Developer Profile**: Senior Lead (7 yrs exp) | **AI Subscriptions**: Cursor AI + Antigravity Pro
* **Task Title**: `Architecture design and database schema overhaul for evaluation engine`
* **Timing**: Planned `6:00 hrs` | Logged `6:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > "Redesign Postgres schema to support weighted heuristic scoring, historical task similarity caching, and AI subscription metadata tracking. Provide migration rollback scripts."
* **Logged Comments**:  
  > *(Zero comments logged in Zoho Projects)*
* **Score**: **4.2 / 10** (Critical)
* **Why**: Seniority and premium AI subscriptions do not waive the documentation requirement. Capped strictly at 4.2/10 due to missing audit trail.

---

### Case 23: Detailed Description & Detailed Comments BUT Zero Hours Logged (0:00)
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: Claude Pro
* **Task Title**: `Implement Redis Pub/Sub event bus for live interview alerts`
* **Timing**: Planned `3:00 hrs` | Logged **`0:00 hrs`** (Not Logged)
* **Status**: `Closed`
* **Task Description**:  
  > "Configure Redis Pub/Sub channels for interview state changes: candidate connected, audio stream degraded, and interview ended. Handle automatic reconnection."
* **Logged Comments**:  
  > "Built `lib/events/redis-bus.ts`. Added heartbeat ping every 15s to keep connections alive. Verified across two simulated worker processes. PR #119 opened."
* **Score**: **4.9 / 10** (Critical)
* **Why**: Time Adherence score is **0.0 / 10** because actual logged hours are 0. Even with great comments, unlogged hours cripple the composite score.

---

### Case 24: Missing Description AND Zero Comments (Punctual Timelog Only)
* **Developer Profile**: Junior Developer (1 yr exp) | **AI Subscriptions**: None
* **Task Title**: `Quick fixes`
* **Timing**: Planned `3:00 hrs` | Logged `3:00 hrs` (Punctual)
* **Status**: `Closed`
* **Task Description**:  
  > *(Empty / Blank)*
* **Logged Comments**:  
  > *(Zero comments logged in Zoho Projects)*
* **Score**: **3.8 / 10** (Critical)
* **Why**: Zero description + zero comments. Only punctual time points are scored; proof of work is completely absent.

---

### Case 25: Absolute Worst-Case Combination
* **Developer Profile**: Mid-Level Developer (3 yrs exp) | **AI Subscriptions**: None
* **Task Title**: `Update`
* **Timing**: Planned `4:00 hrs` | Logged **`0:00 hrs`** (Not Logged)
* **Status**: `Closed`
* **Task Description**:  
  > "Do updates." *(2 words — Vague)*
* **Logged Comments**:  
  > *(Zero comments logged in Zoho Projects)*
* **Repetition**: Repeated 3 times in project
* **Score**: **1.0 / 10** (Minimum System Floor)
* **Why**: Triggers every single penalty in the engine: 0 hours logged, 0 comments, vague description, and repetitive scope. Hits the absolute minimum score floor.

---

## 📋 Quick Reference: Description & Comment Matrix

| Input Element | High Scoring Pattern (9.0 – 10.0) | Moderate Scoring Pattern (7.0 – 8.9) | Low Scoring Pattern (4.6 – 6.9) | Critical / Failing Pattern (1.0 – 4.5) |
| :--- | :--- | :--- | :--- | :--- |
| **Description** | >40 words, concrete objectives, schema/API details, acceptance criteria. | 20–40 words, general scope with clear deliverable. | <15 words ("fix bug", "update UI"), no technical context. | Empty / blank, or 1–2 ambiguous words ("update"). |
| **Comments** | Concrete file paths, PR numbers, unit test assertion counts, blocker details. | Summary of changes with 1–2 technical terms, brief status note. | "Fixed", "Done", single-word, or mirrored checklist with "- Done". | **Zero comments logged.** |
| **Experience** | Junior: rewarded for test evidence; Senior: rewarded for architectural depth. | Junior: minor delay tolerated; Senior: brief comments marked down. | Senior: simple task taking too long flagged for time inflation. | Experience does not waive comment or timelog requirements. |
| **AI Tools** | Boost awarded when AI assists in generating tested, documented code. | Expected to accelerate execution without sacrificing clarity. | Fast completion without tests flagged as rushed. | Having AI tools while logging 0 comments yields critical score. |
