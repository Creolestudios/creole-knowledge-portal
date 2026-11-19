# Zoho Task Planning & Creation — Developer User Guide

A comprehensive, step-by-step operational guide for developers on how to plan, add, edit, and track next-day planned tasks in the Creole Knowledge Portal for automated creation in Zoho Projects, along with all input constraints and evaluation rules.

---

## 🧭 1. Navigation & Tab Layout

In the Creole Knowledge Portal, all Zoho planning and performance tracking is consolidated under the **Zoho** section:

1. **Main Navigation**: Click **Zoho** in the left sidebar.
2. **Dedicated View Tabs**: At the top right of the Zoho header, switch seamlessly between two dedicated tabs:
   * **`Add Tomorrow Task`** *(Default / Planner View)*: Direct access to the next-day task planning form, live cutoff status, and queued tasks. **No scrolling required.**
   * **`See Evaluation`** *(Audit & Review View)*: Comprehensive view of your Till-Date performance summary, date-range filters, daily task audit cards, and weekly evaluation reports.


---

## 🚀 2. How to Add a Planned Task

Follow these steps during your workday before the daily cutoff:

1. **Navigate to Zoho**: Click **Zoho** in the sidebar.
2. **Open the Planner Tab**: Ensure the **Add Tomorrow Task** tab is active (indicated by the teal `CalendarPlus` icon).
3. **Check the Target Day & Cutoff**:
   * The top banner shows the target working day calculated in IST (e.g., *"Plan Tomorrow's Tasks — Thu, Nov 20, 2026"*).
   * On Friday, Saturday, or Sunday, the banner automatically shifts to *"Plan Monday's Tasks"*.
   * Check the countdown pill (e.g., *"4h 25m remaining until 10:00 PM cutoff"*).
4. **Select Target Project**:
   * Click the **Target Project** dropdown.
   * Use the live search field to quickly filter and select from your actively assigned Zoho projects.
5. **Enter Task Title**:
   * Type a specific, deliverable-focused title (at least 8 characters).
   * Example: `Implement OAuth2 authorization flow & token refresh route with unit tests`
6. **Set Planned Time (00:00 Clock Format)**:
   * Formatted strictly as **`00:00`** (HH:MM, maximum 2 digits on each side, e.g. `00`–`04` hours and `00`–`59` minutes).
   * Enter any time from **`00:01` (1 min) up to `04:00` (4 hrs max per single task)**.
   * Directly type clock times like `00:15`, `00:30`, `01:30`, `04:00` (or shorthand like `15m`, `1.5`, `4`, `4h` which auto-convert to `00:00`).
   * Inputs exceeding 2 digits per side (like `01:4544` or `123:45`) are immediately clamped. Single digits auto-pad upon blur (e.g. `1:5` &rarr; `01:05`).
   * Click or double-click to choose from standard presets (`00:15`, `00:30`, `00:45`, `01:00`, `01:30`, `02:00`, `03:00`, `04:00`).
   * The live indicator displays the formatted duration badge (e.g. `00:15 hrs (0.25h)`, `01:30 hrs (1.5h)`).
   * Single tasks cannot exceed **04:00 (4 hours)**. If entered above 4 hours, a validation error is shown and submission is disabled.
7. **Write Detailed Task Description**:
   * Detail implementation steps, components/modules touched, and verification acceptance criteria.
   * **Word Count**: Must contain **at least 40 words**. The live counter badge (`X / 40 words`) turns emerald when met.
   * **Smart Bullets**: Click the `•` button to insert structured bullet points. Pressing `Enter` automatically indents and continues the bullet list.
8. **Verify Live Quality Checklist**:
   * Ensure all green checkmarks appear under the form (Title valid, Description $\ge$ 40 words, Semantic keyword match, Hours within limit).
9. **Save Task**:
   * Click **"Save Planned Task"**.
   * The task is instantly added to your **Queued Planned Tasks** list below the form.

---

## ⚠️ 3. Validation Constraints & Business Rules

The portal enforces automated validation on every planned task. Tasks cannot be saved if any rule is violated:

### A. Daily Timing & 10:00 PM IST Cutoff
* **Strict Cutoff**: All tasks must be submitted before **10:00 PM IST**.
* **Automatic Lockout**: At 10:00 PM IST, the form automatically locks with a lock badge. No tasks can be added, updated, or removed after 10:00 PM for the target day.
* **Automated Sync**: The backend cron job ingests all queued planned tasks at 10:00 PM and synchronizes them directly into Zoho Projects under the 4-tier hierarchy.
* **Weekend Policy**: Tasks created on Friday or over the weekend target **Monday** and sync to Zoho Projects on Monday morning at 09:00 AM IST.

### B. Target Project Constraints
* **Assigned Projects Only**: The project selector only displays projects where you are an active member in Zoho Projects.
* **No Unassigned / Custom Names**: You cannot type freeform or unassigned project names. If a project is missing, contact your project manager or Zoho administrator to assign you in Zoho Projects.

