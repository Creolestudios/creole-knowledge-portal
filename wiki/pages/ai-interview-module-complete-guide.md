# Creole AI Interview Module — Complete Technical & Functional Specification

## 1. Executive Summary & Overview

The **Creole AI Interview Module** is an autonomous, end-to-end technical and non-technical interview assessment system designed to evaluate candidate competencies, English language proficiency, and session integrity without requiring human proctor intervention.

### Core Technology Stack
- **Frontend / Full-Stack**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4.
- **Client-Side ML & Audio Processing**:
  - MediaPipe FaceMesh Web Worker (face detection, iris ratio, head yaw/pitch).
  - TensorFlow.js COCO-SSD Worker (object & prohibited device detection).
  - Web Audio API `AudioContext` & `AnalyserNode` (real-time voice & spectral flux analysis).
  - Web Speech API (real-time candidate speech recognition & transcription).
- **Backend & Database**:
  - Supabase PostgreSQL (`interview_sessions`, `interview_questions`, `interview_answers`, `interview_transcript`, `interview_events`, `interview_reports`).
  - Supabase Storage (evidence snapshots captured during proctoring violations).
  - Google Gemini Flash (technical evaluation, CEFR fluency analysis, bluff detection, and Round 2 question generation).

---

## 2. End-to-End Interview Candidate Journey (Flow)

```mermaid
graph TD
    A[Magic Invite Link: /assess/[token]] --> B[Stage 1: Passcode Verification]
    B --> C[Stage 2: Instructions & Device Permissions]
    C --> D[Stage 3: Ready / Final Confirmation]
    D --> E[Stage 4: Face & Gaze Calibration]
    E --> F[Stage 5: Live Question & Answer Loop]
    F -->|Timer Expiry or 'Next Question'| F
    F -->|All Questions Completed OR Overall Time Elapsed| G[Stage 6: Completed & Auto-Scoring]
    F -->|3 Proctoring Violations| H[Stage 7: Auto-Terminated]
    G --> I[Admin & HR Report Dashboard]
    H --> I
```

### Stage 1: Passcode Verification (`passcode`)
- Candidate accesses `/assess/[token]`.
- System validates the candidate invite token and requires a 6-digit access passcode.
- Upon verification, session details, candidate profile, and all assigned questions are loaded into memory.

### Stage 2: Hardware & Permissions Check (`instructions` & `permissions`)
- The candidate must explicitly grant access to:
  1. **Webcam**: Used for continuous face, gaze, and object detection.
  2. **Microphone**: Used for speech-to-text and background voice analysis.
  3. **Entire Screen Sharing (`getDisplayMedia`)**: Ensures candidate does not open secondary windows or tabs.

### Stage 3: Ready Screen (`ready`)
- Pre-interview sanity check ensuring active audio/video feeds before proctoring starts.

### Stage 4: Calibration Phase (`calibration`)
- Uses a background MediaPipe FaceMesh Web Worker to capture **15 baseline samples** of the candidate's natural resting position:
  - Center iris coordinates (left and right eye).
  - Head yaw and pitch angles.
- This baseline calibrates the proctoring engine to the candidate's unique monitor height, camera position, and natural posture, eliminating false positive gaze warnings.

### Stage 5: Live Interview Question Loop (`interview`)
- **Question Presentation**:
  - The current question is displayed prominently with difficulty and competency labels.
  - An individual question countdown timer (`time_limit_sec`, default 120s) ticks down.
- **Voice-Only Answer Capture**:
  - Web Speech recognition automatically activates within 120ms of a question appearing.
  - Spoken words are transcribed and streamed in real time to the candidate's screen.
  - A manual "Speak / Reset Mic" button is available if the microphone needs re-syncing.
- **Moving to the Next Question**:
  - **Manual**: Once speech is detected, the button turns into **"Next Question"** (or **"Finish Interview"** on the last question). Clicking saves the answer and loads the next question.
  - **Automatic Expiry**: If the question timer reaches `0:00`, the system automatically submits the candidate's current transcription (or a blank record if silent) and transitions to the next question.
