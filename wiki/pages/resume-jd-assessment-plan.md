---
title: 'Technical Design: Student Mock Interview / Assessment (Resume + JD, One-Time Link)'
tags: [plans, specifications, assessment, proctoring, interview, quiz, students]
created: 2026-09-08
updated: 2026-09-08
---

# Technical Design: Student Mock Interview / Assessment Module

> **Status:** Planning only — do **not** implement application code until Phase 0 open questions are closed and this plan is signed off.

**How to read this doc**

1. **Tools + how they work (§0)** — parsers, supervision, scoring  
2. **Whole FE/BE flow** — Admin vs student paths  
3. **Features** — what we build  
4. **How to implement** — build order, APIs, data, files  

Related existing work: `components/quiz/quiz-runner.tsx`, `lib/quizzes/proctor.ts`, `supabase/migrations/20260907120000_create_quiz_proctor_storage.sql`, `lib/ai/quiz-generator.ts`.

---

## Goal (one paragraph)

Admin upload a **student resume** + **JD**. The system analyzes **experience vs JD requirements**, then issues a **one-time link**. The **student** opens that link **once**, chooses **Quiz / Interview / Both**, reads **all instructions**, completes a **fully proctored** session (screen share, webcam, eye movement, hand gestures, face count, background noise, tab switching) with **real-time alerts** (after **2–3 alerts → auto-terminate**). On success or terminate, the student only sees: **“Your test is submitted. We will come back to you in sometime.”** Scores (performance + English proficiency + integrity) are visible **only to Admin**, not to the student.

---

## Actors

| Actor | Role |
|-------|------|
| **Admin** | Uploads resume + JD; generates one-time student link; later reviews results |
| **Student** | Opens one-time link; picks mode; follows instructions; takes supervised test; gets submit confirmation only |

---

# 0. What We Use — Tools List + How Each Works (Steps)

This is the full toolbox for **parsing**, **supervision/proctoring**, and **rest of implementation**. Nothing here is coded yet — plan only.

## 0.1 Master tool list (by job)

| # | Job | Tool / library | Runs where |
|---|-----|----------------|------------|
| 1 | Store resume/JD files | **Supabase Storage** (private bucket) | Backend |
| 2 | Parse PDF text | **`pdf-parse` or `unpdf`** (Node) | Backend |
| 3 | Parse DOCX text | **`mammoth`** | Backend |
| 4 | Structure experience vs JD | **Google Gemini** (`@google/genai`, server key) | Backend |
| 5 | Generate quiz / interview questions | **Google Gemini** | Backend |
| 6 | Grade quiz / interview performance | **Rules (MCQ) + Gemini** (open / spoken) | Backend |
| 7 | English proficiency + fluency | **Web Speech API** (STT) + **Gemini** rubric + client fluency math | Browser + Backend |
| 8 | One-time invite link | **Opaque token** (hash in Postgres) + **httpOnly session cookie** | Backend |
| 9 | App UI + APIs | **Next.js 15 App Router** + React + TypeScript | Full stack |
| 10 | Auth for Admin | **Supabase Auth** (existing magic link / Google) | Backend / middleware |
| 11 | Database | **Supabase Postgres** + RLS | Backend |
| 12 | Screen share lock | **`navigator.mediaDevices.getDisplayMedia`** | Browser |
| 13 | Webcam lock | **`navigator.mediaDevices.getUserMedia` (video)** | Browser |
| 14 | Mic (interview) | **`getUserMedia` (audio)** | Browser |
| 15 | Face count (1 person) | **MediaPipe Face Detector** (`@mediapipe/tasks-vision`) | Browser |
| 16 | Eye / gaze movement | **MediaPipe Face Landmarker** | Browser |
| 17 | Hand gestures | **MediaPipe Hands** (or Holistic) | Browser |
| 18 | Background noise | **Web Audio API** (`AnalyserNode`) + simple **VAD** | Browser |
| 19 | Tab switching | **`visibilitychange` / `blur` / `pagehide`** | Browser |
| 20 | Real-time alerts + auto-stop | Custom **alert bus** + server `alert_count` | Browser + Backend |
| 21 | Optional later recording | **`MediaRecorder`** → private Storage | Browser → Backend |

