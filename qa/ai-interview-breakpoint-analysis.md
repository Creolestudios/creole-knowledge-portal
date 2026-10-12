# AI Interview — System-side failure test cases

These cases are **not** “candidate cheated / 3 warnings.”  
They are cases where **our system** drops, hangs, or kills an **in-progress** interview or admin flow (quota, crash, timeout, network, worker, DB).

Two suites:

1. **User testing** — Candidate and Admin/HR. What they do, what they see today vs what they must see.
2. **Developer testing** — How to inject the same failure, which API/module, pass/fail for the backend.

---

# Part A — User point of view

## A1. Candidate — interview already started, then the platform fails

### U-C01 — Laptop internet drops mid-answer
**Setup:** Candidate is on question 2, speaking.  
**Do:** Turn Wi‑Fi off for 30 seconds, then on.  
**Must not:** Blank white screen, frozen timer with no message, or “Interview terminated” (that is for cheating, not network).  
**Must:** Show “Connection lost — answers may not be saving. Reconnecting…” Keep camera on. After reconnect, stay on the **same question** with spoken text still visible. If save failed, show “Last answer not saved — tap Retry.”

---

### U-C02 — Wi‑Fi stays off until the question timer hits 0
**Do:** Disconnect until the question auto-advances.  
**Must:** Not skip questions silently. Either pause the timer while offline, or after reconnect show “Question 2 may not have been saved.”  
**Break today:** Auto-advance still runs locally; `fetch` to save answers is `.catch`’d and ignored — speech can vanish.

---

### U-C03 — Tab sleeps / laptop lid close / Windows sleep (not Alt-Tab cheat)
**Do:** Close lid for 10 seconds during a live question, reopen.  
**Must not:** Instant “You switched tabs” terminate if the product intent is only real tab-switch cheating.  
**Must:** Either resume with a clear “Your computer slept — continue?” **or** if policy is terminate, the message must say **computer sleep / connection**, not a cheating warning.

---

### U-C04 — Chrome kills the tab (memory) because face + object models are heavy
**Do:** Run interview 10+ minutes on a 8 GB laptop with other tabs open.  
**Must not:** Tab crash with no recovery.  
**Must:** If Chrome “Aw, Snap”, reopening the link must explain **system crash**, not “link already used,” and HR must see “session interrupted — incomplete.”

---

### U-C05 — Face-tracking model fails to load (CDN / WASM / GPU)
**Do:** Start interview with `storage.googleapis.com` blocked, or on a PC with no GPU and WASM blocked.  
**Must not:** Calibration spinner forever, then a sudden terminate with a **proctoring** reason.  
**Must:** “Face check could not start (system). Please refresh or use Chrome on desktop.” Do not consume the invite as “used” if they never reached Q1. Do not continue **unprotected** with no message.

---

### U-C06 — Face worker dies **during** question 3
**Do:** After calibration succeeds, kill the worker (DevTools: terminate worker) or let GPU context lost.  
**Must not:** Interview freeze, or silent continue with no face check and no notice.  
**Must:** Banner “Integrity camera check stopped (system). We paused the timer.” Button Retry. If retry fails, end as **system interruption**, not 3-warning terminate.

---

### U-C07 — Object-detection worker fails mid-session
**Same as U-C06** for the COCO-SSD worker.  
**Must:** Same pause/retry. Cup/TV false warnings are a different issue; this case is **model crash**.

---

### U-C08 — Microphone works, then Chrome Speech recognition dies
**Do:** Speak until captions appear, then trigger Speech API `network` / `no-speech` (disable network for speech only, or wait until Chrome stops `webkitSpeechRecognition`).  
**Must not:** Captions freeze while timer keeps running and “Next” still enabled with empty answer.  
**Must:** “We stopped hearing you (browser speech). Tap Reset mic.” If they speak but captions stay empty, still record audio so HR can listen.

---

