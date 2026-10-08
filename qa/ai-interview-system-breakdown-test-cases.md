# AI Interview — System & Server Breakdown Test Cases (User Perspective)

This document catalogs every potential **system, server, network, and environmental failure point** that can break or prematurely terminate an ongoing AI interview—independent of candidate proctoring strikes.

---

## 📑 Summary Matrix

| ID | Failure Category | Trigger Scenario | Current Failure Risk | Ideal Graceful Behavior |
|---|---|---|---|---|
| **SYS-01** | **Token State** | Token marked `completed`/`expired` mid-interview | Candidate kicked to 410 "Link Expired", answers lost | Local session lock verification, retry sync, preserve answers |
| **SYS-02** | **Network** | Wi-Fi drops while candidate is speaking | Answer fetch fails silently, timer advances, text lost | Pause timer, show "Reconnecting...", queue local answer |
| **SYS-03** | **Network** | Network offline when question timer hits 0 | Silent question advance; audio upload fails silently | Halt auto-advance until connection returns; allow retry |
| **SYS-04** | **AI / API** | Gemini quota (429) during real-time transcription | Transcribe returns empty; candidate scored as 0/silent | Save raw WebM audio; mark transcription as "pending backend retry" |
| **SYS-05** | **AI / API** | Question generator API 500 / timeout on launch | Blank interview screen or stuck spinner | Display "Failed to load questions. Retry", invite token remains valid |
| **SYS-06** | **AI / API** | Gemini quota exhausted during final evaluation | HR report shows "1/5 - Poor" or empty competency | Status marked "Scoring Pending - Retrying"; manual retry button for HR |
| **SYS-07** | **Browser** | Out of Memory (OOM) / Chrome "Aw, Snap" crash | Tab dies; reopening invite shows 410 "Used" | Session resume token with last saved question index |
| **SYS-08** | **Browser** | F5 accidental page refresh by candidate | Kicked to link expired screen; session abandoned | Re-authentication / session restore if timer hasn't expired |
| **SYS-09** | **Worker** | FaceMesh or COCO-SSD Web Worker crashes mid-interview | Proctoring freezes; UI may hang | Auto-restart worker; temporary "Camera check reconnecting..." banner |
| **SYS-10** | **Speech API** | Chrome `webkitSpeechRecognition` network error | Captions freeze while question timer runs out | Display "Speech recognition paused. Tap Reset Mic"; keep audio recording |
| **SYS-11** | **Hardware** | Laptop lid closed / Windows Sleep mode | Flagged as instant proctoring violation (tab switch) | Distinguish `sleep/hibernate` from tab-switching; resume prompt |
| **SYS-12** | **Hardware** | Webcam / Microphone disconnected mid-test | Video turns black; media stream dies | Pause interview timer, prompt candidate to reconnect device |
| **SYS-13** | **Multi-Tab** | Candidate opens invite link in a second tab | State desynchronization, duplicate submit | Second tab shows "Already active in another window" |
| **SYS-14** | **Database** | Supabase answer insert fails (500 / connection timeout) | Auto-advance loses question audio | Block "Next Question" until save succeeds or offline-queued |

---

## 1. Token & Session Lifecycle Failures

### Case SYS-01: Token Marked "Completed" / "Expired" Mid-Interview
- **User Perspective (Candidate):** Candidate is on Question 3 of 5. While typing or speaking, the screen abruptly flashes to *"This interview link has already been used"* or *"Link Expired"*. All progress is lost, and the candidate cannot finish.
- **Root Cause:**
  - Background sync polling or another process updates the session row to `status: 'completed'` (e.g., stale admin session completion, timeout trigger, or duplicate request).
  - Client-side status verification (`/api/interview/verify` or session guard) sees the status change and force-redirects the page.
- **Test Steps:**
  1. Candidate starts interview and reaches Question 2.
  2. In database or via API, simulate updating the candidate token/session status to `completed` or `terminated`.
  3. Candidate attempts to answer Question 2 and click "Next".
- **Expected Graceful Handling:**
  - Candidate must **never** be silently kicked while a local session is active.
  - If a server conflict occurs, show: *"Sync conflict detected. Your current answers are saved locally. Please click 'Verify & Continue'."*
  - Ensure the local in-memory session holds an authoritative lock until the final question is submitted.

---

### Case SYS-08: Accidental Page Refresh (F5 / Cmd+R)
- **User Perspective (Candidate):** Candidate accidentally presses F5 or touches the browser reload button during Question 2. After reloading, they see: *"This link has already been used and is no longer valid."*
- **Root Cause:**
  - Invite token check marks the link as "consumed" or checks if `stage === 'interview'`. When re-entering, it thinks someone else is reusing the link.
