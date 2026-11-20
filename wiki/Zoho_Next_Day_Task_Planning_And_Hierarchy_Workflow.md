# Zoho Projects Next-Day Task Planning & 3-Tier Hierarchy Workflow Guide

*A complete technical and operational guide for next-day developer task planning (8:30 AM cutoff), morning 8:45 AM cron synchronization, morning 8:30 AM weekday evaluation, Friday 10:00 PM evaluation, and Zoho Projects 3-tier task hierarchy.*

---

## 📌 1. Executive Summary

This document specifies the end-to-end architecture and workflow for the **Next-Day Task Planning & Ingestion Engine** within the Creole Knowledge Portal (CKP). It bridges developer task planning on the CKP User Dashboard with **Zoho Projects** and the existing daily evaluation engine through scheduled cron jobs and a structured 3-tier task hierarchy.

### Core Objectives:
1. **Next-Day Task Planning**: Developers submit their planned tasks for the next working day via the CKP User Dashboard with a strict **8:30 AM cutoff**.
2. **Daily Morning 8:45 AM Task Addition Cron**: Discovers or creates Weekly Main Tasks and user budget subtasks, sets up checklist tasks, and creates today's planned tasks in Zoho Projects.
3. **Daily Morning 8:30 AM Evaluation Cron**: Evaluates previous workday's completed tasks, timelogs, comments, and sends daily reports.
4. **Friday Night 10:00 PM Evaluation Cron**: Explicitly evaluates Friday's work on Friday night and sends weekly wrap-up digest before the weekend.
5. **Accurate User & Project Attribution**: Ensures every task is placed under the correct Level 2 container (`parent_id`) and assigned to the correct user account (`person_responsible`).

---

## 🏗️ 2. End-to-End System Architecture

```mermaid
flowchart TD
    subgraph "CKP User Dashboard (/dashboard)"
        UI["Developer Task Planner Widget<br/>- Project Selector<br/>- Task Title & Description<br/>- Estimated Hours (hr)<br/>- Target Date (Next Working Day)"]
        LOCK["8:30 AM Cutoff Gatekeeper<br/>(Locks inputs at 08:30 IST)"]
        UI --> LOCK
    end

    subgraph "Supabase PostgreSQL Database"
        DB_PLAN["public.zoho_planned_tasks<br/>(Status: draft | queued | synced | failed)"]
        DB_MAP["public.zoho_user_mappings<br/>(CKP user_id <-> zoho_user_id)"]
        DB_CONTAINER["public.zoho_weekly_containers<br/>(Cache for W{Week} Task & Subtask IDs)"]
        LOCK -->|Saves Plan| DB_PLAN
    end

    subgraph "Cron Automation Engine"
        CRON_EVAL["Daily 8:30 AM Cron<br/>(/api/cron/zoho-evaluation)<br/>- Evaluates Completed Work<br/>- Sends Daily Evaluation Emails"]
        CRON_ADD["Daily 8:45 AM Cron<br/>(/api/cron/monday-task-dispatch)<br/>- Ingests & Syncs Planned Deliverables"]
    end

    subgraph "Zoho Projects REST API"
        ZP_L1["Level 1: Admin Weekly Main Task<br/>'W47-site development ( priya 10, krunal 10, others 20 )'"]
        ZP_L2["Level 2: User Allocation Subtasks<br/>'priya 10', 'krunal 10', 'others 20'"]
        ZP_L3["Level 3: Actual Work Tasks<br/>- 'Fix bug [3.0 hrs]' (parent_id: priya 10)<br/>- 'Checklist Task' (Assigned to Priya)"]
    end

    DB_PLAN --> CRON_MON
    DB_PLAN --> CRON_DAILY
    DB_MAP --> CRON_MON
    DB_MAP --> CRON_DAILY

    CRON_MON -->|1. Searches 'W{Week}'| ZP_L1
    CRON_MON -->|2. Creates Subtasks & Checklist| ZP_L2
    CRON_MON -->|3. Adds Monday Tasks| ZP_L3
    CRON_MON -->|Caches IDs| DB_CONTAINER

    CRON_DAILY -->|Pushes Tue-Fri Tasks| ZP_L3
    DB_CONTAINER -->|Provides parent_id| CRON_DAILY
```

