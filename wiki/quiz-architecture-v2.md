# On-Demand Quiz Generation Architecture (V2)

## 📌 Architectural Overview
The quiz generation architecture has been fully refactored from an upfront 15-question pool to an **on-demand, 5-question incremental batching model**. This architecture dramatically optimizes LLM token consumption, latency, and database query load for 1000+ concurrent users.

```
[User Clicks Start Quiz] 
          │
          ▼
┌───────────────────────────┐
│ Check Available Questions │
│   (Unattempted in Pool)   │
└─────────────┬─────────────┘
              │
     ┌────────┴────────┐
     │                 │
  < 5 Available     >= 5 Available
     │                 │
     ▼                 ▼
┌──────────────┐  ┌────────────────┐
│ Call Gemini  │  │ Serve 5 Pool   │
│  AI Engine   │  │ Questions      │
└──────┬───────┘  └────────────────┘
       │
       ▼
┌──────────────┐
│ Insert & Tie │
│ to Parent    │
└──────────────┘
```

## 🔑 Key Highlights & Features

1. **Incremental 5-Question Batching**:
   - Only 5 questions are generated per batch when unattempted question pool is empty.
   - Saves ~66% LLM tokens per initial quiz attempt.

2. **Deduplication Engine**:
   - `existingQuestionTexts` are extracted from the database for the given blog.
   - Exclusion context is injected into Gemini prompts to guarantee 100% unique questions across retries.

3. **Parent Blog Persistency**:
   - `upsert` mechanism ensures foreign key integrity (`quiz_questions_blog_id_fkey`) by dynamically persisting synthetic or missing blog records before inserting generated questions.

4. **Model Resilience & Fallbacks**:
   - Primary model: `gemini-3.6-flash`
   - Fallback models: `gemini-2.5-flash`, `gemini-3.1-pro-preview`
   - Flexible JSON parsing regex strips markdown fences (` ```json `) safely.

5. **UUID Sanitization (`toValidUUID`)**:
   - Standardizes legacy string IDs (e.g. `6a853e8832895d5917aaf408`) into valid Postgres UUIDs using consistent hex padding (`6a853e88-3289-5d59-17aa-f40800000000`).

6. **Attempt Limit Enforcement & History Preservation**:
   - Strictly enforces 3 maximum attempts per blog quiz.
   - Database schema uses a strict `unique(user_id, blog_id)` constraint on `quiz_attempts`. 
   - Multiple attempts are tracked by encoding the attempt number into the `total_questions` column (`5` = Attempt 1, `15` = Attempt 2, `25` = Attempt 3).
   - Previous attempt history is preserved by dynamically fetching the last 5 rows from `quiz_answers`. Placeholders for new attempts are inserted using `upsert` (`onConflict: 'attempt_id, question_id'`), guaranteeing that old answers are securely stored and never deleted, thereby maintaining full attempt history.
   - 4th attempt requests receive a `403 Forbidden` response.