- **Test Steps:**
  1. Start live assessment. Reach Question 2.
  2. Press F5 (Reload).
- **Expected Graceful Handling:**
  - Token should support **Session Resumption** within the allowed overall interview duration (e.g. 15 minutes).
  - If refreshed within the active window, prompt for 6-digit passcode and resume at Question 2 with remaining timer preserved.

---


## 2. Network & Server Communication Dropouts

### Case SYS-02: Wi-Fi Disconnects Mid-Answer
- **User Perspective (Candidate):** Candidate is speaking on Question 2. The home Wi-Fi blinks out for 20 seconds. Candidate finishes speaking and clicks "Next Question", but the screen hangs indefinitely on a loading spinner.
- **Root Cause:**
  - Answer submission `fetch('/api/interview/answer')` fails due to `net::ERR_INTERNET_DISCONNECTED`.
  - The handler catches the error, but auto-advance was either triggered or stuck, leaving the candidate in an inconsistent state.
- **Test Steps:**
  1. Reach Question 2. Speak an answer.
  2. Disconnect Wi-Fi.
  3. Click "Submit & Next".
- **Expected Graceful Handling:**
  - Banner: *"Connection lost. Your answer is saved locally. Reconnecting..."*
  - "Submit & Next" button changes to *"Retry Submission"* when back online.
  - Question timer should **pause** while offline so the candidate is not penalized for network outages.

---

### Case SYS-03: Network Drops Until Question Timer Expires
- **User Perspective (Candidate):** Wi-Fi goes down for 2 minutes. The countdown timer ticks down to 00:00 and tries to auto-advance, but fails to reach the server.
- **Test Steps:**
  1. Disconnect network on Question 1 with 15 seconds remaining.
  2. Let timer hit 00:00.
- **Expected Graceful Handling:**
  - Timer should freeze at 00:00 with: *"Time is up, waiting for connection to submit answer..."*
  - As soon as the connection is restored, upload the recorded audio and then transition to Question 2.

---

### Case SYS-14: Supabase / Backend 500 Error During Answer Submission
- **User Perspective (Candidate):** Candidate answers Question 1. Database returns a 500 Internal Server Error (e.g. Supabase connection pool exhaustion).
- **Test Steps:**
  1. Intercept `/api/interview/answer` to return HTTP 500.
  2. Click "Next".
- **Expected Graceful Handling:**
  - Red error alert: *"Server error saving answer. Please tap 'Retry'."*
  - Candidate remains on Question 1; answer text/audio is **not erased**.

---

## 3. AI Service (Gemini API) Quotas & Failures

### Case SYS-04: Gemini Quota (HTTP 429) During Real-Time Answer Transcription
- **User Perspective (Candidate):** Candidate speaks clearly for 60 seconds. Because Gemini rate limits are hit, transcription fails. Candidate sees blank answer text and assumes their microphone is broken.
- **Test Steps:**
  1. Mock Gemini API with HTTP 429 / Rate Limit Exceeded during answer upload.
  2. Complete question.
- **Expected Graceful Handling:**
  - Candidate sees: *"Answer audio recorded successfully (transcription processing in background)."*
  - The interview advances normally.
  - The WebM audio file is safely preserved in Supabase Storage so HR can listen directly.

---

### Case SYS-05: Question Generation Failure on Launch
- **User Perspective (Candidate & HR):** Candidate enters passcode, passes camera calibration, but the screen stays stuck on *"Preparing questions..."* indefinitely.
- **Root Cause:**
  - `/api/interview/questions` Gemini call times out or throws an unhandled exception.
- **Test Steps:**
  1. Provide an invalid Gemini API key or trigger an API timeout on question generation.
  2. Candidate enters interview room.
- **Expected Graceful Handling:**
  - Graceful fallback: Automatically switch to domain-specific offline question bank.
  - If offline bank fails: *"Unable to load interview questions at this time. Please contact support. Your invite remains valid."*

---

### Case SYS-06: Scoring API Quota Exhaustion Post-Interview
- **User Perspective (HR / Admin):** Candidate successfully completes all 5 questions. HR opens the dashboard report and sees *"Score: 0/100 — Candidate did not answer"*.
- **Root Cause:**
  - Evaluation endpoint failed due to Gemini quota; fallback logic treated empty evaluation JSON as zero scores.