---

## 🌳 3. The 4-Tier Zoho Task Hierarchy

In Creole Studios' active Zoho Projects, tasks follow a structured 4-tier hierarchy representing project milestones, admin containers, unassigned developer hour budgets, and daily work items.

```mermaid
graph TD
    Main["📁 Level 1: Weekly Main Task (Admin Created)<br/>Name: W47 - Sample tasks added by CKP... (Srushti 14, Priya 6)<br/>Owner: Admin (e.g. Senil Shah)"]

    subgraph "Level 2: Placeholder Task"
        Placeholder["📦 Placeholder Task - W47<br/>Owner: UNASSIGNED<br/>Status: Backlog"]
    end

    subgraph "Level 3: User Named Subtasks (Hour Buckets)"
        Sub_Srushti["👤 Srushti 40<br/>Owner: UNASSIGNED<br/>Status: Backlog"]
        Sub_Priya["👤 Priya 16<br/>Owner: UNASSIGNED<br/>Status: Backlog"]
        Sub_Others["👥 others 20<br/>Owner: UNASSIGNED<br/>Status: Backlog"]
    end

    subgraph "Level 4: Developer Work Tasks (Portal Ingested)"
        Task_Srushti["📝 Zoho Automatic Task Creation... [8.0 hrs]<br/>Owner: Srushti Amin (Zoho User ID)<br/>Timesheet Trackable"]
        Task_Priya["📝 Priya's Task: Fix profile upload bug [3.0 hrs]<br/>Owner: Priya (Zoho User ID)"]
        Task_Others["📝 Aman's Task: Setup test runner [2.5 hrs]<br/>Owner: Aman (Zoho User ID)"]
    end

    Main --> Placeholder
    Placeholder --> Sub_Srushti
    Placeholder --> Sub_Priya
    Placeholder --> Sub_Others

    Sub_Srushti --> Task_Srushti
    Sub_Priya --> Task_Priya
    Sub_Others --> Task_Others

    classDef main fill:#0f766e,stroke:#2dd4bf,stroke-width:2px,color:#fff;
    classDef placeholder fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef sub fill:#4338ca,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef task fill:#854d0e,stroke:#facc15,stroke-width:2px,color:#fff;

    class Main main;
    class Placeholder placeholder;
    class Sub_Srushti,Sub_Priya,Sub_Others sub;
    class Task_Srushti,Task_Priya,Task_Others task;
```

### Hierarchy Breakdown:

| Level | Name / Format | Creator | `parent_id` | Assignee (`person_responsible`) | Role / Function |
|---|---|---|---|---|---|
| **Level 1** | `W{WeekNumber}-{Description}` | Admin | `null` | **Admin** (e.g. Senil Shah) | Weekly container representing sprint/milestone. |
| **Level 2** | `Placeholder Task - W{WeekNumber}` | CKP Cron / Admin | Level 1 Task ID | **UNASSIGNED** (`null`) | Placeholder container. Status default is `Backlog`. Strictly unassigned. |
| **Level 3** | User bucket (e.g., `Srushti 40`, `Priya 16`, `others 20`) | CKP Cron / Admin | Level 2 Placeholder ID | **UNASSIGNED** (`null`) | Hour-budget container grouping developer work. Automatically parsed from parent title breakdown (e.g. `(srushti 40, priya 16)`) or general hours. Remains unassigned. |
| **Level 4** | `[Task Title] [X.X hrs]` | CKP Cron (9 AM Mon / 10 PM Daily) | Level 3 Subtask ID | **Respective Developer** | Actual daily work items with duration, assigned to developer. |

