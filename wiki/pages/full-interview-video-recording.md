# Full Interview Video Recording Architecture

## Overview
The **Full Interview Video Recording** module continuously captures candidate screen share, webcam video (Picture-in-Picture), and microphone audio throughout the AI Interview, streaming the whole video directly into Google Drive and making the recording accessible to recruiters on the HR dashboard.

---

## Key Architectural Principles

### 1. Direct Browser-to-Google Drive Upload
- **Challenge**: Vercel serverless functions enforce a strict 4.5 MB payload limit. Full interview recordings typically range from 60 MB to 200 MB.
- **Solution**: The Next.js backend generates an authorized **Google Drive Resumable Upload Session URL** using a Google Service Account (`POST /api/interview/recording/session`). The candidate's browser issues an HTTP `PUT` directly to Google Drive, completely bypassing serverless memory and timeout bottlenecks.

### 2. Off-Screen Canvas Compositor
- **Dimensions**: 1280x720 (720p).
- **Framerate**: Strictly throttled to **15 FPS** via `requestAnimationFrame` delta checks to prevent thermal throttling and CPU overload while running alongside TensorFlow workers (face tracking & object detection).
- **Layout**:
  - Background: Candidate Screen Share.
  - Bottom-Right Corner: Candidate Webcam (PiP: 320x180 with boundary).
  - Audio: Combined candidate microphone and system audio tracks.

### 3. Ghost Upload Prevention on Completion
- When the candidate clicks "Submit Final Interview" or the timer expires, the UI displays a non-dismissible modal:
  > *"Securing Interview Recording — Please do not close or refresh this tab while your video is securely transferred to Google Drive."*
- Monitors live progress (`0% -> 100%`) via `xhr.upload.onprogress`.
- Only transitions to the `completed` stage once Google Drive confirms receipt of the complete file and the server finalizes permissions.

### 4. Zero Supabase Schema Migration
- Metadata (fileId, webViewLink, previewUrl) is stored directly in the existing `interview_events` table under `category = 'full_recording'`.
- Eliminates database schema alterations and migration drift.

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/interview/recording/session` | `POST` | Initiates a Google Drive resumable upload session and returns `uploadUrl`. |
| `/api/interview/recording/complete` | `POST` | Sets Drive file sharing permissions to anyone with link, logs `full_recording` event in `interview_events`, and broadcasts to HR realtime channel. |
| `/api/admin/ai-interviews` | `GET` | Surfaces `recording_url` for every interview with an attached recording. |

---

## HR & Recruiter Experience

1. **Recent Interviews Table** (`components/ai-interview-manager.tsx`):
   - Shows a **"Video"** link badge next to "View Report" for any session with a recorded video.
2. **Evaluation Report View** (`components/ai-interview/report-detail-view.tsx`):
   - Displays a dedicated **Full Interview Video Recording** card.
   - Embeds a responsive preview player (`https://drive.google.com/file/d/{fileId}/preview`).
   - Provides a direct "Open in Google Drive" external link.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DRIVE_SERVICE_ACCOUNT_KEY_JSON` | Google Service Account JSON key string or file path |
| `DRIVE_FOLDER_ID` | Target Google Drive folder ID for storing recordings |
| `INTERVIEW_RECORDING_DRIVE_FOLDER_ID` | Optional specific folder override for interview recordings |