- **Test Steps:**
  1. Complete an interview with mock Gemini quota error on the grading endpoint.
  2. View admin report.
- **Expected Graceful Handling:**
  - Report status: **"Scoring Pending (AI Service Busy)"** with an explicit **"Regenerate Score"** button.
  - Never display 0/100 or "Not Recommended" when the failure is a system-side AI timeout.

---

## 4. Browser, Worker & Machine Breakdowns

### Case SYS-07: Browser Out of Memory (OOM / Heavy Model Crash)
- **User Perspective (Candidate):** Candidate is 8 minutes into the interview on a modest 8GB laptop. Because FaceMesh and TensorFlow COCO-SSD retain memory, Chrome crashes with *"Aw, Snap! Error code: STATUS_BREAKPOINT"*.
- **Root Cause:**
  - Video bitmap memory leak in OffscreenCanvas or Web Workers accumulating canvas buffers.
- **Test Steps:**
  1. Run continuous 15-minute mock interview with DevTools Memory tab tracking heap size.
  2. Force tab termination via Task Manager to simulate browser crash.
  3. Reopen candidate invite.
- **Expected Graceful Handling:**
  - Memory leak prevention: Ensure bitmaps are explicitly `.close()`-ed after inference.
  - Crash recovery: Candidate can re-enter within the session window without the link being burned.

---

### Case SYS-09: Proctoring Web Worker Dies Mid-Interview
- **User Perspective (Candidate):** Midway through Question 2, the webcam tracking worker terminates (e.g. WebGL context lost or browser tab throttling).
- **Test Steps:**
  1. In Chrome DevTools > Application > Frames > Workers, manually click "Terminate" on `face-tracking.worker.ts`.
- **Expected Graceful Handling:**
  - Main thread detects worker death (`worker.onerror` or heartbeat watchdog).
  - Automatically re-instantiates worker in background without alarming the candidate.
  - Never terminate the interview or issue a cheating warning due to a dead background worker.

---

### Case SYS-10: Web Speech API Drops Silence / Network
- **User Perspective (Candidate):** Candidate speaks, but browser speech recognition stops transcribing after 60 seconds (a known Chrome `webkitSpeechRecognition` timeout bug).
- **Test Steps:**
  1. Speak continuously for > 60 seconds without clicking Next.
- **Expected Graceful Handling:**
  - Hook auto-restarts `recognition.start()` upon `onend` event while `isCandidateTurn` is true.
  - Audio recording (`MediaRecorder`) continues independently so audio evidence is never lost.

---

### Case SYS-11: Laptop Lid Close / Sleep Mode
- **User Perspective (Candidate):** Candidate's laptop battery dips and enters sleep mode for 10 seconds. When woken up, the page immediately displays *"Interview Terminated: You switched tabs or minimized the window."*
- **Root Cause:**
  - `document.visibilityState === 'hidden'` fired continuously during sleep.
- **Test Steps:**
  1. Close laptop lid for 10 seconds during Question 1.
  2. Reopen lid.
- **Expected Graceful Handling:**
  - Distinguish genuine Alt-Tab (short window blur while machine timestamp advances normally) from sleep mode (system clock jumps ahead while all JS execution freezes).
  - If system sleep occurred, display: *"Your computer entered sleep mode. Click 'Resume Interview' to continue."* instead of a cheating penalty.

---

### Case SYS-12: Hardware Disconnect (Camera or Headset Unplugged)
- **User Perspective (Candidate):** External webcam cable is jostled loose.
- **Test Steps:**
  1. Disable camera device in Windows Device Manager or unplug external camera mid-interview.
- **Expected Graceful Handling:**
  - `stream.getVideoTracks()[0].onended` listener triggers.
  - Screen shows: *"Camera disconnected. Please reconnect your video device."*
  - Interview timer automatically pauses until the video track is restored.

---

## 5. Verification Checklist for Developers & QA

Before deploying to production, execute this verification run:

- [ ] **Token Expiration Isolation:** Verify that background status pollers do not abort active in-memory interviews.
- [ ] **F5 Page Refresh:** Verify whether F5 preserves candidate answers and remaining time.
- [ ] **Offline Guard:** Turn off Wi-Fi on Question 2, verify timer pauses and answers are retained.
- [ ] **AI Quota Simulation:** Mock Gemini HTTP 429 and verify audio recording still saves to Supabase.
- [ ] **Worker Recovery:** Kill workers in DevTools and verify watchdog restarts them without proctoring strikes.
- [ ] **Memory Profiling:** Verify heap usage stays flat (< 250MB) over 15 minutes of continuous inference.