### C. Task Title Constraints
* **Mandatory**: Cannot be left blank.
* **Length**: Minimum of **8 characters**.
* **Deliverable-Focused**: Must describe concrete deliverables rather than vague status phrases (e.g. titles like *"Bug fix"*, *"Testing"*, *"Meeting"*, or *"Updates"* are blocked).
* **Keywords**: Must contain clear technical domain words matching the work to be done.

### D. Planned Time Constraints (00:00 Clock Format)
* **Range**: Minimum **00:01 (1 min)**, maximum **04:00 (4 hrs)** per single task.
* **Zoho Native Clock Alignment**: Formatted in `00:00` (`HH:MM`) clock standard, matching Zoho Projects native task duration requirements.
* **Flexible Input**: Accepts clock format (`00:15`, `01:30`, `04:00`), plain numbers (`4`, `1.5`, `.5`), or shorthand text (`15m`, `30 min`, `1h`, `4h`). Values > 4 hours are rejected.
* **Database Accuracy**: Stored in `zoho_tasks.planned_hours` as `NUMERIC(6, 2)` (2-decimal precision), preventing truncation. Generated column `planned_minutes` automatically stores accurate total minutes.

### E. Task Description Constraints
* **Mandatory**: Cannot be empty.
* **Word Count**: Must contain **at least 40 words** (standalone punctuation, numbers, and bullet symbols are excluded from the count).
* **Technical Scope**: Must clearly outline:
  1. What feature, module, or fix is being built.
  2. Components, database tables, or APIs affected.
  3. Acceptance criteria and verification/testing steps.
* **No Spam / Filler Content**: Word uniqueness must be at least 35% to prevent keyboard mashing or repeating the same words.
* **Semantic Keyword Alignment**: Description must share core domain keywords with the task title to ensure scope relevance.

---

## ✏️ 4. How to Edit or Delete a Planned Task

You can update or delete planned tasks at any time **before the 10:00 PM IST cutoff**:

### To Edit an Existing Task:
1. Ensure you are on the **Add Tomorrow Task** tab before 10:00 PM.
2. **Select the Task to Edit**:
   * Click the **"Select a task to edit..."** dropdown at the top of the form and choose your task, OR
   * Click the **Edit (Pencil)** icon on the task row in the queued list below.
3. The form fields will populate with the task's project, title, hours, and description.
4. An amber editing banner will appear indicating *"Editing Planned Task"*.
5. Make your modifications while maintaining all validation rules ($\ge$ 40 words, valid hours).
6. Click **"Update Planned Task"** to save changes.
7. To abort editing without saving, click **"Cancel Edit"**.

### To Delete a Planned Task:
1. Locate the task in the **Queued Planned Tasks** list below the form.
2. Click the red **Trash / Delete** icon.
3. Confirm deletion. The hours will be freed from your daily planned total immediately.

> [!NOTE]
> Once the 10:00 PM IST cutoff passes and tasks are synchronized to Zoho Projects, they can no longer be edited or deleted from the portal. Any subsequent adjustments must be performed directly within Zoho Projects.

---

## 🔍 5. Viewing & Inspecting Planned Deliverables

Directly below the planning form on the **Add Tomorrow Task** tab:

* **Queued Tasks Table**: Displays your target date, project tags, planned duration in clock format (e.g. `4:00 hrs`), and task titles.
* **Cumulative Hours Indicator**: Displays total hours planned for the target day (e.g. `8.0 / 8.0 hrs planned`).
* **Task Detail Modal**: Click on any task card or row to open the complete details modal, showing the full multi-line description, word count, project metadata, and target date.

---

## 📊 6. Inspecting Performance in the "See Evaluation" Tab

When you want to inspect past task audits, timelog compliance, and AI evaluations:

1. Click the **See Evaluation** tab at the top right of the Zoho page (with the purple `Sparkles` icon).
2. **Till-Date Summary**: Shows cumulative statistics up to today (Total Hours Logged, Average Score out of 100, QA Review Tasks, Delayed Tasks).
3. **Period Filter**: Filter evaluations by **This Week**, **This Month**, or **Custom Date Range**.
4. **Daily Performance Cards**:
   * Click any day card to view the **Daily Performance & Activity Evaluation** modal.
   * Displays the dynamic daily score roll-up (average of all evaluated tasks), time tolerance badges, key accomplishments, and areas for improvement.
5. **Individual Task Modal**:
   * Click any task title to inspect the full evaluation breakdown.
   * Displays Planned vs Actual Clock Hours, Time Score, Work Justification Score, and authoritative feedback.
   * **Inline Deductions**: Deductions are shown directly alongside actionable guidance under *Key Areas to Improve & Work On* (e.g. `Calibrate Estimation (-1.5 pts): Task was completed early...`).