Reuse from this repo where possible: `lib/quizzes/proctor.ts` (screen/cam), Gemini patterns in `lib/ai/quiz-generator.ts`.

---

## 0.2 Parser stack — how it works (steps)

**Goal:** Turn resume + JD files into structured “experience vs JD” data.

```
1. Admin uploads resume (PDF/DOCX) + JD (PDF/DOCX or paste)
2. Backend saves raw files to private Supabase Storage
3. Backend downloads bytes and picks extractor by MIME:
     PDF  → pdf-parse / unpdf  → plain text
     DOCX → mammoth            → plain text
     paste → use string as-is
4. Backend sends both texts to Gemini with a JSON schema prompt
5. Gemini returns:
     - candidate experience (YOE, skills, highlights)
     - JD requirements (must-have, nice-to-have, seniority)
     - skill_gap (strong / partial / missing)
6. Backend stores JSON on `assessments` row
7. Admin sees gap preview → then generate questions / invite link
```

**If PDF has no text (scanned image):** v1 plan = ask Admin for a text PDF or pasted text (no OCR in v1).

---

## 0.3 Question generation & scoring — how it works (steps)

```
1. Backend loads skill_gap + YOE + JD must-haves
2. Gemini generates:
     - Quiz bank (MCQ / conceptual / code / descriptive), and/or
     - Interview bank (spoken turns with intent tags)
3. Questions saved in DB (student never sees generation UI)
4. During quiz:
     - MCQ → scored by exact/set match on server
     - Open/code → Gemini semantic grader
5. During interview:
     - Student speaks → browser STT (Web Speech API) → transcript
     - Optional P1: audio chunk → Gemini transcription if STT weak
6. On finish (server only):
     - Performance scores from answers
     - English proficiency (Gemini on transcripts)
     - Fluency (WPM, pauses, fillers from VAD timing + transcript)
7. Student API returns ONLY submit message — scores stay Admin-only
```

---

## 0.4 Supervision / proctoring — tools + how each works (steps)

### A) Screen share

**Tool:** `getDisplayMedia` (browser)

```
1. Student must share ENTIRE monitor (not window/tab when browser reports surface)
2. App keeps the video track as a live lock (PIP optional for screen)
3. If user stops sharing → event → real-time ALERT (+ halt until restored / count policy)
4. Reuse logic style of existing quiz proctor helpers
```

### B) Webcam

**Tool:** `getUserMedia({ video })`

```
1. Ask camera permission
2. Show live PIP preview
3. Feed frames into MediaPipe (face / gaze / hands)
4. If camera track ends → ALERT / halt
```

### C) Number of faces (must be 1)

**Tool:** MediaPipe **Face Detector**

```
1. Every ~100–200ms take a webcam frame
2. Model returns detections[]
3. Setup gate: need faceCount === 1 for ~1–2 seconds before Start
4. During test:
     0 faces  → face_missing → ALERT (after grace)
     2+ faces → multi_face → ALERT (hard)
5. Only event metadata goes to server (not raw video in P0)
```

### D) Eye / gaze movement

**Tool:** MediaPipe **Face Landmarker**

```
1. Read head pose (yaw / pitch) from landmarks
2. If looking away longer than debounce (e.g. 1.5s) → gaze_away → ALERT
3. Looking back → gaze_back event
4. Short glances ignored
```

### E) Hand gestures

**Tool:** MediaPipe **Hands**

```
1. Detect hand landmarks in frame
2. Heuristics flag suspicious patterns (e.g. covering camera/face, sustained odd poses — exact list TBD in Open Questions)
3. Debounce to reduce false positives
4. On match → hand_gesture → ALERT
```

### F) Background noise (interview / both)

**Tools:** `getUserMedia({ audio })` + **Web Audio Analyser** + **VAD**

```
1. Open mic
2. Analyse volume / speech-like patterns each frame
3. Classify: silence | speech | noise
4. Sustained noise without speech → bg_noise → ALERT + HUD warning
5. Only speech segments go to STT (noise not transcribed as answer)
```

### G) Tab switching

**Tools:** `document.visibilityState`, `visibilitychange`, `blur`

```
1. Listen for tab hide / window blur
2. On leave → tab_switch → ALERT immediately (policy)
3. Server increments alert_count
```

