# 🧑‍💼 HR & Recruiter Manual: AI Interview Module
**Audience:** HR Managers, Recruiters & Hiring Administrators  
**Module:** AI Interview Creation, Live Monitoring & Candidate Evaluation

---

## 1. Creating an Interview Session & Setting Questions

### Step 1: Upload Candidate Resume & Job Description
1. Navigate to the **AI Interview Extractor** page.
2. Click **"Upload Resume"** and select the candidate's PDF.
3. Paste or upload the **Job Description (JD)** for the position.
4. Click **"Extract & Generate Questions"**:
   - The system analyzes candidate qualification match and suggests targeted interview questions.

### Step 2: Customizing the Questions
* **Pick from Question Bank**: Select behavioral or HR categories from the built-in library.
* **Add Custom Questions**: Click **"+ Add Custom Question"** to type in any company-specific technical or culture-fit questions you want the AI to ask.
* **Set Timing**: Set the interview duration (e.g., 20 or 30 minutes) and the number of questions to present.

---

## 2. Setting the "Warning Bypass" (Proctoring Policy)
Before generating the candidate link, HR can toggle **Warning Bypass ON or OFF**:

### When Warning Bypass is ON (Our Preferred Default for the System):
* **Candidate Experience**: The candidate is **not abruptly interrupted or kicked out** during the call due to sensitive AI triggers (such as glancing away, shifting in their chair, or temporary microphone noise).
* **Silent Audit Logging**: The proctoring engine continues running quietly in the background. Every incident (looking away, second voices, phone spotted) is logged with timestamps in the HR audit report, and the full video is saved.
* **Why our system prefers Bypass ON**: It ensures genuine candidates have a smooth, professional interview without premature disconnections from minor hardware or lighting quirks, while providing HR all the recorded proof to make the final hiring decision.It will not auto terminate session.
* *(Note: Deliberately switching browser tabs or minimizing the window will still strictly terminate the interview).*

### When Warning Bypass is OFF:
* Live auto-termination is strictly active. If the candidate looks away, brings up a phone, or background voices are heard, the interview pauses with strike warnings and permanently terminates on repeated infractions.It will auto terminate session after three warning given to user(along with resume button of 30s).

### Step 3: Generating the Link
1. Click **"Create Interview Session"**.
2. The system generates a **unique assessment link and passcode** to provide to the candidate.

---

## 3. Live Monitoring: Joining the Interview In-Between
* HR admins do not have to wait until the interview ends to check on a candidate.
* On the **Admin Reports Dashboard**, ongoing sessions display a live badge: **"In Progress"**.
* Click **"Monitor Live" / "Join Session"**:
  - You can enter and observe the ongoing interview in real time.
  - You can see the candidate's live camera stream, question progression, and live answer transcript.
  - Your entry does not disrupt or pause the candidate's interview flow.

---

## 4. Reviewing Candidate Reports & Video Playback
Once an interview is finished (or terminated), open the **Reports Dashboard** (`/admin/reports`):
1. **Candidate Status**:
   - 🟢 **Completed**: Candidate completed the full session.
   - 🔴 **Terminated**: Session was cut off immediately (e.g. candidate switched tabs or minimized the browser).
2. **Reviewing the Dossier**:
   - **Overall Score**: Total score out of 100.
   - **English Fluency & CEFR Level**: Candidate communication score.
   - **Technical Breakdown**: Individual ratings and transcripts for each question answered.
   - **Proctoring Incident Audit**: Detailed list of any flags logged during the interview (looking away, voice flags, object warnings).
   - **Watch Recording**: Play back the complete webcam video of the interview directly in your browser.
