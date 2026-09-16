# QA Report — Interview Instructions / Permissions / Proctoring

**Module:** `app/interview/[id]/page.tsx` (+ `app/api/interview/verify/route.ts`, `app/api/interview/terminate/route.ts`)
**Scope:** Passcode → Instructions → Camera/Mic/Screen permission gate → "ready" stage tab-switch/device-stop proctoring
**Tested by:** QA (code review + jsdom scenario tests + manual flow trace)
**Date:** 2026-09-14 (bugs found); updated 2026-09-14 (BUG-01 through BUG-04 fixed)

## Summary

7/7 existing unit tests pass and lint is clean, but functional/security QA of the flow surfaced **1 critical**, **4 high**, and **5 medium/low** issues. The most serious: termination is **never persisted server-side**, so a terminated candidate can simply refresh the page and restart the interview from the passcode screen — the entire proctoring gate is bypassable with F5.

**Status: BUG-01, BUG-02, BUG-03, and BUG-04 are fixed** (see "Fix notes" under each). BUG-05 needs a product decision before it can be addressed — flagged, not yet changed. BUG-06 through BUG-12 remain open, tracked for a follow-up pass.

---

## Critical

### BUG-01 — Termination is client-only; refresh bypasses proctoring entirely
`terminateInterview()` only sets local React state (`setStage('terminated')`). Nothing is sent to the backend. `POST /api/interview/verify` (`app/api/interview/verify/route.ts:43-48`) only flips `status` from `pending` → `in_progress` once; if the interview is already `in_progress` it happily returns `{ verified: true }` again on every call.
**Repro:** Get terminated (switch tabs) → press F5 → re-enter the same passcode → back on the "ready" screen as if nothing happened.
**Impact:** The entire tab-switch/permission-teardown proctoring feature is decorative — it cannot actually stop a determined candidate.
**Fix:** On termination, call a new endpoint (e.g. `POST /api/interview/terminate`) that sets `status = 'terminated'` (or similar) server-side; have `verify` reject re-entry when status is `terminated`/`completed`.

**FIXED.** Added `terminated`/`terminated_at`/`termination_reason` to the `ai_interviews` schema (`supabase/migrations/20260914000000_add_ai_interview_terminated_status.sql`), a new `POST /api/interview/terminate` route, and `verify` now returns 410 when `status` is `terminated` or `completed`. The frontend calls `/api/interview/terminate` (via `navigator.sendBeacon`, with a `fetch(..., { keepalive: true })` fallback so it survives the tab tearing down) the instant `terminateInterview()` fires. Covered by `app/api/interview/terminate/route.test.ts`, new cases in `app/api/interview/verify/route.test.ts`, and `qa/proctoring-instructions-permissions.test.tsx` (TC-PROC-16).

---

## High

### BUG-02 — Camera stream leaks when screen-share is declined/cancelled
In `requestPermissions()`, `getUserMedia` resolves and `cameraStreamRef.current` is set **before** `getDisplayMedia` is awaited. If the user cancels the screen-share picker, `getDisplayMedia` rejects, execution jumps to `catch`, and the already-acquired camera/mic stream is **never stopped** — the webcam light stays on and the track is orphaned (no reference is released, `stopAllMedia()` is not called on this path).
**Repro:** Click "Allow & Start Interview" → grant camera/mic → cancel the screen-share dialog → note the webcam indicator light stays on.
**Fix:** Wrap in `try { ... } catch { stopAllMedia(); ... }`, or stop `cameraStream` specifically in the catch block before showing the error.

**FIXED (revised approach).** Stopping the camera on every failed retry conflicted with BUG-03's fix (which needs the camera kept alive to avoid a duplicate prompt) — so instead: the granted camera/mic stream is kept alive across retries within the same page load (fine, matches the existing `quiz-runner.tsx` setup-step pattern), and a new unmount-cleanup `useEffect` (`app/interview/[id]/page.tsx`) stops all granted tracks if the candidate navigates away or the component unmounts before finishing setup — so nothing is left running indefinitely. Covered by `qa/proctoring-instructions-permissions.test.tsx` TC-PROC-08 (stays alive for retry) and TC-PROC-08b (released on unmount).

### BUG-03 — Retrying permissions re-requests camera and duplicates the stream
If the first attempt fails at the screen-share step (partial share rejected, BUG-04, or cancelled), `cameraGranted` stays `true` and the camera badge shows "granted" — but clicking "Allow & Start Interview" again calls `getUserMedia` a **second time**, creating a brand-new `MediaStream` and overwriting `cameraStreamRef.current` without stopping the previous one (compounds BUG-02: each retry leaks one more camera stream/device handle). It's also a confusing UX: the browser re-prompts for a permission the UI already claims was granted.
**Fix:** Skip re-requesting `getUserMedia` when `cameraStreamRef.current` already has live tracks; only retry `getDisplayMedia`.

**FIXED.** `requestPermissions()` now checks `hasLiveCameraStream()` (all tracks `readyState === 'live'`) before calling `getUserMedia` again, and skips straight to `getDisplayMedia` on retry. The error message is also now context-aware — it says "Screen sharing was cancelled or denied..." instead of the misleading "all required" copy when camera/mic are already held (also resolves BUG-07). Covered by TC-PROC-09.