### U-C09 — Audio recording upload fails (Gemini quota **or** storage)
**Do:** Answer clearly. Simulate save failure (HR/dev can break storage or Gemini). Click Next.  
**Must:** “Answer not uploaded. Stay on this question and retry.”  
**Must not:** Jump to next question and leave HR with a blank transcript.  
**Break today:** Next question fires even if answer POST fails (failure only `console.warn`).

---

### U-C10 — Gemini quota finishes **while transcribing an answer**
**What the student feels:** They spoke; Next seems to work; later HR says “you didn’t answer.”  
**Must:** Student sees “Answer saved as audio; text conversion delayed.” Interview **continues**. Report later shows audio + “transcription pending/failed,” not empty/poor scores as if they were silent.

---

### U-C11 — Page JS error (white screen) mid-interview
**Do:** Any unhandled exception (broken worker message, `questions` becomes empty).  
**Must not:** Silent white page while watchdog still running (tab hide = terminate).  
**Must:** Error boundary: “Something went wrong on our side. Your session is paused.” Refresh resumes or opens a **system-failed** screen, not expired.

---

### U-C12 — Questions API fails after camera already on
**Do:** Pass permissions, then `/api/interview/.../questions` returns 500/timeout.  
**Must:** “Questions could not load. Camera is on. Retry.” Invite still reusable.  
**Must not:** Empty interview room, timer 0, or auto-complete.

---

### U-C13 — Session cookie dropped mid-interview (Safari ITP / SameSite)
**Do:** Continue to Q2; answers start returning 401.  
**Must:** “Login to this interview expired. Re-enter passcode **without wiping answers**.”  
**Must not:** 410 “link already used” with all spoken answers lost.

---

### U-C14 — Overall timer hits 0 while complete/score API is down
**Do:** Let session clock end while backend is offline.  
**Must:** “Time is up. We could not submit — we will retry.” Keep a local copy of answers.  
**Must not:** Green “Interview complete” while DB still `in_progress`, or terminate-style red screen.

---

### U-C15 — Complete succeeds, scoring Gemini quota is already 0
**What student sees:** “Interview complete.” That is OK.  
**Must not:** Student blamed for “no report.”  
**Must (HR side, but student-visible if they have a thank-you page):** Do not imply they failed technically. Scoring is our job after they leave.

---

### U-C16 — Browser autoplay / AudioContext blocked
**Do:** Start Chrome with sound blocked / no click.  
**Must:** Voice check may be delayed, but interview must not die. Prompt “Click anywhere to enable audio check.”

---

### U-C17 — Screen-share Chrome HUD / permission bubble looks like “left the page”
**Do:** After Join, Chrome shows “You are sharing your screen.” Click that indicator.  
**Must not:** Instant terminate for tab switch.  
**Must:** Interview continues; if we cannot support that HUD, warn before join: “Don’t click the share bar.”

---

### U-C18 — Second monitor / OS notification steals focus
**Do:** Outlook toast, Teams popup during Q1.  
**Must not:** Terminate unless they actually hid the tab.  
**Must:** Only `document.hidden` (real tab switch) if that is policy — not every focus loss.

---

### U-C19 — Refresh by accident (F5) — system recovery, not cheating
**Do:** F5 on question 3.  
**Must:** Honest message: either “You cannot refresh — session ended as interrupted (not a warning strike)” **or** “Resume question 3.”  
**Must not:** Passcode screen then “already used” with no explanation, while HR still sees `in_progress`.

---

### U-C20 — Two tabs of the same link (student mistake, not two people)
**Do:** Open invite twice.  
**Must:** “This interview is already open in another tab.”  
**Must not:** First tab silently dies with a cheating/terminate reason.

---

## A2. Admin / HR — create link, watch live, read report

