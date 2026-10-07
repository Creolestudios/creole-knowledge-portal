# AI Interview Module: Real-Time Frontend Flow Breaks (End-User Testing)

When performing rigorous end-user testing on the UI flow, we encounter several highly reliable breakpoints. These are scenarios where normal, expected user behavior (or slight environmental variations) perfectly breaks the application logic, causing data loss, infinite hangs, or unfair lockouts.

## 1. The "Fake Success" (Data Loss on Tab Close)
**Scenario**: The candidate reaches the final question, finishes their answer, and clicks the "Submit Interview" button. The screen instantly transitions to the "Interview Completed" success page. The candidate, seeing they are done, immediately closes the browser tab.
**The Break**: 
- **Silent Data Loss**: The candidate's final audio recording and the crucial `/api/interview/complete` API call are completely lost.
- **Why it breaks**: In `submitFinalAnswer()` (line 651), the frontend fires background `fetch` requests (for audio upload and interview completion) and then *synchronously* calls `setStageWithRef('completed')`. Because these `fetch` calls lack the `keepalive: true` flag, and file uploads cannot survive tab closures, the browser instantly aborts these pending network requests when the tab closes.
- **Impact (Critical)**: The candidate believes they successfully submitted everything, but the recruiter receives an incomplete report missing the final answer and the session is never officially marked as "completed" in the database.

## 2. The "Infinite Calibration Hang" (Resource Blocking)
**Scenario**: The candidate grants permissions and enters the Calibration stage. However, they are on a restrictive corporate network (which blocks the WebWorker from downloading the TensorFlow models) or are using a low-end laptop where WebGL initialization fails silently.
**The Break**: 
- **Stuck Screen**: The user is stuck staring at the Calibration Modal indefinitely. 
- **Why it breaks**: The transition from `calibration` to `interview` strictly relies on the WebWorker sending a `calibration_complete` message. There is absolutely no timeout mechanism, error fallback, or "Skip Calibration" button if the worker silently stalls, crashes, or takes longer than expected to download its models.
- **Impact (High)**: The candidate cannot start the interview and has no UI feedback explaining why they are stuck. Refreshing the page triggers the "Premature Lockout" bug (mentioned in previous audits), permanently burning their link.

## 3. The "Unfair Proctoring Insta-Kill" (Event Stacking)
**Scenario**: A candidate is taking the interview in their bedroom. A family member briefly walks behind them holding a smartphone.
**The Break**: 
- **Instant Termination**: The interview abruptly terminates and kicks the candidate out before they can even read the warning.
- **Why it breaks**: The object detection loop runs every 100ms. While there is a 5-second debounce for *the same object category*, multiple distinct violations stack instantly. The worker detects a 'person' (Warning 1) and a 'phone' (Warning 2) in the same frame. Startled by the family member, the candidate looks over their shoulder, triggering a face tracking 'Looking Away' event (Warning 3). The `terminatingRef.current` threshold (>=3 warnings) is met within 200 milliseconds. 
- **Impact (High)**: The candidate receives 3 strikes simultaneously and the session auto-terminates without giving them any human grace period to correct their environment.

## 4. The "Ghost Audio Mute" (Hardware Swapping)
**Scenario**: A candidate is in the waiting room (`ready` stage) and decides to switch from their laptop microphone to their Bluetooth AirPods using the "Device Settings" gear icon.
**The Break**: 
- **Silent Audio Drop**: The new audio device connects, but the AI Voice Guard and transcript recorder fail to capture the new stream.
- **Why it breaks**: The `useAudioVoiceGuard` and `useRealtimeTranscript` hooks initialize their `AudioContext` and `MediaRecorder` instances based on the initial `cameraStream`. While the UI might update `cameraVideoRef.current.srcObject`, the underlying Web Audio API graph and MediaRecorder do not automatically re-bind to the new audio tracks of the updated stream.
- **Impact (Medium)**: The candidate speaks their answers normally, but the system records total silence, resulting in a 0% fluency score and a blank transcript for the entire interview.

## 5. The "Timer Desync" (Rapid Navigation)
**Scenario**: The candidate has 2 minutes per question. On Question 1, with 5 seconds left on the timer, they panic and rapidly click "Next Question" multiple times.
**The Break**: 
- **Timer & Question State Corruption**: The candidate skips entirely over Question 2 and lands on Question 3, but the timer is completely broken.
- **Why it breaks**: The `goToQuestion` function sets a `goingToNextRef` guard, but the timer's `setInterval` uses a `setTimeout` wrapper to trigger `goToQuestion(cq + 1)` when it hits zero. If the manual click and the timer expiration overlap within the 500ms debounce window, the closures capture overlapping state, firing `setCurrentQuestion` twice.
- **Impact (Medium)**: The candidate loses the opportunity to answer one of the questions, and the timer visually glitches or resets improperly for the remainder of the session.

## Additional Reported Breakpoints & Edge Cases (QA Testing)

The following issues were identified during extended QA and end-user testing and need to be addressed to ensure session stability:

1. **Missing Questions on Refresh**: Generating a user link, refreshing the page, and accessing the interview from the "recent interview" section results in no questions being displayed.
2. **System Interruption Recovery**: Users cannot currently continue an interview if it gets interrupted midway due to a system-side issue.
3. **Gemini Quota Exhaustion**: If the Gemini API quota is reached during any point of the interview, the session breaks similarly to a system interruption.
4. **False Positive Matching**: In descriptions, entering simple single words like 'no' or 'hi' incorrectly results in a 100% match score.
5. **Hardware Disconnection Lockout**: At the time of joining, removing microphone or camera access causes the interview to terminate immediately and shows an expired link.
6. **Dynamic Question Fallback**: When the dynamic technical question generation limit is exceeded, the system silently falls back to predefined questions.
7. **Timeout Data Loss**: If the fixed time for a question or interview expires, the recorded data is lost instead of being auto-submitted.
8. **Browser Storage Failures**: Answers are currently stored in browser memory before syncing to the database, which fails in many scenarios causing data loss.
9. **Supabase Storage Limits**: Storing answers quickly consumes storage space (1 GB limit on Supabase). A retention policy or cleanup mechanism is needed.
10. **Accidental Refresh Loss**: If a user accidentally refreshes the current interview page, the interview state is lost or permanently terminated.
11. **Premature Status Update**: The interview status is incorrectly marked as "joined" before the user actually clicks the "Join Interview" button.
12. **Weak Connection Handling**: The system does not handle weak internet connections gracefully, leading to silent drops.
13. **External Camera Disconnect**: If an external camera is disconnected, the UI should explicitly show an error and prompt the user to reconnect, rather than silently failing.
14. **Admin Desync on User Refresh**: When both user and admin are joined, and the user refreshes the page, the user's interview terminates, but the admin is not shown the termination screen.
15. **Admin Bypass Proctoring**: When an admin and user are joined, if the user changes tabs, the interview proctoring fails to terminate the session.
16. **Stuck on Timer Expiry**: The system sometimes fails to automatically advance to the next question when the timer completes.
17. **Admin Intervention Bug**: Admins should only be able to supervise (read-only), but the UI currently allows admins to change questions and interfere with the ongoing interview.
18. **Multiple Resume Extraction**: The system currently accepts two resumes as input and incorrectly extracts keywords from both simultaneously.