### BUG-04 — `displaySurface === 'monitor'` check is not reliable across browsers
Full-screen-share detection relies on `MediaTrackSettings.displaySurface`, which is Chromium-specific and either unsupported or inconsistently reported in Firefox/Safari. On a browser where `getSettings().displaySurface` returns `undefined`, `isFullScreen` is always `false`, and the candidate is **permanently blocked** from proceeding even after correctly sharing their entire screen, with no fallback or manual override.
**Fix:** Feature-detect (`'getDisplaySurface' in track ? ... : skip the check`) or show a soft warning instead of a hard block when the property is unavailable, so unsupported browsers aren't dead-ended.

**FIXED.** The check now only hard-blocks when `displaySurface` is positively reported as something other than `'monitor'` (i.e. the browser confirmed a partial share). When the browser doesn't report it at all (`undefined` — Firefox/Safari), the share is accepted rather than dead-ending the candidate. Covered by TC-PROC-15.

### BUG-05 — Instant, un-appealable termination with no grace period
A single `visibilitychange` event (document hidden) terminates immediately — no debounce, no "you have N seconds to return" warning, no distinction between a brief accidental Alt-Tab and a deliberate tab switch. This is stricter than the existing quiz-runner pattern (`components/quiz/quiz-runner.tsx`), which **pauses** (halt + resume) rather than permanently ending the session on a transient interruption.
Per the original request — "show **a warning** and terminate" — there is currently no distinct warning step shown before the terminal state; the terminal screen itself doubles as the only warning.
**Fix:** Confirm with product/stakeholder whether a short grace/warning period (e.g. 5s countdown toast) is wanted before hard termination, matching the quiz-runner halt UX, or whether instant termination is intentionally strict for interviews.

---

## Medium

### BUG-06 — DevTools / non-visibility escapes are not detected
Opening browser DevTools (F12) does not fire `visibilitychange` in Chrome/Edge, so a candidate can open DevTools, use the console, inspect the DOM, etc. without triggering termination — undermining the "or any other thing happen" requirement.
**Fix:** Out of scope for pure client JS (can't reliably detect DevTools cross-browser without brittle timing hacks) — document as a known limitation rather than silently leaving it uncovered.

### BUG-07 — Misleading error text after partial permission grant
If camera+mic succeed but screen-share is cancelled/denied, the catch-all message reads *"Camera, microphone, and full-screen sharing are all required to start this interview"* — while the UI panel above simultaneously shows a green check for "Webcam & microphone". The message contradicts the visible state and confuses the candidate about what still needs fixing.
**Fix:** Track which specific permission failed and tailor the message (e.g. "Screen sharing was cancelled — please share your entire screen to continue.").

### BUG-08 — No live camera preview before starting
The candidate never sees their own camera feed to confirm framing/lighting before the interview proctoring goes live (no `<video>` element bound to `cameraStreamRef`). Minor UX/quality gap for an interview product.

### BUG-09 — Accessibility gaps
- Passcode `<input id="interview-access-code">` has no `aria-label`/associated `<label>` — relies on placeholder + visual heading only.
- Error/warning banners (`AlertCircle`/red boxes, amber "stay on this tab" notice) have no `role="alert"`/`aria-live`, so screen-reader users won't be notified of verification failures or the termination warning automatically.
**Fix:** Add `aria-label` to the passcode input and `role="alert"` (or `aria-live="assertive"`) to error/termination messaging.

### BUG-10 — Copy says "leaving will end your interview" but termination is also triggered by device state, not just tab focus
The amber notice on the "ready" screen only warns about staying on the tab; it doesn't mention that stopping the camera/mic/screen-share from the browser's native controls will also end the session immediately. Candidates may not realize accidentally clicking "Stop sharing" in the browser toolbar is equally fatal.
**Fix:** Broaden the warning copy to cover both cases.

---

## Low

### BUG-11 — "Ready" screen still says "coming in the next phase"
Now that proctoring/termination logic exists, the placeholder copy ("Your interview session will start here. This step is coming in the next phase.") reads oddly alongside the new active monitoring warning — worth a copy pass once the real interview UI lands.

### BUG-12 — No confirmation checkbox for reading instructions
"Allow & Start Interview" triggers permission requests immediately; there's no explicit "I have read and understood the instructions" acknowledgement, so a candidate could scroll past without reading. Not a functional bug, but weak for compliance/audit purposes on a proctored interview.

---

## Fix Priority for Developer

1. ~~**BUG-01** (critical — proctoring is not actually enforced)~~ — **fixed**
2. ~~**BUG-02 / BUG-03** (device/stream leaks, compounding UX confusion — fix together, same code path)~~ — **fixed**
3. ~~**BUG-04** (blocks legitimate users on non-Chromium browsers)~~ — **fixed**
4. **BUG-05** (needs a product decision, not just a code fix) — **open, awaiting product input**: should a brief accidental tab-away get a grace/warning period before hard termination (like `quiz-runner.tsx`'s pause/resume), or is instant termination intentional for interviews?
5. BUG-06 through BUG-12 as time allows / in a follow-up pass — still open