---

## 🔑 4. User Entity & Parameter Resolution (How Tasks Link to Correct Users)

To ensure tasks are placed in the right folder and attributed to the right developer, CKP uses **three distinct entities**:

### 1. CKP User Profile & Zoho Mapping (`zoho_user_mappings`)
Every logged-in developer in CKP is linked to their Zoho account:
```
CKP Auth User (juzar@creolestudios.com)
   └── zoho_user_mappings:
         ├── zoho_user_id: "1892000000054321"
         ├── zoho_user_email: "juzar@creolestudios.com"
         └── first_name: "Juzar"
```

### 2. `parent_id` (Folder Placement in Zoho)
The system checks the developer's first name against existing Level 2 subtasks under the Weekly Main Task:
* If the user is **Priya** &rarr; Matches Level 2 subtask `priya 10` &rarr; `parent_id = 1892000000099002`.
* If the user is **Krunal** &rarr; Matches Level 2 subtask `krunal 10` &rarr; `parent_id = 1892000000099003`.
* If the user is **Aman** (no named subtask) &rarr; **Automatic fallback to `others 20`** &rarr; `parent_id = 1892000000099004`.

### 3. `person_responsible` (Task Ownership in Zoho)
Even if Aman's task is nested under `others 20`, the Zoho task creation payload sets:
```json
{
  "name": "Setup automated CI runner [2.5 hrs]",
  "parent_id": "1892000000099004",
  "person_responsible": "aman_zoho_user_id",
  "duration": "02:30"
}
```
**Why this matters**:
* Setting `person_responsible` ensures the task appears on Aman's personal timesheet in Zoho, and only Aman receives the native Zoho task assignment email.
* Start and End dates are intentionally omitted so they display as `-` (unrestricted date window) in Zoho Projects and in email notifications.
* It enables CKP to evaluate Aman's individual performance during the 10:00 PM evaluation cron.
* It keeps the project's overall budget organized in Zoho without sending unwanted notification emails to other team members.

---

## ⏰ 5. The Cron Architecture & Schedules

```mermaid
flowchart TD
    subgraph Monday_To_Friday_Daily_Cycle["Monday - Friday Daily Cycle"]
        Cutoff["08:30 AM IST: Submission Cutoff (Planner Locked)"]
        Eval["08:30 AM IST: Daily Evaluation Cron (Evaluates Previous Workday)"]
        Sync["08:45 AM IST: Task Addition Cron (Syncs Today's Tasks to Zoho)"]
        Cutoff --> Eval
        Eval --> Sync
    end

    subgraph Friday_Night_Cycle["Friday Night Explicit Evaluation"]
        FriEval["Friday 10:00 PM IST: Friday Evaluation Cron (Evaluates Friday's Work)"]
        FriReports["Sends Friday Individual & Admin Digest Reports"]
        FriEval --> FriReports
    end
```

### Cron 1: Daily 8:45 AM Task Addition Cron (`/api/cron/monday-task-dispatch`)
* **Schedule**: Monday to Friday at **08:45 AM IST** (`03:15 UTC` &rarr; `15 3 * * 1-5`).
* **Trigger Responsibility**:
  1. **Weekly Container Setup (Monday Morning)**:
     * Discovers or verifies Weekly Main Task (`W{WeekNumber}`).
     * Discovers or creates Level 2 user containers (`priya 10`, `krunal 10`, `others 20`).
     * Creates Level 3A Checklist task under each developer's container.
  2. **Push Today's Tasks to Zoho**:
     * Queries `zoho_planned_tasks` for tasks with `target_date = Current Date` and `status = 'queued'`.
     * Creates each task under the developer's Level 2 subtask in Zoho.
     * Updates database record status to `'synced'` with the generated `zoho_task_id`.