### H) Real-time alerts + auto-terminate

**Tools:** Custom client alert UI + Postgres `alert_count`

```
1. Any violating signal posts event to backend
2. Backend increments alert_count (authoritative)
3. Student sees banner: “Alert 1 of 3: …” in real time
4. When alert_count >= max_alerts (default 3, or 2):
     → auto-terminate session
     → submit attempt with end_reason = auto_terminated_alerts
     → show: “Your test is submitted. We will come back to you in sometime.”
```

### I) Full supervision loop (one loop, all detectors)

```
ON SESSION RUNNING (throttled loop):
  1. Read webcam frame
  2. Face Detector  → face count
  3. Face Landmarker → gaze state
  4. Hands model     → gesture state
  5. If interview: Analyser+VAD → noise/speech
  6. If visibility hidden → tab alert
  7. If any NEW violation → POST event → show Alert N of max
  8. If N >= max → AUTO TERMINATE
  9. Also watch screen/cam tracks for `ended`
```

---

## 0.5 One-time link — how it works (steps)

**Tools:** random token + SHA hash in DB + httpOnly cookie

```
1. Admin clicks Generate invite
2. Server creates high-entropy token; stores HASH only; status=active
3. Admin copies URL /assess/<token>
4. Student opens link first time → server creates bound session cookie; status=in_progress
5. Second browser / no cookie → “link no longer valid”
6. After finish/terminate → status=completed; link dead forever
```

---

## 0.6 End-to-end implementation order (steps)

Use tools in this build order (do not skip):

```
Step 1  Schema + private Storage + invite table          (Supabase)
Step 2  Admin upload + PDF/DOCX parsers + Gemini parse (T1)
Step 3  Gemini generate quiz/interview banks           (T2)
Step 4  One-time invite URL                            (token/cookie)
Step 5  Student: redeem → mode → INSTRUCTIONS gate
Step 6  Screen + webcam locks                          (getDisplayMedia / getUserMedia)
Step 7  Face count + gaze + hands + tab + noise        (MediaPipe + Web Audio)
Step 8  Alert counter + auto-terminate at 2/3
Step 9  Quiz path under proctor
Step 10 Interview path: mic + STT + English/performance (Admin-only scores)
Step 11 Student submit message only
Step 12 Admin report page
```

---

# 1. Whole Flow — Frontend & Backend

## 1.1 High-level product flow

```
 Admin                         SYSTEM                         STUDENT
  │                              │                              │
  │── upload Resume + JD ───────►│                              │
  │                              │── parse experience vs JD     │
  │                              │── generate question banks    │
  │                              │── create ONE-TIME link ─────►│ (send/share)
  │◄── copy invite URL ──────────│                              │
  │                              │                              │── open link (1st time)
  │                              │◄── redeem token (consume) ───│
  │                              │                              │── choose Quiz | Interview | Both
  │                              │                              │── read FULL instructions
  │                              │                              │── allow screen + cam (+ mic)
  │                              │◄── proctor events / answers ─│
  │                              │── real-time alerts (2–3)     │── see alert banners
  │                              │── auto-terminate if limit    │
  │                              │── grade + language (server)  │
  │                              │                              │◄── “Test submitted…” ONLY
  │── open admin report ────────►│── scores + integrity ────────│ (student NEVER sees scores)
```

## 1.2 Swimlane (create link → take test)

```
 Admin FE              BACKEND                    STUDENT FE                 DATA
  │                      │                           │                        │
  │ POST /assessments    │                           │                        │
  │ (resume+JD) ────────►│ store docs + parse        │                        │ Postgres/Storage
  │ POST .../generate    │ Gemini from YOE + JD      │                        │ questions
  │ POST .../invite      │ create one-time token     │                        │ invites
  │◄── inviteUrl ────────│                           │                        │
  │                      │                           │ GET /invite/[token]     │
  │                      │◄──────────────────────────│                        │
  │                      │ validate; mark consumed   │                        │
  │                      │── allow mode picker ─────►│                        │
  │                      │                           │ instructions → setup   │
  │                      │◄── start + events ────────│                        │
  │                      │ grade privately           │                        │
  │                      │── submit ack only ───────►│ “We will come back…”   │
  │ GET Admin report     │── full scores ───────────►│ (Admin UI only)        │
```

