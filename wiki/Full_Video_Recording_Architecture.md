# Architecture Plan: Full Interview Video Recording

This document outlines the architectural strategy, implementation phases, and critical risks for recording a full, continuous video (Camera + Screen Share + Audio) during the AI Interview and storing it remotely.

## 1. Storage Destination Analysis

### Why Not Loom?
- **Disruptive UI**: Loom's Record SDK forces heavy UI elements and branding onto the screen.
- **User Friction**: It cannot record silently in the background; candidates must interact with a widget or log in.
- **Verdict**: Unsuitable for a seamless, white-labeled proctoring experience.

### Why Not Next.js API Routes?
- **Payload Limits**: Vercel limits serverless function payloads to 4.5MB and execution time to 10-60 seconds.
- **Failure Point**: Uploading a 300MB - 1GB video file at the end of the interview will instantly crash with a `413 Payload Too Large` or `504 Gateway Timeout` error.
- **Verdict**: Impossible for long-form video uploads.

### The Optimal Solution: Google Drive (Resumable Uploads)
The backend will generate a **Secure Upload URL** via the Google Drive API using a Service Account. The frontend uses this URL to bypass the Next.js server entirely, streaming video chunks directly into Google Drive. 

**Storage Management**: To solve the high storage volume (approx 150GB per month for 5000 interviews), a Vercel Cron Job will automatically delete video files older than 30 days from Google Drive. This enforces a rolling ~160GB cap, ensuring Google Drive storage limits are never breached.

---

## 2. Implementation Strategy

### Step 1: Compositing the Streams (Canvas Layering)
The `MediaRecorder` API can only record a single media stream at a time. To capture both the face and the screen simultaneously:
1. Create a hidden, off-screen `<canvas>` element (e.g., 1280x720).
2. Use `requestAnimationFrame` to draw the Screen Share video to the canvas background.
3. Draw the Camera video in the bottom-right corner (Picture-in-Picture).
4. Extract the unified stream: `const combinedStream = canvas.captureStream(30)`.
5. Attach the candidate's audio track to `combinedStream`.

### Step 2: Chunked Recording
We cannot wait until the interview ends to save the video.
1. Initialize `MediaRecorder` on the `combinedStream`.
2. Start recording with a strict timeslice: `mediaRecorder.start(5000)` (outputs a video chunk every 5 seconds).

### Step 3: Streaming Upload (Resumable)
1. On interview start, the frontend requests a Resumable Upload Session URL from the backend.
2. In the `ondataavailable` event, the frontend takes each 5-second `Blob` and immediately issues a `PUT` request to append it to the remote file.
3. **Benefit**: If a candidate accidentally closes the tab at minute 29, the first 29 minutes of the video are already safely stored in Google Drive.

---

## 3. Critical Problems & Mitigation (Expert Analysis)

Recording 30-60 minutes of video natively in a browser introduces severe hardware and network constraints. You must engineer around these 4 critical risks:

### Risk 1: Out of Memory (OOM) Browser Crash
- **The Issue**: Holding a 30-minute HD video array in the browser's RAM will consume 1-2 GB of memory, causing Chrome/Safari to instantly crash (OOM) on standard devices, permanently losing the interview.
- **Mitigation**: Strictly use the chunked streaming approach. Once a 5-second chunk is successfully uploaded, the frontend must immediately `null` the local blob and drop it from memory for garbage collection.

### Risk 2: Thermal Throttling & CPU Overload
- **The Issue**: The application is already running heavy TensorFlow models (Face Tracking, Object Detection) inside WebWorkers. Adding 30fps canvas compositing and H.264 video encoding will max out the CPU. Low-end laptops will overheat, throttle, and drop the video framerate to 1-2 FPS.
- **Mitigation**: Limit the canvas size to 720p or 480p. Throttle the canvas `requestAnimationFrame` loop to 15 FPS to save CPU cycles.

### Risk 3: Network Saturation
- **The Issue**: Continuous video uploading requires high outbound bandwidth. On slow 4G connections, video chunks will queue up locally faster than they can upload, eventually crashing the browser or causing lag.
- **Mitigation**: Severely compress the video. Initialize `MediaRecorder` with `videoBitsPerSecond: 500000` (500 kbps) to ensure even poor connections can sustain the upload stream.

