# AI Interview Breakpoints Resolution Plan

This document outlines the root causes and actionable resolution plans for the 18 identified breakpoints in the AI Interview Module. 

---

### 1. Missing Questions on Page Refresh After Link Generation
* **Scenario**: Candidate generates a link, refreshes the page (or checks recent interviews), but upon entering, no questions are shown.
* **Root Cause**: Interview questions are likely being held in local state (browser memory) or the token is being invalidated on the initial load without persisting the generated questions to the database.
* **Action Plan**: 
  1. **Persist First**: Ensure that dynamic questions generated via AI are saved to the `ai_interviews` or `interview_sessions` database table *before* the user joins.
  2. **Fetch from DB**: On page load, always fetch the questions directly from the database using the session token, rather than regenerating them or relying on React state.

### 2. Cannot Continue Interrupted Interview
* **Scenario**: User is unable to resume if the interview is interrupted by a system issue or browser crash.
* **Root Cause**: The session's progress (current question index, saved answers) is strictly tied to React state. Once the browser closes, the state resets.
* **Action Plan**: 
  1. **Track Progress**: Update the `current_question_index` in the database after every question.
  2. **Resume Logic**: Modify the `/api/interview/verify` endpoint. If a session is `in_progress`, return the saved progress so the frontend can jump directly to the unanswered question instead of starting over.

### 3. Gemini Quota Issues
* **Scenario**: Interview breaks or hangs due to Google Gemini API quota limits.
* **Root Cause**: The system relies synchronously on Gemini for generating questions or evaluating answers without a robust fallback.
* **Action Plan**: 
  1. **Predefined Fallbacks**: If the Gemini API returns a 429 (Too Many Requests), instantly fall back to a predefined set of static questions categorized by job role.
  2. **Async Evaluation**: Move answer evaluations to a background cron job or queue, rather than blocking the real-time user flow.

### 4. Simple Words ("no", "hi") Give 100% Match
* **Scenario**: Short, meaningless answers receive a perfect score.
* **Root Cause**: The matching algorithm is likely doing naive substring matching or basic keyword intersection, which fails on short strings.
* **Action Plan**: 
  1. **Minimum Length Check**: Add a validation step rejecting answers under a certain word count (e.g., < 10 words).
  2. **Semantic Scoring**: Use a more robust prompt for the LLM to evaluate *context* and *correctness*, not just keyword presence.

### 5. Mic/Webcam Removal Terminates Instantly
* **Scenario**: Removing a mic/webcam immediately terminates the interview and shows an expired link.
* **Root Cause**: The `devicechange` or stream `ended` event instantly triggers the `terminate` API endpoint.
* **Action Plan**: 
  1. **Grace Period**: Instead of instant termination, pause the interview timer and display a blocking "Device Disconnected" modal.
  2. **Reconnect Window**: Give the user a grace period (e.g., 60 seconds) to plug the device back in before officially terminating the session.

### 6. Limit Reached -> Predefined Questions
* **Scenario**: The system falls back to predefined questions when the dynamic generation limit is reached.
* **Root Cause**: Expected fallback behavior.
* **Action Plan**: 
  1. **Validation**: Yes, this is an acceptable and recommended fallback strategy. We just need to ensure the predefined questions are mapped correctly to the candidate's applied role to maintain relevance.

### 7. Data Loss When Timer Expires
* **Scenario**: If the per-question or total interview time runs out, the current answer data is lost.
* **Root Cause**: The timer's `setTimeout` forcefully moves the UI to the next question without waiting for the `MediaRecorder` to finalize and upload the blob.
* **Action Plan**: 
  1. **Await Upload**: When the timer hits 0, trigger the `stop()` method on the recorder, show a "Saving..." spinner, and explicitly `await` the API upload before advancing the `currentQuestionIndex`.

### 8. Answers Stored in Browser Memory Fail
* **Scenario**: Answers are kept in memory and uploaded at the end, leading to failures and data loss on crashes.
* **Root Cause**: `Blob` arrays are stored in React state until the final "Submit" button is clicked.
* **Action Plan**: 
  1. **Continuous Sync**: Upload the video/audio chunk and transcript to the database *immediately* after each question is answered.