## 1.3 Step-by-step — Admin (creator) path

### S1 — Create assessment

| Frontend (Admin) | Backend |
|------------------|---------|
| `dashboard/assessments/new` (auth required) | `POST /api/assessments` |
| Upload resume + JD (file or paste JD) | Private Storage; insert `assessments` |
| Optional: student name/email for tracking | Store metadata only (not for student login if invite is token-based) |

### S2 — Parse experience vs JD

| Frontend (Admin) | Backend |
|------------------|---------|
| Show parsing status + skill/experience gap preview | Extract text → Gemini: years experience, skills, JD must-haves, seniority → `skill_gap` |
| Confirm / adjust allowed modes (Quiz, Interview, Both) | Persist `allowed_modes[]` |

### S3 — Generate banks + one-time link

| Frontend (Admin) | Backend |
|------------------|---------|
| Click **Generate invite** | `POST .../generate` then `POST .../invite` |
| Copy/share URL once | Create opaque token; `max_uses=1`; `expires_at`; status `active` |
| See invite status: active / consumed / expired / terminated | Never put scores in the invite URL |

**Invite URL shape (planned):**  
`https://<host>/assess/<token>`  
Token is unguessable (e.g. 32+ bytes). Opening consumes or locks the invite so a **second open is rejected**.

## 1.4 Step-by-step — Student path (one-time link)

### P1 — Open link (single use)

| Frontend (Student) | Backend |
|--------------------|---------|
| Land on `/assess/[token]` | Lookup invite; if already used / expired / revoked → **“This link is no longer valid”** |
| First valid open | Mark invite `consumed` (or `locked_to_session`) **before** test starts — exact policy: see Open Questions; default plan = **consume on first successful load of mode picker** so refresh mid-setup can use short-lived session cookie bound to same token |
| — | Bind browser session cookie to invite so accidental refresh does not issue a second public use |

**One-time rule (planned default):**

1. First visit with valid token → create server `student_session` + httpOnly cookie; mark invite `in_progress`.  
2. Later visits **without** that cookie → reject (“already used”).  
3. Visits **with** cookie before finish → allow resume of same session only if policy allows; otherwise reject.  
4. After finish / auto-terminate → invite `completed`; any open → reject.

### P2 — Mode selection

| Frontend (Student) | Backend |
|--------------------|---------|
| Cards: **Quiz** / **Interview** / **Both** (only modes Admin allowed) | Persist chosen `session_mode` on attempt |
| Cannot change mode after Start | Enforce on `attempts/start` |

### P3 — Instructions screen (mandatory before media)

Student **must** see and acknowledge **all** rules before any quiz/interview question. Content includes at least:

1. Entire **screen share** is required for the whole test  
2. **Webcam** must stay on; face clearly visible  
3. **Only one person** in frame  
4. Do not look away from screen for long (**eye movement** monitored)  
5. Avoid suspicious **hand gestures** / covering camera  
6. Stay in a **quiet** place; **background noise** is monitored (esp. interview)  
7. Do **not switch tabs** or leave the test window  
8. **Real-time alerts** will appear if rules are broken  
9. After **2 or 3 alerts** (configurable, default **3**), the test **auto-terminates** and is submitted as-is  
10. Results are **not shown** after submit; Admin will contact the student later  
11. Interview mode: mic required; English proficiency is evaluated  

UI: scrollable checklist + **“I understand — Continue”** (disabled until scroll/checkboxes complete).

### P4 — Proctor setup

| Frontend (Student) | Backend |
|--------------------|---------|
| Consent → entire screen → webcam → mic if interview/both | Log grant events |
| Face-count gate: exactly 1 face | Reject start until green |
| Then start attempt | `POST .../attempts/start` |

### P5 — Supervised session

| Frontend (Student) | Backend |
|--------------------|---------|
| Quiz and/or interview UI | Grade / STT / language **server-side**; never return scores to student APIs |
| Live detectors + **real-time alert banners** | Ingest proctor events; maintain `alert_count` |
| On alert N of max: show warning | Persist alert |
| On alert == max: **auto-terminate** | Force finish with `end_reason=auto_terminated_alerts` |
| Tab switch / multi-face / etc. raise alerts per policy | Same |