### Risk 4: The "Ghost Upload" on Tab Close
- **The Issue**: If the candidate finishes the interview, sees the "Success" screen, and immediately closes the tab, the final 5-10 seconds of video chunks will be aborted mid-upload.
- **Mitigation**: Block the final state transition. When the user clicks "Submit", show a non-dismissible loading overlay (`"Finalizing and securing your interview video... 85%"`) until the frontend receives confirmation that the final chunk has reached Google Drive.

---

## 4. Report Integration: Direct Video Link Access & Timestamped Navigation

### Google Drive Video Link Card
- **Direct Video Link Integration**: The candidate evaluation report features a dedicated "Full Interview Video Recording" card providing direct, clean access to the Google Drive video via copyable link, inline URL, and one-click "Open in Google Drive ↗" button, removing heavy in-portal video player buffering.
- **Deep-Linked Timestamp Seeking**: When an admin clicks on any violation timestamp badge (`⏱️ MM:SS ▶`) or the jump action, the portal directly opens the recording in Google Drive targeting the exact second (`?t=XmYs`).
- **External Google Drive Access**: High-performance, authenticated streaming and sharing via Google Drive.

### Serial Strike Ordering & Accurate Timing
- **Chronological Serial Order**: Warnings are strictly numbered in chronological sequence:
  - **Strike 1**: The first violation that occurred.
  - **Strike 2**: The second violation that occurred.
  - **Strike 3**: The third violation (or terminal violation that triggered auto-termination).
  - Strike numbers use `meta.warningCount` / `meta.strikeNumber` and are sorted strictly ascending by `ts_ms`.
- **On-Screen Warning Banner Synchronization**:
  - `offsetSeconds` strictly reflects when the **warning banner was displayed on screen** to the candidate (`screenToastOffsetSec` / `explicitRecStart`), matching the exact second in the video recording where the visual warning toast is visible.
  - Does NOT reflect background detector threshold accumulation or sidebar feed logging, ensuring that seeking to the timestamp jumps directly to when the warning is visible on the candidate's screen.
  - Direct frame offsets (`meta.screenToastOffsetSec` / `meta.offsetSeconds`) captured synchronously by the browser's MediaRecorder at `setWarningToast` invocation are preserved and prioritized.
  - Offsets are strictly clamped to actual video duration (`recMeta.durationSeconds`).
- **Display Integrity & Timezone Accuracy**:
  - In-video timestamp seeking buttons (`⏱️ MM:SS ▶`) target the exact video second where the warning appears on screen.
  - Meeting timestamps (e.g. `🕒 03:55:51 PM`) use `rawTsMs` dynamically formatted in the user's browser timezone (IST/local) with explicit tooltips.

### Single Zoho Recruit Integration
- If an admin provided a Zoho Recruit URL during interview creation (`parsed_resume.zohoRecruiterLink`), a single `"Open in Zoho Recruit ↗"` button appears in the Candidate Information card header.
- If not attached, a clean `"Zoho Recruit: Not Attached"` badge is displayed, preserving the 4-column overview (`Name`, `Email`, `Role Applied`, `Interview Date`).

---

## 5. 90-Day Video Retention Dispatcher & Filler Word Analysis

### Automated 90-Day Google Drive Video Retention Dispatcher
- **Retention Policy**: To balance candidate data privacy compliance and cloud storage footprint, full video recordings are kept for exactly 90 days.
- **Dispatcher Engine (`lib/ai-interview/recording-retention-dispatcher.ts`)**:
  - Scans `interview_events` for `full_recording` events where `ts_ms < (now - 90 days)`.
  - Filters out already purged recordings for idempotency.
  - Safely deletes the files from Google Drive using `deleteDriveFile(fileId)`.
  - Handles 404 (already deleted) gracefully without breaking batch execution.
  - Updates the event row metadata: `status: 'purged'`, `purged_at: <ISO>`, and `retention_days: 90`.
- **Scheduled Trigger (`/api/cron/cleanup-recordings`)**:
  - Accepts `GET` request protected by `Authorization: Bearer <CRON_SECRET>`.
  - Supports `?dryRun=true` to preview purge candidates without destructive actions.
  - Designed for execution via cron job schedulers.
- **Graceful Report Degradation**:
  - If a video has been purged after 90 days, the candidate report card displays a clear notice:
    > *"Video Recording Archived (90-Day Retention Policy) — Purge completed on MM/DD/YYYY."*
  - Transcripts, verbatim answers, scores, and incident logs remain permanently preserved in the report.