### U-A01 — Gemini quota dies **during resume/JD extract**
**Do:** Upload resume+JD when Gemini daily quota is exhausted.  
**Must:** Red, explicit: “AI extract unavailable (quota). Not using guessed keywords.” Block Generate Link until they confirm fallback **or** retry tomorrow.  
**Must not:** Silent weak keywords → a real candidate link that asks generic questions.

---

### U-A02 — Gemini quota dies **after extract, during question generation**
**Do:** Extract OK, click generate when quota is now 0.  
**Must:** “Could not generate questions (AI quota).” Session stays draft. **No invite.**  
**Must not:** Link with 5 generic fallback HR questions and HR thinking they are JD-specific.

---

### U-A03 — Gemini quota dies **after the student finished** (scoring)
**Do:** Candidate completed. Quota 0. Open report.  
**Must:** Status **Scoring failed / Pending retry**, not “Not recommended” from empty answers. Button Retry score.  
**Must not:** Blank competencies treated as the student scored 1/5.

---

### U-A04 — Admin is watching live; their Wi‑Fi drops
**Do:** Candidate still online; admin reconnects.  
**Must:** Rejoin same question. Candidate **must not** be terminated because admin disconnected.

---

### U-A05 — Admin video (WebRTC) never connects (office firewall, no TURN)
**Do:** Join as admin from another network.  
**Must:** “Live video unavailable (network). Proctoring events still listed.”  
**Must not:** Blank tiles and no explanation; must not end the candidate session.

---

### U-A06 — Create-link half-finishes (session created, invite API 500)
**Do:** Click Generate Interview Link; kill network after session exists.  
**Must:** “Session created but link failed. Retry invite.”  
**Must not:** Success toast with no URL, or a dead session HR cannot find.

---

### U-A07 — Dashboard does not update while candidate is live
**Do:** Candidate in Q2; admin leaves dashboard open with realtime blocked.  
**Must:** Still move to In progress via poll, or “Live updates delayed.”  
**Must not:** Stay Pending so HR thinks nobody joined.

---

### U-A08 — Report page while scoring still running
**Do:** Open report 5 seconds after complete.  
**Must:** “Scoring in progress…”  
**Must not:** Empty report that looks like a failed candidate.

---

### U-A09 — Storage full / snapshot bucket missing
**Do:** Warnings occur but snapshots 500.  
**Must:** Event still listed: “photo not stored (system).” Interview continues.  
**Must not:** Student terminated because evidence upload failed.

---

### U-A10 — Wrong host on the invite (localhost / old domain)
**Do:** Copy link from a misconfigured env.  
**Must:** Link opens the real app or admin sees a config error **before** sending to the student.  
**Student must not:** 404 after HR already sent the mail.

---

# Part B — Developer point of view

Same failures, injectible. **Pass** = interview or pipeline degrades safely. **Fail** = student stopped as if they cheated, or data lost with HTTP 200.

How to inject: mock Gemini 429, `fetch` abort, worker `error`, 401 cookie, 500 from Supabase.

---

## B1. Gemini quota / LLM (in the middle of a pipeline)

| ID | When quota/429 hits | Inject | Pass (system) | Fail (breaks ongoing system) |
| :--- | :--- | :--- | :--- | :--- |
| D-G01 | Mid **extract** | Mock `generateContent` 429 on all models | `{ isFallback: true, apiFailed: true }` **and** UI blocks invite without confirm | Invite created from “Sample Resume” keywords |
| D-G02 | Mid **question generate** | 429 after session POST succeeded | `SessionGenerationError` stage=`questions`; **no** invite row; session `draft`/`parsed` | Invite URL returned; GET questions seeds generic bank |
| D-G03 | Mid **answer transcribe** | 429 inside `transcribeAnswer` after audio uploaded | Audio path saved; `transcribed: false`; client stays on question or shows pending | Answer POST 500 **or** 200 with empty transcript then Next wipes context |
| D-G04 | Transcribe **timeout** > 45s | Delay Gemini 60s | Timeout; audio kept; interview thread not blocked > 45s | Request hangs; Next button stuck; student thinks app died |
| D-G05 | Mid **scoring** after complete | 429 all `SCORING_MODELS` | Session remains `completed`; report `failed`; retry endpoint | Complete 500 so student UI never finishes **or** report filled with score 1 as silence |
| D-G06 | Quota dies **between** Q2 save and Q3 | First answers POST OK; second transcribe 429 | Q2 audio stored; Q3 still allowed | Q3 blocked or whole session terminate |
| D-G07 | Extract OK, generate OK, **score** uses different model list that is all exhausted | Cooldown map `exhaustedModelsUntil` on this instance | Other instances still try; this instance returns failed report | In-memory cooldown differs per lambda → flaky score, silent empty report |
| D-G08 | `GEMINI_API_KEY` missing only on **server** | Unset env on API, UI still up | Extract/transcribe/score all explicit failure notes | Client looks healthy; every transcript null; HR thinks student mute |