### P6 — Completion message (student only)

Regardless of pass/fail/terminate, student UI shows **only**:

> **Your test is submitted. We will come back to you in sometime.**

No scores, no integrity %, no English band, no correct answers.

### P7 — Admin review (after)

| Frontend (Admin) | Backend |
|------------------|---------|
| Assessment detail / report | Full: performance, English proficiency, fluency, integrity timeline, alert log, end reason |

---

## 1.5 Architecture

```
┌─ Admin UI (auth) ─────────────┐     ┌─ STUDENT UI (token link) ──────────────┐
│ Upload resume+JD · generate   │     │ Mode · Instructions · Proctor · Test  │
│ invite · review reports       │     │ Alerts · Submit ack ONLY              │
└──────────────┬────────────────┘     └───────────────┬───────────────────────┘
               │                                      │
               └──────────────┬───────────────────────┘
                              ▼
               ┌─ Next.js BFF + Gemini (server) ─┐
               │ assessments · invites · grade    │
               │ student APIs strip all scores    │
               └──────────────┬──────────────────┘
                              ▼
               ┌─ Supabase Postgres + private Storage ─┐
```

---

# 2. Features

## 2.1 Feature list

| ID | Feature | Who |
|----|---------|-----|
| F1 | Resume + JD upload | Admin |
| F2 | Experience vs JD analysis (YOE, skills, seniority, gap) | Admin preview / system |
| F3 | Generate Quiz / Interview / Both banks from experience + JD | System |
| F4 | **One-time student invite link** | Admin creates; student uses once |
| F5 | Student mode choice (Quiz / Interview / Both) on link | Student |
| F6 | **Mandatory instructions** before start | Student |
| F7 | Entire screen share lock | Student session |
| F8 | Webcam lock + PIP | Student session |
| F9 | Eye / gaze monitoring | Student session |
| F10 | **Hand gesture** monitoring | Student session |
| F11 | **Number of faces** (must be 1) | Student session |
| F12 | **Background noise** monitoring | Interview / Both |
| F13 | **Tab switching** detection | Student session |
| F14 | **Real-time alerts** on HUD | Student session |
| F15 | **Auto-terminate after 2–3 alerts** (default 3) | System |
| F16 | Interview: **English proficiency** + fluency + performance | Graded for Admin |
| F17 | Quiz/interview **performance** scoring | Admin only |
| F18 | Student completion copy only (“submitted… come back…”) | Student |
| F19 | Admin full report (scores + integrity + alerts) | Admin |
| F20 | Privacy: private docs/media; no scores on student APIs | System |

## 2.2 Proctor signals → alert behavior

| Signal | Detection | Raises alert? | Notes |
|--------|-----------|---------------|-------|
| Screen share ended | `getDisplayMedia` track ended | Yes (immediate) | Halt; restore may be required; count as alert if not restored in grace |
| Webcam ended | track ended | Yes | Same |
| Gaze away | Face Landmarker yaw/pitch over threshold + debounce | Yes | After sustained look-away |
| Hand gesture | MediaPipe Hands / gesture heuristic (cover face, multiple raised patterns TBD) | Yes | Debounce false positives |
| Face count ≠ 1 | Face Detector | Yes | 0 faces or 2+ faces |
| Background noise | VAD / analyser (interview) | Yes | Sustained ambient noise |
| Tab switch / hide | `visibilitychange` / blur | Yes | Align with existing quiz tab policy |

**Alert policy (planned default):**

- Show **real-time banner**: “Alert 1 of 3: …”, “Alert 2 of 3: …”, …  
- `max_alerts` = **3** (configurable to 2)  
- On reaching max → **auto-terminate**: stop streams, submit attempt as `auto_terminated_alerts`, show student submit message  
- Soft warnings (optional) do **not** count; only policy-listed events increment `alert_count`

## 2.3 Student vs Admin visibility

| Data | Student | Admin |
|------|---------|-------|
| Instructions / alerts during test | Yes | Yes (logged) |
| Questions during test | Yes | Yes |
| Scores / proficiency / integrity | **No** | **Yes** |
| After submit message | Fixed copy only | Full report |

## 2.4 Non-goals (v1)

