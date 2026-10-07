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