---

## B2. Student still in the room — platform/backend dies

| ID | Failure | Inject | Pass | Fail |
| :--- | :--- | :--- | :--- | :--- |
| D-S01 | Answers API 500 on Next | Mock POST answers 500 | UI does not advance; retry | `goToQuestion` anyway (current `.catch`) |
| D-S02 | Answers API timeout | Delay 30s | Client abort + retry; timer pause optional | Double submit / duplicate rows / lost blob |
| D-S03 | Questions GET 500 after verify | 500 | Permissions screen retry; invite not consumed **or** reversible | Seed fallback questions / empty `questions=[]` with timer running |
| D-S04 | Questions GET hang | Never resolve | Timeout message | Calibration+watchdog run on empty question list |
| D-S05 | Complete API down at last question | 500/offline | Stage stays interview or “submit retry”; not fake completed | `setStage('completed')` before server ACK |
| D-S06 | Score called instead of complete on overall timer | Timer 0 | Same transactional complete as Finish button | `/score` only; invite still `in_progress` |
| D-S07 | Verify cookie missing mid-way | Drop cookie | 401 → re-verify; answers kept | 401 swallowed; later 410 used |
| D-S08 | Supabase Postgres down | Pause DB | All writes 503; UI “system unavailable” | Client terminate because events POST failed (must not) |
| D-S09 | Supabase Auth/Realtime down | Disable websocket | Interview continues without admin video | JS exception unsubscribes media → watchdog `ended` → false terminate |
| D-S10 | Storage `interview-answer-audio` missing | Bucket error | Transcript-only save or retry; visible error | 500 with no client message; Next still proceeds |
| D-S11 | Storage snapshots fail | Upload error | Event stored `snapshot_missing` | Route returns `{ success: true }` (false evidence) **and/or** student killed |
| D-S12 | `maxDuration` serverless kill (extract 60s, score 60s) | Slow Gemini | Partial result or 504 with retry | Client infinite spinner; orphan session |
| D-S13 | Vercel instance A vs B (in-memory session lock) | Two parallel verify POSTs | DB conditional update: one 200 one 409 | Both 200; two live candidates |
| D-S14 | Lambda recycle mid-heartbeat | Restart server after verify | Cookie+DB still in_progress; student continues | Second request 409 concurrent against **self** |
| D-S15 | Unhandled exception in page.tsx | Throw in worker `onmessage` | Error boundary; media still on until user confirms exit | React crash; tracks end; watchdog terminate |
| D-S16 | `questions` array emptied (bad JSON) | Return `{ questions: null }` | Stay on last known question | Render crash / timer against length 0 / auto submitFinal |
| D-S17 | Terminate API fails when **we** intend system-abort | 500 | Client shows interrupted; retry persist status | UI terminated, DB still in_progress (ghost session) |
| D-S18 | Events API down during a real warning | 500 | Toast still; strike counted locally **and** retry queue | Strike 3 locally, DB 0 warnings, or opposite |

