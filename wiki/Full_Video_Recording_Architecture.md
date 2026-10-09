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

## 4. Report Integration: In-Portal Video Playback & Deep Seeking

### In-Portal Video Playback & HTTP 206 Byte-Range Streaming
- **Native HTML5 Player**: An interactive `<video controls playsInline>` player is embedded directly in the "Full Interview Video Recording" card on the candidate report page.
- **Streaming Route (`/api/interview/recording/[fileId]/stream`)**: Streams Google Drive recorded files via the service account with full HTTP 206 Partial Content (range requests) support, enabling smooth buffer scrubbing and instant seeking in the browser without downloading the whole file.
- **Instant Timestamp Seeking**: When an admin clicks on any violation timestamp badge (`⏱️ MM:SS ▶`) or the `▶ Jump directly to MM:SS in Video` button, the portal:
  1. Smoothly scrolls the viewport to the video player.
  2. Sets `video.currentTime = offsetSeconds` directly.
  3. Immediately plays the video from that exact second.
  4. Avoids Google Drive external viewer quirks where `?t=` parameters are ignored.
- **External Google Drive Access**: An `"Open in Google Drive ↗"` action remains alongside for backup, download, and external management.

### Serial Strike Ordering & Accurate Timing
- **Chronological Serial Order**: Warnings are strictly numbered in chronological sequence:
  - **Strike 1**: The first violation that occurred.
  - **Strike 2**: The second violation that occurred.
  - **Strike 3**: The third violation (or terminal violation that triggered auto-termination).
  - Strike numbers use `meta.warningCount` / `meta.strikeNumber` and are sorted strictly ascending by `ts_ms`.
- **Accurate Duration Clamping**:
  - `offsetSeconds` is calculated from the true recording start time (`recordingStartTime`).
  - Offsets are strictly clamped to the actual video duration (`recMeta.durationSeconds`). If a video is only 4 seconds long, offsets never exceed 4 seconds (e.g., `00:03` or `00:04`, never an artificial `00:20`).
- **Display Integrity & Timezone Accuracy**:
  - The overall wall-clock timestamp (e.g. `🕒 10:00:07 PM`) uses `rawTsMs` to dynamically format the time in the user's browser timezone (IST/local) with `suppressHydrationWarning`.
  - Strikes display exact violation titles and warning messages derived from the database (`interview_events`).

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