- Student self-serve upload without Admin invite  
- Showing results/report to student  
- Reusable or multi-open invite links  
- Live human interviewer  
- KYC / ID verification  

---

# 3. How to Implement

## 3.1 Techniques

| ID | Feature(s) | Method |
|----|------------|--------|
| T1 | F1–F2 | PDF/DOCX extract → Gemini JSON (experience, skills, JD, gap) |
| T2 | F3 | Gemini banks grounded on YOE + JD must-haves + resume claims |
| T3 | F4 | Opaque invite token; `max_uses=1`; session cookie bind; consume/reject |
| T4 | F7–F8 | `getDisplayMedia` entire monitor + `getUserMedia` video (reuse quiz proctor) |
| T5 | F9 | MediaPipe Face Landmarker gaze heuristic |
| T6 | F10 | MediaPipe Hands (or Holistic) → gesture / camera-cover heuristics |
| T7 | F11 | MediaPipe Face Detector → `faceCount` |
| T8 | F12 | Web Audio + VAD; speech-only to STT |
| T9 | F13 | `document.visibilityState` / pagehide; count as alert |
| T10 | F14–F15 | Client alert bus + server `alert_count`; terminate at max |
| T11 | F16–F17 | STT + Gemini proficiency/performance; **omit from student responses** |
| T12 | F18–F20 | Separate Admin report routes; student finish returns `{ message }` only |

## 3.2 Feature → implement how

| Feature | How |
|---------|-----|
| **F4 One-time link** | Table `assessment_invites (token_hash, assessment_id, status, expires_at, consumed_at, session_id)`. Admin `POST .../invite` returns URL once. Student middleware validates token + cookie. |
| **F5 Mode on link** | After valid redeem, mode picker; store on attempt. |
| **F6 Instructions** | Dedicated step component; require ack before media prompts. |
| **F7–F13 Proctor** | Shared `lib/proctor/*`; event POST; map events → alerts. |
| **F14 Real-time alerts** | Client toast/banner + server authoritative `alert_count` on each event. |
| **F15 Auto-terminate** | When `alert_count >= max_alerts`, client calls finish with reason; server also rejects further answers. |
| **F16–F17 Scoring** | On finish (or async job); write to attempt; **never** include in student JSON. |
| **F18 Submit message** | Hardcoded student success/terminate screen. |
| **F19 Admin report** | Authz Admin-only `GET /api/admin/assessments/[id]/report`. |

## 3.3 Frontend map

| UI | Path (planned) | Audience |
|----|----------------|----------|
| Create assessment | `app/dashboard/assessments/new` | Admin |
| Invite + status | `app/dashboard/assessments/[id]` | Admin |
| Admin report | `app/dashboard/assessments/[id]/report` | Admin |
| Student entry | `app/assess/[token]/page.tsx` | Student |
| Mode picker | same flow | Student |
| Instructions | `components/assessment/instructions-gate.tsx` | Student |
| Proctor setup + runners | assessment quiz/interview runners | Student |
| Alert HUD | `components/assessment/alert-banner.tsx` | Student |
| Submit ack | `components/assessment/submit-confirmation.tsx` | Student |

## 3.4 Backend map

| Route | Audience | Returns scores? |
|-------|----------|-----------------|
| `POST /api/assessments` | Admin | n/a |
| `POST .../parse`, `.../generate`, `.../invite` | Admin | n/a |
| `GET /api/assess/invite/[token]` | Student | No |
| `POST /api/assess/invite/[token]/mode` | Student | No |
| `POST .../attempts/start`, answers, events | Student session | No |
| `POST .../finish` | Student | **Only** `{ message: "Your test is submitted..." }` |
| `GET /api/admin/assessments/[id]/report` | Admin | **Yes** |

## 3.5 Data model (additions)

### `assessment_invites`

| Column | Notes |
|--------|-------|
| `token_hash` | store hash only |
| `assessment_id` | FK |
| `status` | `active` \| `in_progress` \| `completed` \| `expired` \| `revoked` |
| `max_alerts` | default 3 |
| `allowed_modes` | `quiz`, `interview`, `both` |
| `expires_at` | optional TTL |
| `consumed_at` / `completed_at` | audit |
| `bound_session_id` | ties refresh to same browser session |

### `assessment_attempts` (extra fields)