---

## B3. Media / browser / workers (system, not cheating)

| ID | Failure | Inject | Pass | Fail |
| :--- | :--- | :--- | :--- | :--- |
| D-M01 | FaceLandmarker `init` error | Fail WASM path | `faceTrackingStatus=error`; block start | Stage interview with no tracker |
| D-M02 | GPU delegate fail then CPU fail | Both throw | Same as D-M01 | Hang on calibration 0% |
| D-M03 | Worker dies after 15 samples | `worker.terminate()` | Reload worker + baseline; pause timer | `stage` stuck; or `ended` on dummy canvas |
| D-M04 | `createImageBitmap` throws | Detached video | Skip frame; no crash | Uncaught → full page death |
| D-M05 | Object worker model 404 | Bad model URL | Error banner; optional continue with face-only **explicitly** | Instant terminate |
| D-M06 | SpeechRecognition `onerror=network` | Dispatch error | Auto-restart or Reset CTA | `onend` without restart; silent captions |
| D-M07 | MediaRecorder `unsupported` | Hide MediaRecorder | Interview allowed; flag `audio_missing` | Nothing recorded; scores as silent |
| D-M08 | AudioContext `suspended` | Don’t click | Resume on first click; no voice strikes in that window | False “background voice” burst after resume |
| D-M09 | getUserMedia device lost (`ended`) | Disable camera in OS | Message “camera disconnected — system/device”; recovery 10s | Same copy as “you turned off webcam” cheat terminate with no retry |
| D-M10 | Screen share `ended` because Chrome crashed share | Kill share from OS | Recovery share prompt | Immediate terminate, invite revoked, cannot retry |
| D-M11 | Duplicate watchdog + admin hidden tab | Admin `document.hidden` | Candidate session untouched | POST terminate on candidate |
| D-M12 | `visibilitychange` from browser notification permission | Request permission mid-interview | No terminate | False pageHidden |

---

## B4. Admin live join / signaling

| ID | Failure | Inject | Pass | Fail |
| :--- | :--- | :--- | :--- | :--- |
| D-A01 | ICE fail (no TURN) | Block UDP STUN | `remoteStream=null` + banner | `connectionState=failed` stops **candidate** tracks |
| D-A02 | Signaling channel `CHANNEL_ERROR` | Invalid supabase key on admin | Admin retry join | Broadcast `terminate` accidentally |
| D-A03 | Admin sends `admin-left` | Leave button | Candidate camera stays live | Candidate `srcObject` null + watchdog |
| D-A04 | Spoof broadcast `type: terminate` | Second client | Ignored unless server says so | Candidate UI terminated, DB live |
| D-A05 | Poll `/verify` every 4s while not started | Candidate still on passcode | Stay waiting | False `inProgress` → admin `getUserMedia` loop |

---

## B5. Data integrity after a system failure

After **every** case above, developer must assert:

1. `interview_sessions.status` is one of: still `in_progress` (recoverable), `completed` (student finished), `cancelled` **with** `termination_reason` / event `category` = **`system_error`** — never a fake `proctoring_violation` for quota/network.  
2. `interview_invites` is not `revoked` unless we truly voided the student.  
3. Spoken audio / last transcript for the current question is not deleted.  
4. Admin report can distinguish **Integrity fail** vs **Platform fail** vs **Incomplete**.  
5. No second candidate can join just because the first died on a 500.

---

# Part C — Smoke pack (run on staging when Gemini/network is actually broken)

**Candidate (30 min):** U-C01, U-C05, U-C08, U-C09, U-C12, U-C14, U-C19  
**Admin (15 min):** U-A01, U-A02, U-A03, U-A05, U-A06  
**Dev (CI + one staging inject):** D-G02, D-G03, D-G05, D-S01, D-S05, D-S13, D-M01, D-M11, D-A04

If those pass, the interview can survive **our** outages instead of looking like the student walked away or cheated.
