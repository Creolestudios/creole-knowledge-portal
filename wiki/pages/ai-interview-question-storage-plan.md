# AI Interview Question Storage Plan

## Purpose

Store two different kinds of data in Supabase:

1. The reusable question bank managed by the admin.
2. The exact questions selected for one individual candidate interview.

The reusable bank and candidate interview questions must remain separate. A later edit to the question bank must not change questions already assigned to a candidate.

## Short Storage Summary

Each candidate interview will have one `interview_sessions` row containing the interview configuration and extraction result:

- Candidate identity
- Resume and JD references
- Extracted resume/JD data
- Match percentage
- Selected interview duration
- Selected question count
- Low-similarity confirmation
- Interview status

The reusable questions will live in `hr_question_bank`. When the admin selects questions for a candidate, the system will copy those questions into `interview_questions` with the candidate's `session_id`. This preserves the exact question text used for that interview, even if the reusable question is edited later.

Candidate responses will be stored in `interview_answers`, connected to both the candidate session and the specific question.

Example:

```text
Session A
- Duration: 30 minutes
- Question count: 10
- Match percentage: 68%
- Similarity confirmed: Yes

Questions for Session A
- Teamwork question
- Culture-fit question
- Project-experience question

Answers for Session A
- Answer to Teamwork question
- Answer to Culture-fit question
- Answer to Project question
```

The migration must be applied to Supabase before these tables appear in the dashboard. Creating the SQL file locally does not create the tables remotely.

## Existing Tables

The current schema already contains:

- `interview_sessions`
- `hr_question_bank`
- `interview_questions`
- `interview_answers`

The existing session-generation endpoint already deletes and inserts rows in `interview_questions` for a session. The missing part is connecting the admin's selected question-bank IDs to that generation flow.

## 1. Reusable Question Bank

Table: `public.hr_question_bank`

| Column | Purpose |
|---|---|
| `id` | Stable UUID for the reusable question |
| `title` | Short admin-facing title |
| `question_text` | Actual question shown to the candidate |
| `category` | HR, behavioral, experience overview, role alignment, project experience, teamwork, adaptability, conflict resolution, work preferences, career vision, or culture fit |
| `difficulty` | Easy, medium, or hard |
| `required_skills` | Skills assessed by the question |
| `intent` | What the interviewer is evaluating |
| `is_mandatory` | Whether the question is always included when enabled |
| `default_order` | Display order inside the category |
| `is_active` | Soft-disable without deleting history |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |
| `created_by` | Admin who created the question |

The question bank should use soft deletion. Set `is_active = false` instead of deleting a question that may already be referenced by previous interviews.

### Recommended Question-Bank Row

```json
{
  "id": "uuid",
  "title": "Project Ownership",
  "question_text": "Tell us about a project you are proud of and your specific contribution.",
  "category": "project_experience",
  "difficulty": "medium",
  "required_skills": ["Ownership", "Project Impact"],
  "intent": "Measure the candidate's personal contribution and accountability.",
  "is_mandatory": false,
  "default_order": 1,
  "is_active": true
}
```

## 2. Candidate Interview Session

Table: `public.interview_sessions`

The session represents one candidate and one interview setup. It should store the admin's configuration and extraction snapshot:

| Column | Purpose |
|---|---|
| `id` | Candidate interview session ID |
| `candidate_name` | Candidate identity |
| `candidate_email` | Candidate contact |
| `parsed_resume` | Extracted candidate profile snapshot |
| `parsed_jd` | Extracted job-description snapshot |
| `skill_gap` | Match percentage, matched keywords, and missing keywords |
| `question_count` | Admin-selected number of questions |
| `duration_minutes` | Admin-selected interview duration |
| `similarity_confirmed` | Whether admin accepted a match below 70% |
| `status` | Draft, parsed, questions generated, invite issued, in progress, or completed |
| `created_by` | Admin who created the session |
| `created_at` / `updated_at` | Audit timestamps |

The resume, JD, and analysis should be copied into the session as a snapshot. This ensures the interview remains consistent even if the source files or extraction logic change later.

## 3. Selected Questions for One Candidate