| Column | Notes |
|--------|-------|
| `alert_count` | int |
| `max_alerts` | copy from invite |
| `end_reason` | `completed` \| `auto_terminated_alerts` \| `abandoned` |
| `performance_*` / language jsonb | **Admin-only reads** |

## 3.6 Build order

```
A Foundation (schema, invites, RLS)
  → B Admin intake + generate + invite URL
    → C Student one-time redeem + instructions + mode
      → D Proctor signals + real-time alerts + auto-terminate + quiz path
        → E Interview + English/performance (Admin-only scores)
          → F Admin report + retention
```

| Stage | Delivers |
|-------|----------|
| A | Tables, buckets, types |
| B | Admin upload/parse/generate/copy link |
| C | Student open-once, instructions, mode |
| D | Full proctor + alerts + auto-stop + quiz; student submit message |
| E | Interview mic/noise/STT/language; scores hidden from student |
| F | Admin report UI; optional media retention |

## 3.7 Suggested files (when coding starts)

```
app/dashboard/assessments/**          # Admin
app/assess/[token]/**                 # student one-time
app/api/assessments/**                # Admin APIs
app/api/assess/invite/**              # student token APIs
app/api/admin/assessments/**          # Admin reports
components/assessment/instructions-gate.tsx
components/assessment/alert-banner.tsx
components/assessment/submit-confirmation.tsx
lib/proctor/{screen,camera,mic,face,gaze,hands,vad,alerts}.ts
lib/assessment/{invites,integrity,fluency,types}.ts
```

## 3.8 Reuse

| Existing | Use for |
|----------|---------|
| `lib/quizzes/proctor.ts` | Screen + camera locks |
| Quiz runner halt/tab patterns | Tab switch + stream restore UX |
| Gemini quiz generator/evaluator | Banks + performance grading |
| Proctor SQL event ideas | Extend with gesture, alerts, invite lifecycle |

---

# 4. Security & Privacy

- Invite tokens: high entropy; store **hash** only; HTTPS only  
- Student finish/report APIs must **not** leak scores (review responses in code review)  
- Admin routes: auth + role/email gate (align with admin patterns)  
- Private Storage for resume/JD/media  
- Consent on instructions screen  
- PII minimization on student UI  

---

# 5. Verification

### Manual (critical)

1. Admin creates invite → student opens once → second browser/incognito gets “link no longer valid”  
2. Instructions blocking: cannot start without ack  
3. Each proctor violation shows real-time alert counter  
4. At max alerts (2 or 3): session auto-terminates; student sees submit message only  
5. Student network tab: finish payload has **no** scores  
6. Admin report shows performance + English + alert timeline + `end_reason`  
7. Interview: noise + mic path; proficiency stored for Admin  

---

# 6. Open Questions

1. Exact **max_alerts**: fixed 3, or Admin-selectable 2 vs 3 per invite?  
2. One-time: consume on **first open** vs on **Start test** (refresh policy)?  
3. Does student need magic-link login, or **token-only** access?  
4. Which **hand gestures** count as violations (list for MediaPipe mapping)?  
5. After auto-terminate, is attempt still graded for Admin (recommended: **yes**, partial)?  
6. Invite expiry TTL (e.g. 72h)?  

---

# 7. Phase checklist

### Phase 0 — Design lock

- [x] Admin + student FE/BE flow (one-time link)  
- [x] Features including alerts, gestures, student submit-only message  
- [x] Implementation approach  
- [ ] Close Open Questions + sign-off  

### Phase 1 — Admin + invite  

- [ ] Schema, upload, parse, generate, one-time link  

### Phase 2 — Student gate  

- [ ] Redeem once, mode, **instructions**, setup  

### Phase 3 — Proctor + alerts + quiz  

- [ ] All signals, real-time alerts, auto-terminate, submit message  

### Phase 4 — Interview + Admin report  

- [ ] English + performance (Admin-only), full report  

---

## Implementation Status: PLANNED (2026-09-08)

Plan updated for **student mock interviews via one-time link**, full proctoring (incl. hand gestures + tab switch), **real-time alerts with auto-terminate**, mandatory **instructions**, and **no scores shown to students**.

**Next:** close Open Questions → sign-off → Stage A.