### Verbatim Filler Word Detection & Visual Highlighting
- **Verbatim Capture**: Gemini transcribes exact verbal hesitations (`um`, `umm`, `uh`, `uhh`, `er`, `ah`, `like`, `you know`, `sort of`, `kind of`, `basically`, `actually`, `literally`, `i mean`).
- **Tilted Font Highlighting (`components/ai-interview/highlighted-verbatim-answer.tsx`)**:
  - Losslessly segments verbatim answer strings into standard text and verbal filler spans without modifying original spacing, casing, or punctuation.
  - Renders filler words in an **italicized, titled font with a subtle amber badge and hover tooltip** (`Verbal filler hesitation: "um"`).
- **Report Parameter Integration**:
  - Scorer persists `fillerCount`, `fillerRatio`, and `fillerBreakdown` into `report.local_metrics`.
  - The **English Communication** card features a dedicated **Filler Word Frequency** parameter row alongside Speaking Pace, objectively rating candidate delivery flow.

---

## 6. Live Google Drive Resumable Chunk Streaming & Universal Exit Guarantee

### 1. Progressive Chunk Streaming (`/api/interview/recording/stream-chunk`)
- Instead of uploading a large single video file at the end of the interview, the browser buffers recording chunks in 256 KiB slices (the Google Drive Resumable Upload specification minimum).
- Every few seconds, slices are uploaded in the background to Google Drive via the service account relay endpoint.
- Google Drive returns HTTP 308 (Resume Incomplete) after each intermediate slice.
- **Instant Finalization (< 1s)**: When the interview ends or terminates, 95%–99% of the video is already on Google Drive. The client sends a final slice with `isFinal: true` (or a `Content-Range: bytes */TOTAL` finalize signal). Google Drive seals the file into a complete playable `.webm` video in under 1 second.
- **Zero Waiting Time**: The candidate never has to sit on a progress screen waiting for 30–50 MB to upload.

### 2. Universal Exit Guarantee Across All Scenarios
- **Normal Completion**: Flushes final slice on submit or countdown timer expiry.
- **Tab Switch & Focus Loss**: Immediately terminates the session with explicit reason badge, flushing the final slice to Google Drive.
- **Page Refresh / Exit**: Uses `keepalive: true` on the final chunk request during `pagehide` / `beforeunload` to seal the file even if the window closes.
- **IndexedDB Safety Net (`recording-storage.ts`)**: All slices are mirrored in IndexedDB. If a network disconnect halts the live stream, `flushAndUploadCachedRecording` recovers the recording on next session access.

### 3. Bypass Proctoring Policy
- **Proctoring Warnings**: When Bypass is ON, AI-driven proctoring warnings (face/gaze tracking, multiple voices, and unauthorized objects/phones) are silenced and do not generate strikes.
- **Tab Switch & Refresh Termination**: Tab switching, minimizing the browser, and page refreshing **remain strictly active and terminate the interview** regardless of bypass mode, ensuring session integrity.
- **Video Storage**: In all cases (bypass or non-bypass), the full interview video is 100% saved into Google Drive.

---

## 7. Large Desktop Video Direct Upload Resilience (Dynamic Timeout & Progress Keepalive)

### The Issue on Desktops
Full desktop interviews (5–15 minutes) generate 30 MB–80 MB WebM files (higher bitrate due to full HD screens). When uploaded directly to Google Drive via client-side `XMLHttpRequest`:
1. A hardcoded `5000ms` (5-second) upload timer previously aborted the transfer after 5 seconds before completion.
2. The failure triggered a fallback to `POST /api/interview/recording/upload`, which immediately crashed with `413 Payload Too Large` because serverless and proxy tiers restrict single request payloads to 4.5 MB.
3. If an interview was terminated (e.g., candidate switched tabs), closing the tab aborted in-flight transfers.

### The Universal Solution
1. **Dynamic Timeout Scaling**:
   ```typescript
   const uploadTimeoutMs = Math.max(300_000, Math.ceil(fullVideoBlob.size / 30_000) * 1000);
   ```
   - Allots at least 5 minutes (300 seconds), scaling proportionally with blob size to accommodate slower network connections.
2. **Active Progress Keepalive**:
   - In `xhr.upload.onprogress`, every chunk of bytes successfully transferred resets the stall timer to 60 seconds. As long as data is actively flowing, the upload will never be cancelled.
3. **Resilient Blob Caching**:
   - Unuploaded recordings are safely indexed and flushed upon session restart or graceful completion.
