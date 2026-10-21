# Admin Manual & Technical Operations Guide: AI Interview Module

**Creole Studios — Autonomous AI Assessment & Candidate Evaluation Platform**  
*Document Version:* 2.0  
*Target Audience:* Talent Acquisition Managers, Technical Interviewers, HR Leads, System Admins  
*Module Role:* Assessment Authoring, Question Banking, Live Observation & Comprehensive Candidate Reporting  

---

## Table of Contents
1. [Overview & Administrative Scope](#1-overview--administrative-scope)
2. [Admin Access & Navigation Hub](#2-admin-access--navigation-hub)
3. [Step 1: Creating a Candidate Assessment (`AIInterviewManager`)](#3-step-1-creating-a-candidate-assessment-aiinterviewmanager)
   - [Candidate Information & Zoho Recruit Linking](#candidate-information--zoho-recruit-linking)
   - [Resume & Job Description (JD) Uploader](#resume--job-description-jd-uploader)
   - [AI Keyword & Skill Matching Engine](#ai-keyword--skill-matching-engine)
   - [HR Question Bank Selector & Custom Questions](#hr-question-bank-selector--custom-questions)
   - [Generating Single-Use Links & 6-Digit Passcodes](#generating-single-use-links--6-digit-passcodes)
4. [Step 2: Candidate Assessment Session Management](#4-step-2-candidate-assessment-session-management)
   - [Session Status States](#session-status-states)
   - [Distributing Invites to Candidates](#distributing-invites-to-candidates)
5. [Step 3: Live Proctoring & Observation Mode (WebRTC Join)](#5-step-3-live-proctoring--observation-mode-webrtc-join)
   - [The "Waiting for Candidate" Room](#the-waiting-for-candidate-room)
   - [Dual Video Stream Layout (Admin & Candidate)](#dual-video-stream-layout-admin--candidate)
   - [Live Speech Captioning & Audio Monitoring](#live-speech-captioning--audio-monitoring)
   - [Real-Time 3-Strike Proctoring Audit Feed](#real-time-3-strike-proctoring-audit-feed)
   - [Admin Observation Controls & Early Session Leave](#admin-observation-controls--early-session-leave)
6. [Step 4: Candidate Evaluation Reports (`/admin/reports/[id]`)](#6-step-4-candidate-evaluation-reports-adminreportsid)
   - [Candidate Summary Card & Zoho Sync](#candidate-summary-card--zoho-sync)
   - [Technical Competency Score Breakdown](#technical-competency-score-breakdown)
   - [English CEFR Fluency & Clarity Analysis](#english-cefr-fluency--clarity-analysis)
   - [Bluff & AI-Hallucination Detection Index](#bluff--ai-hallucination-detection-index)
   - [Verbatim Answer Transcripts with AI Snippet Highlighting](#verbatim-answer-transcripts-with-ai-snippet-highlighting)
   - [Continuous Google Drive Video Playback](#continuous-google-drive-video-playback)
   - [Proctoring Timeline & Event Snapshots](#proctoring-timeline--event-snapshots)
   - [Interactive AI Chat Copilot (`ReportChatCopilot`)](#interactive-ai-chat-copilot-reportchatcopilot)
7. [Admin Diagnostics, Testing & Failure Recovery](#7-admin-diagnostics-testing--failure-recovery)
   - [Diagnostic Command Reference](#diagnostic-command-reference)
   - [Troubleshooting Matrix](#troubleshooting-matrix)

---

## 1. Overview & Administrative Scope

The **Creole AI Interview Module** automates technical screening, language proficiency testing, and proctored assessment. While candidates experience an autonomous voice-and-video assessment, administrators have comprehensive control to:

1. **Tailor Questionnaires**: Upload Resumes and Job Descriptions to extract keyword matches and assemble customized technical assessments from the HR Question Bank.
2. **Monitor Live Sessions**: Join active candidate sessions via WebRTC in "Observation Mode" to inspect live video feeds, real-time speech transcriptions, and proctoring infractions without interfering with the candidate.
3. **Audit Evaluated Reports**: Review AI-generated ratings (Technical Competency, CEFR English Fluency, Bluff Detection), view full continuous session recordings hosted on Google Drive, and interact with the AI Chat Copilot to plan Round 2 follow-ups.

---

## 2. Admin Access & Navigation Hub

Administrators manage interviews across two interconnected interfaces:
- **Assessment Management**: Located at `/admin/dashboard` under the **"AI Interview"** tab (`components/ai-interview-manager.tsx`). Used to create sessions, select questions, and copy candidate invite links.
- **Reports Dashboard**: Located at `/admin/reports` and `/admin/reports/[id]` (`components/ai-interview/report-detail-view.tsx`). Used to inspect final scores, video recordings, and transcripts.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  CREOLE ADMIN CONSOLE                                                                  │
├──────────────────────────┬─────────────────────────────────────────────────────────────┤
│  [🌐] Blog Sources       │  AI Interview Manager                                       │
│  [👥] Users              │                                                             │
│  [🛡] Submissions        │  [ + Create New Assessment ]   [ Candidate Sessions List ]  │
│  [☁] AI Interview ◄───── │  ---------------------------------------------------------  │
│                          │  Upload Resume & JD → Select Questions → Issue Magic Link   │
│  [📄] Interview Reports  │                                                             │
└──────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 3. Step 1: Creating a Candidate Assessment (`AIInterviewManager`)

Navigating to `/admin/dashboard` and selecting the **"AI Interview"** tab presents the creation panel:

### 1. Candidate Information & Zoho Recruit Linking
- **Candidate Name**: e.g., `Jane Doe`.
- **Candidate Email**: e.g., `jane.doe@example.com`.
- **Job Title**: e.g., `Senior React / Next.js Engineer`.
- **Zoho Recruiter Link**: Direct URL to the candidate's profile in Zoho Recruit for cross-platform synchronization.

### 2. Resume & Job Description (JD) Uploader
- **Resume Upload**:
  - Drag-and-drop or browse PDF / DOCX file (Maximum allowed size: **10MB**).
  - The uploader automatically validates file type and size.
- **Job Description**:
  - Supports dual modes: **"Upload File"** (PDF/DOCX) or **"Paste Text"** (direct paste of job requirements).

### 3. AI Keyword & Skill Matching Engine
- Click **"Extract Keywords"**.
- Gemini Flash extracts and cross-analyzes requirements between the JD and candidate resume:
  - **Match Score**: Percentage compatibility (e.g., `85% Match`).
  - **Core Requirements**: Key technologies extracted from the JD.
  - **Matched Skills**: Technologies validated on the candidate's resume.
  - **Missing Skills**: Deficiencies or unmentioned qualifications flagged for assessment questioning.

### 4. HR Question Bank Selector & Custom Questions (`QuestionBankSelector`)
Administrators can assemble a tailored 5 to 10 question interview:
- **Filters**:
  - **Category / Domain**: e.g., `React`, `TypeScript`, `Node.js`, `System Architecture`, `Behavioral HR`.
  - **Difficulty**: `Easy`, `Medium`, `Hard`.
  - **Competency**: Filter by specific technical competencies.
- **Search & Preview**: Search by keyword and click to preview question text, expected answer criteria, and recommended countdown timer (default 120s).
- **Add Custom Question**: Administrators can click **"+ Add Custom Question"** to write ad-hoc technical challenges specific to the client project.

### 5. Generating Single-Use Links & 6-Digit Passcodes
- Click **"Create Interview Session"**.
- The system commits the session to Supabase, producing:
  1. **Unique Magic Link**: `https://portal.creolestudios.com/interview/[id]`.
  2. **6-Digit Candidate Passcode**: Secure access code (e.g., `491823`).
  3. **One-Click Copy Buttons**: Quickly copy link and credentials to clipboard for emailing to the candidate.

---

## 4. Step 2: Candidate Assessment Session Management

Below the creation form, administrators can review all past and active candidate sessions in the **Assessment Sessions Table**:

| Status Badge | Meaning | Permitted Admin Action |
| :--- | :--- | :--- |
| `ready` / `pending` | Candidate has not accessed the interview yet | Copy Invite Link, Copy Passcode, Revoke Session |
| `in_progress` | Candidate is actively taking the interview right now | **Click "Join Live Observation"** to monitor |
| `completed` | Candidate submitted all answers; report generated | Click **"View Report"** |
| `terminated` | Candidate was ejected for 3 proctoring strikes or page refresh | Click **"View Report"** to inspect strike audit |
| `expired` | Single-use token was consumed or expired | Re-issue invite or inspect logs |

---

## 5. Step 3: Live Proctoring & Observation Mode (WebRTC Join)

Administrators can observe any live assessment in real time by clicking the invite link (`/interview/[id]`) while logged in as an Admin.

```
┌────────────────────────────────────────────────────────┬───────────────────────────────┐
│  CANDIDATE QUESTION VIEW (READ-ONLY)                   │  ADMIN MONITORING PANEL       │
│                                                        │                               │
│  Question 2 of 5          [Total: 12:45] [Q: 01:20]    │  ┌─────────────────────────┐  │
│  Candidate is answering live...                        │  │ You (Admin Self Tile)   │  │
│                                                        │  └─────────────────────────┘  │
│  [Real-Time Transcription Stream]                      │  ┌─────────────────────────┐  │
│  "To optimize server components in Next.js 15..."      │  │ Candidate Remote Video  │  │
│                                                        │  └─────────────────────────┘  │
│                                                        │                               │
│  Live Candidate Voice: Speaking active (transcribing)  │  PROCTORING STRIKES: 1 / 3    │
│                                                        │  [ Slot 1: Phone Detected ]   │
│                                                        │  [ Slot 2: Empty          ]   │
│                                                        │  [ Slot 3: Empty          ]   │
│                                                        │                               │
│                                                        │  [ 🔴 Leave Observation ]     │
└────────────────────────────────────────────────────────┴───────────────────────────────┘
```

### Observation Room Capabilities:
1. **"Waiting for Candidate" Mode (`stage === 'not_started'`)**:
   - If the admin joins before the candidate, a pulsing radar screen appears: *"The candidate has not accessed the link yet. Keep this tab open; it will instantly connect when the candidate enters."*
2. **Dual-Video WebRTC Tile**:
   - Displays the Admin's self-preview and the candidate's remote video feed side-by-side.
   - Candidate video feed is unmuted so the administrator can hear speech directly.
3. **Real-Time Speech Captions**:
   - A live captioning bar displays words transcribed by the candidate's speech recognizer in real time.
4. **Real-Time 3-Strike Proctoring Audit Feed**:
   - Visual 3-slot badge showing current strikes (e.g., `1 / 3 Strikes`).
   - Live event log showing timestamps and infraction categories (`face_missing`, `object_detected`, `second_voice`).
5. **Non-Disruptive Exit**:
   - Clicking **"Leave"** allows the administrator to exit observation mode without interrupting the candidate's ongoing interview.

---

## 6. Step 4: Candidate Evaluation Reports (`/admin/reports/[id]`)

Once an interview concludes, Gemini Flash synthesizes the candidate's responses into a detailed, multi-dimensional assessment report:

### Key Report Sections:
1. **Candidate Profile Card**: Displays Name, Email, Overall Cognitive Composite (e.g., `88/100`), Duration, and direct link to Zoho Recruit.
2. **Technical Competency Analysis**:
   - Category-by-category scores (e.g., Frontend Architecture: 92%, Database Design: 80%).
   - Radar chart mapping candidate strengths vs role expectations.
3. **English CEFR Fluency Radar**:
   - Assesses Grammar, Vocabulary, Pronunciation, and Spoken Fluency.
   - Assigns a recognized CEFR grade (e.g., `C1 - Advanced Professional Proficiency` or `B2 - Independent User`).
4. **Bluff & AI-Hallucination Index**:
   - Scrutinizes technical claims for accuracy and flags rehearsed or memorized LLM responses.
5. **Verbatim Question Transcripts (`HighlightedVerbatimAnswer`)**:
   - Displays the candidate's transcribed speech for every question.
   - Highlights strong architectural reasoning in green and factual errors or gaps in red.
6. **Continuous Google Drive Video Playback**:
   - Embedded video player streaming the full screen, camera, and audio recording directly from company Google Drive.
   - Includes timestamp jump links corresponding to each question and proctoring warning.
7. **Proctoring Incident Timeline & Snapshot Audit**:
   - Chronological breakdown of any proctoring flags with captured webcam snapshots showing the exact infraction.
8. **Interactive AI Chat Copilot (`ReportChatCopilot`)**:
   - Built-in AI assistant docked in the right sidebar.
   - Administrators can type natural language questions:
     - *"What were this candidate's biggest technical weaknesses?"*
     - *"Draft 3 deep architectural follow-up questions for Round 2."*
     - *"How did they explain React Server Components?"*

---

## 7. Admin Diagnostics, Testing & Failure Recovery

### 7.1 Diagnostic Command Reference

```bash
# 1. Inspect recent candidate assessment sessions in Supabase
npx supabase db query "SELECT id, status, created_at FROM interview_sessions ORDER BY created_at DESC LIMIT 5;"

# 2. Inspect generated evaluation reports
npx supabase db query "SELECT id, session_id, cognitive_composite, fluency_cefr FROM interview_reports LIMIT 5;"

# 3. Manually trigger re-scoring for a completed session
curl -X POST http://localhost:3000/api/interview/<session-id>/score \
  -H "Content-Type: application/json"

# 4. Check Google Drive Service Account Upload Configuration
node -e "console.log(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'Google Drive Configured' : 'Missing Config')"
```

### 7.2 Troubleshooting Matrix

| Issue / Symptom | Root Cause | Administrative Resolution Action |
| :--- | :--- | :--- |
| **Candidate link says "Expired" before test** | Candidate opened link, granted permissions, and then refreshed | Live session refresh triggers security termination. Check `/admin/dashboard` table, revoke the old session, and generate a new invite link. |
| **Admin video tile shows "Connecting..."** | WebRTC ICE candidate negotiation blocked by firewall | Ensure corporate firewall permits outbound WebRTC UDP traffic on ports 1024–65535, or STUN/TURN servers are accessible. |
| **Report says "Scoring in Progress..."** | Asynchronous Gemini evaluation job is processing | Scoring typically takes 30–60 seconds after submission. If stalled over 5 minutes, trigger manual rescoring: `POST /api/interview/<id>/score`. |
| **Google Drive Video shows "Processing..."** | Google Drive video transcoding takes a few minutes for 1080p WebM/MP4 | Click the direct `webViewLink` to view raw recording directly in Google Drive while transcoding finishes. |
| **Questions missing for chosen category** | Seed script for that department was not run | Run migration script: `supabase/migrations/20261020120000_seed_hr_question_bank.sql`. |

---
*Manual compiled by Creole Studios AI Assessment Engineering Team.*