### Cron 2: Weekday 8:30 AM Morning Evaluation Cron (`/api/cron/zoho-evaluation`)
* **Schedule**: Tuesday to Friday at **08:30 AM IST** (`03:00 UTC` &rarr; `0 3 * * 2-5`).
* **Trigger Responsibility**:
  * Evaluates completed tasks, timelogs, comments, and QA review statuses from the previous workday (e.g. Tuesday evaluates Monday).
  * Dispatches daily evaluation emails and Team Performance Digest to developers and managers.
  * **Monday Morning**: Evaluation is intentionally skipped because Friday work was already evaluated on Friday night. Monday morning focuses strictly on Task Addition at 8:45 AM.

### Cron 3: Friday 10:00 PM Night Evaluation Cron (`/api/cron/zoho-evaluation?trigger=friday_10pm`)
* **Schedule**: Every Friday at **10:00 PM IST onwards** (`16:30 UTC` &rarr; `30 16 * * 5`).
* **Trigger Responsibility**:
  * Explicit end-of-week evaluation: evaluates Friday's tasks and timelogs on Friday night.
  * Dispatches Friday evaluation reports and weekly wrap-up digest before the weekend.

---

## 💻 6. Database Schema (Supabase)

To support next-day task planning, queuing, and hierarchical caching, the following tables are integrated:

```sql
-- 1. Table: zoho_planned_tasks
-- Stores developer-submitted next-day tasks before they are pushed to Zoho
CREATE TABLE IF NOT EXISTS public.zoho_planned_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    zoho_project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    target_date DATE NOT NULL,
    task_name TEXT NOT NULL,
    task_description TEXT,
    planned_hours NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('draft', 'queued', 'synced', 'failed')),
    zoho_task_id TEXT,
    zoho_parent_subtask_id TEXT,
    sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_zoho_planned_tasks_target 
ON public.zoho_planned_tasks(target_date, status);

-- 2. Table: zoho_weekly_containers
-- Caches the weekly Level 1 Main Task ID and Level 2 User Subtask IDs per project
CREATE TABLE IF NOT EXISTS public.zoho_weekly_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_number INT NOT NULL,
    year INT NOT NULL,
    zoho_project_id TEXT NOT NULL,
    admin_parent_task_id TEXT NOT NULL,
    admin_parent_task_name TEXT NOT NULL,
    user_subtask_mappings JSONB NOT NULL DEFAULT '{}'::jsonb, 
    -- e.g. { "priya": { "subtask_id": "1892000000099002", "checklist_id": "..." }, "others": { ... } }
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(week_number, year, zoho_project_id)
);
```

---

## 🖥️ 7. CKP User Dashboard Interface (UI/UX)

### User Flow on `/dashboard/zoho-evaluation`:
1. **Next-Day Planner Card**:
   * Shows a clean card titled **"Plan Tomorrow's Tasks"** (or **"Plan Monday's Tasks"** on Fridays).
   * Displays the countdown to the **8:30 AM cutoff**.
2. **Form Inputs**:
   * **Project**: Dropdown populated from active Zoho projects.
   * **Task Title**: Clear title input (e.g., `Refactor user authentication flow`).
   * **Estimated Hours**: Numeric input / slider (e.g., `4.0 hrs`).
   * **Description / Acceptance Criteria**: Textarea for detailed technical expectations (minimum 40 words).
3. **Cutoff Behavior**:
   * Before 8:30 AM: Users can add, edit, or delete items for the target workday.
   * At 8:30 AM: Form locks automatically; shows badge: `"8:30 AM Cutoff Passed — Submissions Locked"`.
   * At 8:45 AM: Morning Task Addition cron synchronizes all queued tasks into Zoho Projects.

---

## ⚙️ 8. Matching Algorithm & Code Logic

Here is the exact algorithmic logic used by the backend service to match users to their subtask bucket:

```typescript
export interface SubtaskBucket {
  id_string: string;
  name: string;
}

/**
 * Resolves the correct parent_id for a developer under the Weekly Main Task
 */
export function resolveTargetSubtaskId(
  userFirstName: string,
  subtasks: SubtaskBucket[]
): string {
  const cleanUser = userFirstName.trim().toLowerCase();

  // 1. Direct user match: subtask starts with user's first name (e.g., "priya 10")
  const namedSubtask = subtasks.find(sub => {
    const cleanName = sub.name.trim().toLowerCase();
    return cleanName.startsWith(cleanUser + ' ') || cleanName === cleanUser;
  });

  if (namedSubtask) {
    return namedSubtask.id_string;
  }

  // 2. Fallback match: "others" bucket (e.g., "others 20")
  const othersSubtask = subtasks.find(sub =>
    sub.name.trim().toLowerCase().startsWith('others')
  );

  if (othersSubtask) {
    return othersSubtask.id_string;
  }

  // 3. Fallback to first available subtask if neither exists
  if (subtasks.length > 0) {
    return subtasks[0].id_string;
  }

  throw new Error(`No subtask or 'others' bucket found for user: ${userFirstName}`);
}
```

---

## 🛡️ 9. Edge Cases & Safeguards

| Scenario | Risk | System Safeguard |
|---|---|---|
| **Admin has not created `W{Week}` task by Monday 9:00 AM** | Cron cannot find parent task | Cron sends an alert notification/email to the project manager and schedules an automatic retry every 30 minutes up to 11:30 AM. |
| **Developer submits tasks for multiple projects** | Tasks routed to wrong project | The planner form requires explicit project selection per task item; the cron groups tasks by `zoho_project_id` and queries the corresponding project container. |
| **Developer name not listed in Level 2** | Task orphaned without bucket | Automatic fallback logic routes the task under the `others [hrs]` subtask while keeping `person_responsible` assigned to that specific developer. |
| **Checklist status changed by non-assignee** | Unauthorized status progression | Level 3A checklist tasks are explicitly assigned to the developer's Zoho User ID, preventing unauthorized updates in Zoho Projects. |
| **User tries to submit after 8:30 AM** | Inconsistent cron dispatch | Frontend UI disables submission, and backend API enforces server-side time validation against 8:30 AM IST. |

---

## 📋 10. Summary Table of Operations

| Operation | Time / Frequency | Actor / Service | Outcome |
|---|---|---|---|
| **Create Weekly Main Task** | Before Monday 8:30 AM | Admin (Zoho UI) | Task named `W{Week}-...` created in Zoho. |
| **Add Daily Planned Tasks** | Daily until 8:30 AM | Developer (CKP UI) | Tasks stored as `'queued'` in Supabase. |
| **Daily Evaluation & Digest** | Mon-Fri 08:30 AM IST | Evaluation Cron | Evaluates completed work, sends daily evaluation & digest emails. |
| **Daily Ingestion & Task Addition** | Mon-Fri 08:45 AM IST | Task Dispatch Cron | Syncs queued tasks into Zoho Projects under developer containers. |

---

## 🔄 11. User Project Allocation & Live Refresh Mechanism

### Strict Zoho Authority
To maintain data integrity and prevent orphaned tasks:
1. **No Manual Project Creation**: Developers cannot manually enter or invent arbitrary project names in the portal. All selectable projects originate 100% authentically from Zoho Projects.
2. **User-Specific Project Ingestion**: When the planner loads, `/api/user/zoho/projects` retrieves only projects actively allocated to that developer's mapped Zoho User ID or email.
3. **Instant Live Refresh**:
   * Assigned projects are normally cached for 30 minutes in memory for high-speed planner rendering.
   * If a Project Manager assigns a developer to a new project in Zoho Projects during the day, the developer clicks the **Refresh** button (`↻`) beside the Target Project dropdown.
   * This immediately triggers `/api/user/zoho/projects?refresh=true`, which bypasses the cache, queries Zoho Projects REST API live, and instantly populates the newly allocated project into the dropdown.