Table: `public.interview_questions`

This table stores a candidate-specific copy of every question selected for that session.

| Column | Purpose |
|---|---|
| `id` | Unique question instance ID |
| `session_id` | Candidate interview session |
| `question_bank_id` | Source reusable question, nullable for generated questions |
| `question_text` | Snapshot of the exact text shown to the candidate |
| `question_type` | HR, behavioral, role-specific, or situational |
| `category` | Category snapshot |
| `difficulty` | Difficulty snapshot |
| `required_skills` | Skills assessed |
| `intent` | Evaluation intent |
| `evaluation_rubric` | Optional scoring guidance |
| `question_order` | Candidate presentation order |
| `time_limit_sec` | Time allowed for this question |
| `is_mandatory_hr` | Whether it was mandatory for the session |
| `weight` | Scoring weight |
| `created_at` | Assignment timestamp |

The important fields are:

- `question_bank_id`: keeps a trace back to the reusable bank.
- `question_text`: preserves the exact historical text used for this candidate.
- `session_id`: makes the question private to one candidate interview.

## Selection Flow

1. Admin uploads the resume and JD.
2. The extractor returns the candidate profile, academic results, HR details, JD requirements, and similarity score.
3. If similarity is below 70%, the admin explicitly confirms whether to continue.
4. Admin selects interview duration and total question count.
5. Admin selects one or more categories.
6. Supabase returns active questions from `hr_question_bank` for those categories.
7. Admin checks the exact questions to ask.
8. The system validates that the selected count matches the configured question count.
9. The system creates or updates `interview_sessions`.
10. The system inserts one snapshot row per selected question into `interview_questions`.
11. The system updates the session status to `questions_generated`.
12. The interview invite points to that session.
13. The candidate receives only the rows in `interview_questions` for that session, ordered by `question_order`.

## Example Relationship

```text
hr_question_bank
  id = B1
  category = teamwork
  question_text = "Describe a time you worked with different working styles."
          |
          | copied when admin selects it
          v
interview_questions
  id = Q1
  session_id = S1
  question_bank_id = B1
  question_text = "Describe a time you worked with different working styles."
          |
          v
interview_answers
  question_id = Q1
  transcript = candidate response
```

## Replacement Behavior

When the admin changes the selected questions before the interview starts:

1. Delete existing `interview_questions` for that session.
2. Insert the newly selected question snapshots.
3. Preserve the reusable question-bank rows.
4. Keep the same session ID.
5. Regenerate or invalidate an existing invite if the interview has already started.

After the candidate has started, the question set should be locked. Changes should require a new session so the candidate's answers remain connected to the correct questions.

## Recommended Migration Changes

The database phase should:

1. Expand the `hr_question_bank.category` check constraint to include all 11 approved categories.
2. Add `required_skills`, `intent`, `updated_at`, and `created_by` to `hr_question_bank`.
3. Add `question_bank_id` to `interview_questions` with a foreign key to `hr_question_bank(id)`.
4. Add `question_count`, `duration_minutes`, and `similarity_confirmed` to `interview_sessions`.
5. Add indexes on:
   - `hr_question_bank(category, is_active, default_order)`
   - `interview_questions(session_id, question_order)`
   - `interview_questions(question_bank_id)`
6. Seed the approved reusable questions into `hr_question_bank`.
7. Add RLS policies so admins can manage the bank and candidates can read only questions belonging to their verified session.

## Security Rules

- Never expose the full question bank to a candidate.
- Candidate APIs must filter by the verified session or invite.
- Admin APIs may read active question-bank records.
- Store only question-bank IDs in selection payloads; reload question text server-side.
- Do not trust question text sent from the browser.
- The server must verify that every selected question ID is active and belongs to the requested category.
- Do not delete question-bank rows that are referenced by historical interviews.

## Current Phase Boundary

The current implementation has the question bank represented in application code and supports selecting exact questions in the admin UI. Supabase persistence is the next phase. During that phase, the static bank should be seeded into `hr_question_bank`, and the selected question IDs should be persisted as candidate-specific rows in `interview_questions`.