- **Overall Session Timer**:
  - An overall session timer (e.g. 15 minutes) runs continuously.
  - If the overall timer expires, all media stops, any open answers are saved, and the interview is submitted immediately.

### Stage 6: Completion & AI Scoring (`completed`)
- Media streams are revoked.
- An asynchronous evaluation job (`scoreInterviewSession`) triggers Gemini Flash (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest`, `gemini-2.5-flash` with automatic quota/error fallback) to score technical depth, English CEFR fluency, cognitive composite, and generate Round 2 questions.
- Results are saved via `saveInterviewReport` (`lib/ai-interview/report-store.ts`), which writes to `interview_reports` and seamlessly falls back to `interview_events` (`event_type: 'scoring_report'`) if the reports table is missing in the database schema.

### Stage 7: Auto-Termination (`terminated`)
- If the candidate incurs **3 proctoring strikes**, the session is immediately auto-terminated.
- The invite status is revoked, reason is recorded in Supabase, and the candidate is locked out of the interview.

---

## 3. Session Integrity & Proctoring Engine

All proctoring rules feed into a **Single Unified Counter** strictly capped at **3 warnings total** before auto-termination.

| Warning # | Action Taken |
| :--- | :--- |
| **Warning 1** | Session pauses. Warning banner displayed with a **30-second auto-resume countdown**. Candidate can click "Resume Interview" or the session auto-resumes after 30s. Snapshot & event logged. |
| **Warning 2** | Session pauses. Second warning banner with **30-second auto-resume countdown**. Candidate can click "Resume Interview" or the session auto-resumes after 30s. Snapshot & event logged. |
| **Warning 3** | **No resume option provided.** Session **terminates immediately**. Final proctoring audit recorded with maximum strikes. |

```
                                  Unified Proctoring Engine
                                               │
             ┌─────────────────────────────────┼─────────────────────────────────┐
             ▼                                 ▼                                 ▼
   [ Face & Gaze Tracking ]          [ Object & Device Guard ]         [ Voice & Audio Guard ]
   - No face (1.5s)                  - Mobile phone (0ms)              - AI / Synthetic voice (~400ms)
   - Multi face (2.0s)               - Headphones / Earbuds (0ms)      - Louder background voice (~200ms)
   - Looking away / Turn (3.0s)      - Notes / Books (0ms)             - Dual speaker overlap (~200ms)
   - Reading off-screen (4.5s)       - Second screen / Laptop (0ms)    (Quiet murmurs ignored)
             └─────────────────────────────────┬─────────────────────────────────┘
                                               ▼
                              [ Unified Counter: Max 3 Strikes ]
                                               │
                                 Strike 3 ──► Auto-Termination
```

### A. Face & Gaze Tracking (MediaPipe Web Worker)
Runs off the main thread at ~8 FPS (125ms intervals):
1. **No Face Detected (`no_face`)**:
   - *Threshold*: **1.5 seconds** sustained absence.
   - *Reason*: `"No face detected in webcam frame."`
2. **Multiple Faces Detected (`multi_face`)**:
   - *Threshold*: **2.0 seconds** sustained presence of $\ge 2$ faces.
   - *Reason*: `"Multiple faces detected in frame."`
3. **Looking Away / Gaze Deviation (`gaze_away`)**:
   - *Threshold*: **3.0 seconds** sustained.
   - *Condition*: Candidate completely shifts gaze off-screen (look left/right/up score $> 0.68$) or turns head away (head yaw $> 25^\circ$ or pitch $> 22^\circ$).
   - *Reading Safeguard*: Normal horizontal eye movement while reading text on screen (0.2–0.45) is permitted and never flags.
   - *Reason*: `"Keep your eyes on the screen during the interview."`
4. **Reading Off-Screen (`reading_suspected`)**:
   - *Threshold*: **4.5 seconds** sustained downward gaze ($> 0.75$, e.g. looking down at a desk or lap).
   - *Reason*: `"Suspected reading off-screen."`
- **Cooldown**: 5.0-second debounce between alerts for the same category.

### B. Object & Unauthorized Device Detection (COCO-SSD Worker)
Analyzes camera frames using a TensorFlow.js background worker:
- **Tracked Objects**: Mobile phone, headphones, earbuds, books/notes, laptops, secondary monitors, tablets, external keypads.
- **Sensitivity & Thresholds**:
  - Cell phones, earbuds, and headphones trigger with confidence $\ge 10\%$.
  - Reading materials / books trigger with confidence $\ge 12\%$.
  - Secondary screens and laptops trigger with confidence $\ge 14\%$.
  - Response time is **immediate (0 ms sustained delay)** upon detection.
- **Cooldown**: 5.0-second debounce per detected object type. If the object leaves the camera view for 2 consecutive frames, the timer resets.

### C. Real-Time Audio & Voice Guard (`useAudioVoiceGuard`)
Continuous acoustic frequency analysis using Web Audio API across the speech band (300 Hz – 3,400 Hz):
1. **Generalized Warning Note**:
   - All voice detections (secondary speaker, human voice while candidate is silent, external/AI voice) display the generalized warning note:
     > **`"Background voice detected"`**
2. **Continuous Voice Duration (8 to 10 Seconds)**:
   - Voice must be detected continuously for **8 to 10 seconds** (`continuousVoiceMs = 8000ms` or equivalent sustained frames) before a warning note is triggered.
   - Brief or transient noises under 8 seconds are ignored and auto-reset.
3. **10-Second Break / Cooldown for Subsequent Warnings**:
   - Enforces a **10-second break** (`cooldownMs = 10000ms`) after any warning is issued.
   - If background voice continues to be heard after the 10-second break, the second warning is triggered.
4. **Music & Keyboard Detection**:
   - High harmonic tonality across music bands triggers `"Background music detected."`.
   - Sharp transient high-frequency clusters trigger `"Keyboard typing sounds detected."`.
5. **Noise Filtering & Suppression**:
   - Mild environmental noise, quiet room tone, and low-level ambient hiss (< 35 energy) are safely ignored.
   - Voice alarms are suppressed while the AI system prompt is speaking.

### D. System Watchdog (`useProctoringWatchdog`)
- Checks hardware and media integrity every 1.5 seconds.
- Automatically terminates the session if:
  - The camera or microphone track ends or is muted.
  - The screen sharing stream is closed by the user.
  - The browser tab is switched or minimized (`visibilityState === 'hidden'`).

---

## 4. Database Schema & Data Isolation Architecture

To ensure audit accuracy and zero cross-contamination:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DATA ISOLATION SCHEMA                           │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Table                    │ Purpose & Contents                          │
├──────────────────────────┼─────────────────────────────────────────────┤
│ interview_sessions       │ Session state, candidate data, strike counts│
│ interview_questions      │ All system/AI questions generated           │
│ interview_answers        │ Candidate answers mapped per question       │
│ interview_transcript     │ EXCLUSIVELY candidate spoken utterances     │
│ interview_events         │ Proctoring alerts, snapshots, strike logs   │
│ interview_reports        │ AI evaluation, CEFR, scores, follow-ups     │
└──────────────────────────┴─────────────────────────────────────────────┘
```

1. **`interview_transcript`**:
   - **Exclusively contains candidate speech** (`speaker: 'candidate'`).
   - Platform questions, AI utterances, and system prompts are strictly quarantined from this table to prevent polluting the evaluation engine.
2. **`interview_questions`**:
   - Origin and permanent home of all questions asked in the interview.
   - Contains question text, category, difficulty, order, and competency.
3. **`interview_answers`**:
   - Stores candidate answer transcripts mapped to `question_id`.
   - Guaranteed coverage: if a question was skipped or timed out, a record with `transcript: ''` is automatically preserved so no question is ever missing.
4. **`interview_events`**:
   - Audits every proctoring incident with snapshot image paths and metadata (`warningCount: 1, 2, 3`).
   - Serves structured warnings (`warnings: CandidateWarning[]`, `totalWarnings`) via `GET /api/interview/events` to ensure admins entering mid-session can immediately view candidate strikes.
   - Also serves as the resilient secondary storage fallback for `scoring_report` payloads when `interview_reports` is missing from the database schema.
5. **`interview_reports`**:
   - Primary storage for interview reports, cognitive scores, fluency CEFR ratings, and recommendations.

---

## 5. Scoring & Result Evaluation Engine

Triggered asynchronously upon interview completion:

### 1. English Fluency Evaluation
$$\text{Fluency Score (0–100)} = (45\% \times \text{Local Objective Score}) + (55\% \times \text{AI CEFR Score})$$

- **Local Objective Metrics (45%)**:
  - **Words Per Minute (30%)**: Optimal target 110–170 WPM.
  - **Filler Word Ratio (30%)**: Target $< 3\%$ of total words.
  - **Long Pauses (25%)**: Target $< 4$ pauses ($> 800\text{ms}$) per minute.
  - **Response Latency (15%)**: Target 300 ms – 1,800 ms.
- **AI CEFR Rubric (55%)**:
  - Scored on CEFR levels: **A2, B1, B2, C1, or C2**.
  - Sub-bands: Grammar & Accuracy, Vocabulary Range, Structured Coherence, Fluency & Flow.
  - **Language Switch Detection**: Up to **40-point penalty** if non-English speech is detected.

### 2. Technical Competencies (1 to 5 per Question)
- Evaluated against a 5-point rubric:
  - **5 (Excellent)**: Senior depth, concrete metrics, edge cases considered.
  - **4 (Strong)**: Technically sound with minor gaps.
  - **3 (Adequate)**: Generic or surface-level knowledge.
  - **2 (Weak)**: Misconceptions.
  - **1 (Poor / Empty)**: Incorrect, empty, or absent audio.
- **Verbatim Evidence Grounding**: The AI extracts exact quotes from candidate speech to prove each score.
- **Bluff Detection**: Buzzword-heavy answers lacking depth are flagged with `bluff_suspected: true`.

### 3. Cognitive Composite (0–100)
$$\text{Cognitive Composite} = (60\% \times \text{Competency Score}) + (30\% \times \text{Reasoning Subscore}) + (10\% \times \text{Speech Clarity})$$

### 4. Hiring Recommendation Matrix
- **🌟 Strong Hire (`strong_yes`)**: Cognitive $\ge 80$, Fluency $\ge 75$, CEFR $\ge \text{B2}$, 0 proctoring warnings, no language switching.
- **✅ Recommended to Hire (`yes`)**: Cognitive $\ge 60$, Fluency $\ge 55$, 0 proctoring warnings.
- **⚠️ Needs Further Review (`maybe`)**: Adequate scores but 1–2 proctoring warnings OR language switching detected.
- **❌ Not Recommended (`no`)**: Terminated due to 3 warnings OR severe performance gaps.

### 5. Round 2 Follow-Up Questions
The AI inspects competencies where the candidate scored $\le 3/5$ and generates **2 to 3 targeted technical follow-up questions** for human interviewers in Round 2.

---

## 6. Admin & HR Reporting Dashboard

Located at `/admin/reports/[id]`:
- **HR & Non-Technical View**:
  - CEFR rating & badge.
  - English communication breakdown (Grammar, Vocabulary, Coherence, Fluency).
  - Speaking pace (WPM).
  - **Continuous Warning Counter**: Visual strike tracker (Strike 1, Strike 2, Strike 3) with exact breakdown across Face, Object, and Voice.
- **Technical Evaluation View**:
  - Question-by-question score (1–5) with evidence quotes and bluff indicators.
  - Recommended Round 2 technical deep-dive questions.
- **Full Transcript View**:
  - Chronological review of candidate speech answers with timestamps.

---

## 7. Interview Status Lifecycle & Real-Time Sync

```
[Invite Issued / Active] ──(Candidate Opens & Verifies)──► [In Progress]
                                                               │
                           ┌───────────────────────────────────┴───────────────────────────────────┐
                           ▼                                                                       ▼
      [Terminated] (Violation / Watchdog / Exit)                                              [Completed] (Normal Finish)
      - sessions: 'cancelled'                                                                  - sessions: 'completed'
      - invites:  'revoked'                                                                    - invites:  'completed'
```

### Status Mapping & Harmonization
- **Pending / Active**: `invite.status === 'active'` (or session `invite_issued`).
- **In Progress**: `session.status === 'in_progress'` or `invite.status === 'in_progress'` once the candidate passes passcode verification and enters the assessment room.
- **Terminated**: Triggered via `/api/interview/terminate` or `/api/assess/[token]/terminate`. Sets `interview_sessions.status = 'cancelled'` and `interview_invites.status = 'revoked'`. Displayed as `terminated` in admin dashboard.
- **Completed**: Triggered upon completion via `/api/interview/[id]/score` or `/api/assess/[token]/complete`. Sets `interview_sessions.status = 'completed'` and `interview_invites.status = 'completed'`.

### Real-Time Dashboard Updates
The admin AI Interview screen (`/admin/dashboard` &rarr; `ai-interviews`) automatically updates status without page reloads using:
1. **Supabase Realtime**: Listens to `postgres_changes` on `interview_sessions`, `interview_invites`, and `ai_interviews`.
2. **Heartbeat Poller**: 3.5-second polling interval active when the browser window is visible (`!document.hidden`).

---

## 8. Third-Party Admin Live Joining & Proctoring Synchronization Flow

An admin or interviewer can join an ongoing candidate interview directly using the interview link `/interview/[id]`:

1. **Authentication & Flexible Entry (From Start or In Between)**:
   - **Candidate Entry**: Candidates enter via their unique interview link, 6-digit passcode, and email address. They go through device calibration and enter the proctored test room.
   - **Admin Entry (Start or In Between)**: Admins can join at the start or in the middle of an in-progress interview.
     - `GET /api/interview/verify` keeps `in_progress` sessions active for admin verification instead of prematurely declaring them expired.
     - Device presence conflict broadcasts (`candidate-presence`) are restricted strictly to active candidates in the `interview` stage, preventing spurious device conflict terminations when an admin loads the page.
     - `/api/interview/verify` validates the admin's email role against `user_profiles`. When `isAdmin === true`, concurrency locks and duplicate checks are bypassed.
     - On joining an in-progress interview, the admin screen receives a `sync-state` signal containing the current question index and remaining time to sync up with the candidate's exact live progress.
   - **Admin Early Join ("Interview Not Started Yet")**:
     - If an admin joins before the candidate has accessed the link or before the interview has started (`inProgress === false` or `status !== 'in_progress'`), the admin is presented with the dedicated **"Interview Not Started Yet"** screen.
     - Displays a "Waiting for Candidate" badge with a live radar pulse indicator.
     - The page actively listens to Supabase Realtime broadcast signals (`candidate-presence`, `candidate-joined`, `sync-state`) and performs automatic background polling against `/api/interview/verify` every 4 seconds.
     - As soon as the candidate enters and begins the interview, the admin screen automatically transitions into the real-time proctoring view without requiring manual intervention.
     - Provides a manual "Check Status / Refresh" button to re-check on demand and a "Return to Admin Dashboard" button.

2. **WebRTC Dual-Stream Video & Non-Overlapping Layout**:
   - `useWebRTC` connects the admin and candidate via Supabase signaling (`interview-rtc-${interviewId}`).
   - Instead of an overlapping picture-in-picture box obscuring candidate presentation:
     - **Admin View**: Admin's video is placed in the top video tile (`You (Admin)`), and the candidate's stream is positioned in the bottom tile (`Candidate`).
     - **Candidate View**: Interviewer stream is displayed in the top tile (`Interviewer`), and the candidate's preview is in the bottom tile (`You`).
   - When an admin leaves, `admin-left` signals clean up the remote stream so the candidate reverts to single camera preview without session interruption.

3. **Real-Time Proctoring Warnings Synchronization & Mid-Session Admin Join Awareness**:
   - When any proctoring violation occurs (Face Tracking, Unauthorized Object Detection, or Unauthorized Voice Detection):
     - Candidate displays the warning toast banner (`Warning X / 3: <reason>`).
     - Candidate broadcasts a `warning-alert` payload across `interview-sync-${interviewId}`.
     - Admin screen displays the exact same warning toast banner (`Warning X / 3: <reason>`) with countdown and dismiss controls, as well as logging it to the Live Proctoring feed.
   - **Mid-Session Admin Join Awareness**:
     - When an admin joins an in-progress interview midway, the admin client queries `GET /api/interview/events?interviewId=...` and syncs with the candidate's `sync-state` broadcast containing prior warnings.
     - The admin screen prominently displays the **Candidate Warning Status** card:
       - Visual 3-slot Strike tracker showing clean vs faced status for Strikes 1, 2, and 3.
       - Overall strike indicator badge (e.g. `0 / 3 Strikes (Clean)`, `1 / 3 Strikes`, `2 / 3 Strikes (Final Warning)`).
       - Chronological warning list detailing the Strike #, category (Voice, Object, Face), exact reason description, and timestamp for all faced warnings.
       - Critical warning callout if the candidate is on Strike 2 (notifying the admin that the next infraction triggers auto-termination).

4. **Synchronized Terminate & Completed States**:
   - **On Completion**: When candidate completes questions or timer elapses, both candidate and admin transition to the identical "Interview complete" screen. Admin is provided a "Return to Admin Dashboard" action.
   - **On Termination**: When 3 warnings or proctoring violations occur, both candidate and admin transition to the identical red "Interview terminated" screen showing the exact violation reason. Admin has a "Return to Admin Dashboard" button to return safely.

5. **Admin Leave Control**:
   - Admins can cleanly exit the interview session at any point using the "Leave Interview" button in the question header or the "Exit" button in `MeetingControlBar`.
   - Admin leaving closes their media tracks and redirects to `/admin/dashboard` without terminating the candidate's interview session.

---

## 9. Simultaneous Candidate Access & Concurrency Defense Engine

To prevent multiple candidates or duplicate devices from accessing and taking the exact same interview session simultaneously (even when two users click "Continue" 1 to 2 milliseconds apart):

1. **Door 1: Atomic Database Row-Level Locking (`POST /api/interview/verify`)**:
   - Instead of checking `status` in memory and running an unconstrained update, the backend executes an **atomic conditional update** in PostgreSQL:
     ```typescript
     const { data: updatedInvite } = await supabaseAdmin
       .from('interview_invites')
       .update({ status: 'in_progress', consumed_at: new Date().toISOString() })
       .eq('id', invite.id)
       .eq('status', 'active')
       .select('id')
       .maybeSingle();
     ```
   - **User 1 (1–2 ms earlier)**: Matches `status = 'active'`, transitions the record to `in_progress`, and enters the permissions/interview stages with `200 OK`.
   - **User 2 (1–2 ms later)**: Matches `0 rows` because the record is no longer `'active'`. The backend immediately rejects User 2 with `409 Conflict`:
     `{ error: "An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.", concurrent: true, code: "CONCURRENT_SESSION_DETECTED" }`
   - User 2 remains blocked on the passcode screen with an explicit security alert banner.

2. **Door 2: Real-Time Live Stage Presence Arbitration (`candidate-presence-reject`)**:
   - If two browser sessions ever reach the live interview stage:
     - Each candidate tracks their exact live entry timestamp (`candidateEnteredAtRef.current = Date.now()`).
     - On entering `stage === 'interview'`, the client broadcasts `{ type: 'candidate-presence', senderRole: 'candidate', deviceId, enteredAt }`.
     - When an existing candidate receives this broadcast from another device:
       - If `myEnteredAt <= theirEnteredAt` (User 1 arrived earlier): User 1 **stays active** in the interview and broadcasts `{ type: 'candidate-presence-reject', rejectDeviceId: payload.deviceId, activeDeviceId: deviceId }`.
       - When User 2's device receives `candidate-presence-reject` targeting its `deviceId`: User 2 is immediately terminated with `"An active interview session is already in progress on another device."` and camera/mic tracks are stopped.