### 9. Supabase 1GB Storage Limit
* **Scenario**: Video files will rapidly exhaust the 1GB Supabase storage limit.
* **Root Cause**: Supabase Storage is being used for heavy media files.
* **Action Plan**: 
  1. **External Storage**: Transition video uploads to Google Drive (via Resumable Uploads / Service Account) or AWS S3, as outlined in the `Full_Video_Recording_Architecture.md` document.

### 10. Accidental Refresh Ends Interview
* **Scenario**: User refreshes to check network, resulting in termination or data loss.
* **Root Cause**: The app lacks `beforeunload` protections and session resumption capabilities.
* **Action Plan**: 
  1. **Prevent Default**: Add a `window.addEventListener("beforeunload", ...)` to prompt the user before refreshing.
  2. **Safe Resumption**: Combined with Point 2, if they do refresh, the system should seamlessly fetch their last state from the database without penalty.

### 11. "Joined" Status Before Clicking Join
* **Scenario**: The session is marked as "started" simply by visiting the page.
* **Root Cause**: The status update is attached to the page load (`/api/interview/verify`) instead of a deliberate user action.
* **Action Plan**: 
  1. **Decouple Logic**: Keep `verify` strictly for validation. Create a dedicated `/api/interview/start` endpoint that fires *only* when the candidate clicks the "Join Interview" button.

### 12. Weak User Connection Drops Data
* **Scenario**: Network drops cause data to be lost.
* **Root Cause**: Failed `fetch` requests are not retried.
* **Action Plan**: 
  1. **Offline Mode**: Catch network errors during upload. Store the answer temporarily in `IndexedDB`.
  2. **Retry Mechanism**: Poll for network restoration and automatically sync cached answers in the background.

### 13. External Camera Disconnect Lacks Explicit Error
* **Scenario**: Disconnecting a camera fails silently or terminates without explaining why.
* **Root Cause**: Lack of specific UI feedback for the `devicechange` event.
* **Action Plan**: 
  1. **Explicit UI**: Listen to `navigator.mediaDevices.ondevicechange`. If the active video track is lost, immediately overlay a strict warning: "Camera disconnected. Please check your USB connection."

### 14. User Refresh Terminates User, Admin Doesn't See It
* **Scenario**: User refreshes, terminating their session, but the admin screen still shows it as active.
* **Root Cause**: The Admin dashboard lacks real-time subscription to session status changes.
* **Action Plan**: 
  1. **Supabase Realtime**: Implement a Supabase Realtime channel in the Admin View listening for updates to `interview_sessions`. When status changes to `terminated`, instantly reflect this on the admin screen.

### 15. Tab Change Doesn't Terminate When Admin is Present
* **Scenario**: Candidate changes tabs, but if an admin is watching, the interview doesn't terminate.
* **Root Cause**: Proctoring logic (`visibilitychange`) might be bypassed when a second participant (admin) is in the session room.
* **Action Plan**: 
  1. **Strict Proctoring**: Ensure the `visibilitychange` listener on the candidate's browser operates independently of the admin's presence. Tab switching should consistently flag or terminate the session based on strict mode settings.

### 16. Not Moving to Next Question When Time Completes
* **Scenario**: The timer hits 0:00 but the screen stays stuck on the current question.
* **Root Cause**: The `useEffect` dependency array for the timer is missing the `handleNext` function, or state isn't triggering a re-render.
* **Action Plan**: 
  1. **Fix Timer Logic**: Ensure the interval checks `if (prev <= 1)` and fires the auto-advance logic correctly, taking care to unmount/clear the interval to prevent double-firing.

### 17. Admin Can Click/Change Questions in Ongoing Interview
* **Scenario**: Admins can interact with the candidate's controls, altering the interview flow.
* **Root Cause**: The Admin View is rendering the standard User UI without disabling interactions.
* **Action Plan**: 
  1. **Read-Only Mode**: Pass an `isReadOnly={true}` or `role="admin"` prop to the interview component. Disable all buttons, inputs, and timer controls if this prop is true.

### 18. Taking Two Resumes as Input
* **Scenario**: The UI allows multiple resumes, skewing keyword extraction.
* **Root Cause**: The file input element is missing the `multiple={false}` attribute, or the API accepts an array.
* **Action Plan**: 
  1. **Frontend**: Set `<input type="file" multiple={false} />`.
  2. **Backend**: Validate that `req.files.length === 1` and strictly extract text from only the first file.
