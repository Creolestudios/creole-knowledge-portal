# AI Interview Module — Step 6 Explained: Measuring Candidate Smartness & English Fluency

> **Companion to:** `ai-interview-proctoring-plan.md` (section 3.8 "Scoring", the
> `interview_questions` / `interview_transcript` / `interview_reports` schema, section 3.7d).
> **Previous steps:**
> - `ai-interview-step1-resume-jd-to-link.md` — resume + JD → questions + link
> - `ai-interview-step2-permissions-screenshare-focus-guard.md` — camera/mic/screen + tab guard
> - `ai-interview-step3-eye-face-expression-tracking.md` — eye / head / expression tracking
> - `ai-interview-step4-realtime-alerts-and-warnings.md` — one alerting + warning pipeline
> - `ai-interview-step5-talkative-ai-conversation.md` — the talkative AI interviewer
> **Scope:** How, from the interview conversation, we produce two things HR cares about most:
> **(1) "smartness"** — the quality of the candidate's thinking: competency per skill,
> reasoning, structure, depth, problem-solving on curveballs — and **(2) English fluency** —
> grammar, vocabulary, coherence, pace, hesitation, intelligibility. Covers what is measured
> **live during the interview**, what is computed **right after**, the rubrics, the exact
> model prompts + JSON schemas, how the two scores combine into the HR recommendation, and
> how we keep it fair.
> **Status:** Design document. No code exists yet — these are the intended choices.

---

## 0. TL;DR

1. Scoring has **two layers**:
   - **Live capture (during the interview):** cheap, objective signals recorded as they
     happen — per-turn timing, speech/pause segments from VAD (plan 3.7d), filler counts,
     ASR-confidence, gaze-during-answer %, and the talkative AI's own
     `flag_answer_unclear` / `note_competency` tool calls from Step 5. Nothing is *scored*
     live; it is just **logged** to `interview_turn_metrics`.
   - **Post-call scoring (right after `status → completed`):** a queued job runs **Gemini
     2.0 Flash** over the full transcript to produce rubric scores, and combines them with
     the locally-computed objective metrics.
2. **Smartness** is never a single number. It is **per-competency scores (1–5)** — the
   competencies come from `interview_questions.competency` set in Step 1 — plus a
   **reasoning quality** sub-score (structure, specificity, depth, self-correction,
   handling of follow-ups/curveballs). These roll up to a **Cognitive composite (0–100)**.
3. **English fluency (0–100)** = a **blend** of:
   - **objective local metrics** (words-per-minute, filler ratio, mean length of run,
     pause statistics, type-token ratio, disfluency rate, response latency) — pure
     functions, no model, computed from the transcript + VAD segments; and
   - a **Gemini Flash rubric** over the candidate's turns (grammar, vocabulary range,
     coherence/cohesion, hesitation, intelligibility from the audio) mapped to a
     **CEFR-style band** (A2 … C2) → 0–100.
4. Every model score must be **grounded**: the model must return a **verbatim quote +
   `ts_ms`** from the transcript for each judgement, or that judgement is dropped.
5. **Fairness:** accent is explicitly **not** penalised — intelligibility is scored, not
   "sounds native"; code-heavy answers are excluded from prose fluency metrics; a
   `degraded_mode` session (Step 5 §9) discounts fluency confidence and flags it for HR.
6. Output is written to **`interview_reports`** (existing table, extended) + a new
   **`interview_turn_metrics`** table. The HR report shows competency cards, the fluency
   band with its evidence, the cognitive composite, and the **overall recommendation**
   (`strong_yes | yes | maybe | no`) with its top-3 evidence timestamps.
7. Whole job is **idempotent** and **re-runnable** by HR (e.g. after tuning the rubric),
   costs a handful of Flash calls, and stays on the free tier.

```
during interview                     post-call job (queued on "completed")
────────────────                     ────────────────────────────────────
transcript turns  ─┐                 1. segment transcript into Q/A blocks
VAD speech/pause  ─┤                 2. local metric calculators  ─────────┐
ASR confidence    ─┼─► interview_    3. Gemini Flash: per-competency rubric ├─► combine
Step-5 tool flags ─┤    turn_metrics 4. Gemini Flash: fluency rubric (CEFR) ┘   + weights
gaze-during-answer─┘                 5. Gemini Flash: synthesise recommendation
                                     6. write interview_reports + turn_metrics
```

---

## 1. What we are actually measuring

### 1.1 "Smartness" — decomposed

We do **not** claim to measure IQ. We measure **job-relevant thinking quality**, in four
observable dimensions:

| Dimension | What it looks like in a transcript | Source |
|---|---|---|
| **Competency depth** | Correct, specific, senior-appropriate answers to the skill questions from Step 1 | Gemini rubric per `interview_questions` row |
| **Reasoning & structure** | Answers have a shape (situation → action → result), name trade-offs, use concrete numbers/examples, don't ramble | Gemini rubric (`reasoning` sub-score) + local structure heuristics |
| **Adaptability** | Recovers well when the AI asks a follow-up or a curveball; refines a wrong first answer; says "I don't know" honestly instead of bluffing | Gemini rubric using Step-5 follow-up turns + `flag_answer_unclear` events |
| **Communication of ideas** | Explains a complex thing clearly and concisely; doesn't need three restatements | Gemini rubric (`clarity`) + local metrics (restart rate, answer length vs question difficulty) |

### 1.2 English fluency — decomposed (CEFR-aligned)

| Sub-skill | Measured by |
|---|---|
| **Grammatical accuracy** | Gemini rubric (error rate, error gravity) |
| **Lexical range** | Gemini rubric + local type-token ratio, rare-word ratio |
| **Coherence & cohesion** | Gemini rubric (linking, topic development) |
| **Fluency / hesitation** | Local: filler ratio, pause count & length, mean length of run, false starts; Gemini cross-check |
| **Intelligibility** | Local: ASR-confidence + Web-Speech-vs-Gemini transcript agreement; Gemini listens to a few audio windows for pronunciation clarity |
| **Interactive fluency** | Local: response latency after the AI stops speaking; turn overlaps (from Step-5 barge-in events) |

> Intelligibility ≠ accent. A strong regional accent that a listener understands scores
> **high** intelligibility. Only genuine comprehension breakdown lowers it.

---

## 2. Live capture — `interview_turn_metrics`

During the interview, the server (the Step-5 proxy already sits in the middle of every
turn) accumulates one row **per candidate turn**:

```sql
create table interview_turn_metrics (
  id                bigserial primary key,
  interview_id      uuid references interviews(id) on delete cascade,
  question_ord      int,                 -- which interview_questions.ord this answers
  turn_index        int,                 -- 0 = main answer, 1..n = follow-up answers
  started_ms        int,                 -- ms from interviews.started_at
  ended_ms          int,
  response_latency_ms int,               -- gap between AI turn end and candidate speech start
  speech_ms         int,                 -- total voiced time in the turn (from VAD)
  pause_ms_total    int,                 -- silence within the turn
  pause_count       int,                 -- pauses > 250 ms
  longest_pause_ms  int,
  word_count        int,
  filler_count      int,                 -- um, uh, er, like(discourse), you know, kind of
  false_start_count int,                 -- restarts / self-repairs (regex + heuristic)
  asr_confidence    real,                -- mean provider confidence for the turn, 0–1
  asr_agreement     real,                -- token overlap: Web Speech API vs Gemini transcript
  gaze_away_pct     real,                -- % of turn with head/eyes off-screen (Step 3)
  reading_flag      bool,                -- Step 3 reading_suspected overlapped this turn
  bg_voice_flag     bool,                -- Step 3.7d bg_voice overlapped this turn
  ai_followup_after bool,                -- did the AI need a follow-up after this turn
  answer_flag       text,                -- Step-5 flag_answer_unclear reason, if any
  raw_text          text,                -- the candidate's words for this turn
  created_at        timestamptz not null default now()
);
```

- All fields are **objective and cheap**. They are computed from data we already have:
  the **Step-5 transcript stream**, the **VAD segments** (plan 3.7d), the
  **Web Speech API** running as a free second ASR, and **Step-3 events**.
- **No scoring happens here.** These rows are the evidence base for the post-call job and
  for the HR report's per-answer drill-down.
- Writing is best-effort: a missing metric (VAD hiccup) is `null`, never blocks the turn.

### 2.1 The local metric calculators (pure functions — heavily unit-tested)

`lib/interview/metrics/` — no I/O, no model, deterministic:

| Function | Input → Output |
|---|---|
| `wordsPerMinute(text, speechMs)` | prose WPM (code blocks stripped) |
| `fillerRatio(text)` | filler tokens / total tokens, via a maintained filler lexicon |
| `pauseStats(vadSegments)` | `{ count, total, longest, meanRunMs }` — *mean length of run* = mean voiced segment length |
| `typeTokenRatio(text)` | unique lemmas / tokens (windowed to 100 tokens so length doesn't bias it) |
| `rareWordRatio(text)` | tokens outside a top-5k English frequency list / tokens |
| `falseStartCount(text)` | self-repair patterns ("I mean", "sorry,", dangling "the— the") |
| `responseLatency(aiTurnEndMs, firstVoicedMs)` | ms |
| `disfluencyRate(fillerCount, falseStarts, wordCount)` | per-100-words |
| `asrAgreement(webSpeechText, geminiText)` | normalised token-set F1 |

---

## 3. Post-call scoring job

### 3.1 Trigger & shape

- Enqueued when Step-5 sets `status = 'completed'` **or** Step-4 sets `status = 'terminated'`
  (a terminated interview still gets scored on whatever was captured, with a banner).
- Runs as a **Supabase Edge Function / Node route** (`app/api/interviews/[id]/score`),
  callable again by HR ("Re-score" button) — **idempotent**: it overwrites
  `interview_reports` and stamps `generated_at` + `rubric_version`.
- Steps:
  1. **Load** `interview_questions`, `interview_transcript`, `interview_turn_metrics`,
     relevant `interview_events`, and a few short **audio windows** (10–20s) sampled from
     the recording for pronunciation checks.
  2. **Segment** the transcript into **Q/A blocks** (main question + its follow-ups +
     answers), keyed by `question_ord`.
  3. **Local metrics roll-up** — aggregate `interview_turn_metrics` to interview level and
     per-competency.
  4. **Gemini Flash — competency rubric** (one call per question, or batched; JSON mode).
  5. **Gemini Flash — fluency rubric** (one call over all candidate turns + the audio
     windows).
  6. **Combine** local + model per §5, produce `competency_scores`, `fluency_score`,
     `cognitive_composite`, `communication`.
  7. **Gemini Flash — recommendation synthesis** (sees the numeric scores + top evidence).
  8. **Validate every model output with Zod**, drop ungrounded judgements, **write**.
- **Cost:** ~1 + (questions) + 1 Flash calls per interview; well within free tier for HR's
  volume. Token usage logged to `interview_reports.llm_tokens_used`.

### 3.2 Why post-call and not live

Live scoring would (a) burn rate limit mid-call, (b) be lower quality without the full
context, and (c) risk the AI's behaviour changing based on a running score. Capture live,
judge once at the end — same principle as plan section 3.8.

---

## 4. Smartness scoring in detail

### 4.1 Competency rubric (1–5), per `interview_questions` row

Anchored so two runs agree:

| Score | Anchor |
|---|---|
| **5 — Excellent** | Fully correct, specific, senior-appropriate; volunteers trade-offs, edge cases, real examples with numbers; handles the follow-up effortlessly. |
| **4 — Strong** | Correct and specific; minor gaps; good example; follow-up handled with a small nudge. |
| **3 — Adequate** | Broadly correct but generic or shallow; example is vague; needed a follow-up to get to the point. |
| **2 — Weak** | Partially correct with a real misconception, or could not go beyond a definition; follow-up did not help. |
| **1 — Poor / none** | Incorrect, off-topic, "I don't know" with no attempt, or no usable answer. |
| **N/A** | Question not reached (ran out of time) — excluded from the composite, shown as "not assessed". |

### 4.2 Reasoning sub-score (0–100, interview-level)

Model rates, with evidence quotes, on:

- **Structure** — do answers have a discernible shape (context → approach → outcome)?
- **Specificity** — concrete examples, names, numbers vs hand-waving.
- **Depth** — goes past the textbook definition into consequences and trade-offs.
- **Adaptability** — quality of recovery on follow-ups/curveballs; honest "I don't know"
  is **not** penalised as harshly as a confident wrong answer (bluffing).
- **Self-correction** — notices and fixes its own mistake unprompted → positive signal.

Local heuristics feed this too: high `false_start_count` with high `word_count` and many
`ai_followup_after` = rambling; very low `response_latency_ms` on a **high-difficulty**
question combined with `reading_flag` = possible pre-read answer → lowers the
**integrity** score (plan 3.8), not the smartness score directly, but is surfaced.

### 4.3 Gemini Flash — competency prompt skeleton

```
You are scoring one interview answer for the role: {role_title}.
COMPETENCY: {question.competency}   INTENT: {question.intent}   DIFFICULTY: {question.difficulty}/5
QUESTION: {question.text}

TRANSCRIPT (this Q/A block only, with ts_ms):
{turns}

Score STRICTLY against this rubric: {rubric anchors 1–5 from §4.1}.
Return JSON only:
{
  "score": 1-5 | null,
  "confidence": 0-1,
  "evidence": [{ "ts_ms": int, "quote": "verbatim from transcript" }],   // >=1 required or score is void
  "justification": "<= 40 words, references the evidence",
  "misconceptions": ["..."],       // [] if none
  "bluff_suspected": boolean       // confident tone, wrong/empty substance
}
Do not reward verbosity. Do not infer facts not present in the transcript.
```

Zod schema rejects the object if `evidence` is empty or any `quote` is not a substring of
the block text (grounding gate). A voided score → that competency falls back to a
metrics-only "insufficient signal" note.

### 4.4 Aggregating to the Cognitive composite (0–100)

```
per_competency_avg  = mean(valid competency scores)          -- 1–5
competency_pts      = (per_competency_avg - 1) / 4 * 100      -- 0–100
cognitive_composite = round(
      0.60 * competency_pts
    + 0.30 * reasoning_subscore
    + 0.10 * clarity_subscore )
```

Weights live in `interview_rubric_config` (below). Difficulty-weighting option: weight each
competency score by `question.difficulty` so nailing hard questions counts more.

---

## 5. English fluency scoring in detail

### 5.1 Objective local score (0–100) — no model

Each metric is mapped through a **piecewise-linear band** (config-driven) to 0–100, then
averaged with weights. Illustrative bands (tunable):

| Metric | Healthy range → 100 | Penalised toward 0 |
|---|---|---|
| Prose WPM | 110–170 | < 70 or > 220 |
| Filler ratio | < 3% | > 12% |
| Disfluency rate (/100 words) | < 4 | > 15 |
| Mean length of run (voiced ms between pauses) | > 2500 ms | < 700 ms |
| Long-pause rate (pauses > 800 ms per min) | < 4 | > 15 |
| Type-token ratio (100-token window) | > 0.62 | < 0.40 |
| ASR confidence | > 0.90 | < 0.65 |
| ASR agreement (Web Speech vs Gemini) | > 0.85 | < 0.55 |
| Response latency (median, after AI turn) | 300–1500 ms | > 4000 ms |

`local_fluency = Σ(weightᵢ · bandᵢ) / Σweightᵢ`

### 5.2 Gemini Flash — fluency rubric (CEFR-aligned)

One call. Input: all candidate turns concatenated (with `ts_ms`), plus 2–4 short **audio
clips** for pronunciation/intelligibility (Gemini 2.0 Flash accepts audio).

```
Assess the candidate's spoken English from this interview. Judge communication, not accent.
A clearly-understood regional accent is NOT a deduction.

CANDIDATE TURNS: {turns}
AUDIO SAMPLES: {clips}

Return JSON only:
{
  "cefr": "A2" | "B1" | "B2" | "C1" | "C2",
  "sub": {
    "grammar":       { "band": 0-100, "notes": "..." },
    "vocabulary":    { "band": 0-100, "notes": "..." },
    "coherence":     { "band": 0-100, "notes": "..." },
    "fluency":       { "band": 0-100, "notes": "..." },   // hesitation, flow
    "intelligibility":{ "band": 0-100, "notes": "..." }
  },
  "evidence": [{ "ts_ms": int, "quote": "verbatim" }],     // >=2 required
  "summary": "<= 50 words"
}
Ignore technical correctness of the content — that is scored elsewhere.
```

CEFR → anchor points: `A2=35, B1=55, B2=72, C1=86, C2=95`; `model_fluency` = mean of the
five sub-bands, sanity-checked to sit within ±12 of the CEFR anchor (else clamp + log).

### 5.3 Final fluency_score

```
fluency_score = round( 0.45 * local_fluency + 0.55 * model_fluency )
```

Adjustments:

- **Short sample:** total candidate `speech_ms` < 90s → cap confidence, add
  `"low_sample"` flag; HR sees "indicative only".
- **`degraded_mode` (Step 5 §9):** browser-TTS fallback means fewer/again-transcribed
  turns → weight shifts to `0.7 * local + 0.3 * model`, `"degraded"` flag set.
- **Code-heavy answers:** turns where > 40% tokens are code identifiers are excluded from
  prose metrics (WPM, TTR) but still count for coherence.

---

## 6. Fairness & bias controls

1. **Accent-neutral by construction** — rubric text forbids accent deductions; the
   objective side uses **intelligibility proxies** (ASR agreement/confidence), not any
   "native-likeness" measure.
2. **Content vs language separation** — the fluency call is told to ignore technical
   correctness; the competency call is told to ignore grammar. A candidate with strong
   ideas and B1 English still scores high on Cognitive.
3. **Grounding gate** — no score survives without a transcript quote, so the model cannot
   "vibe-score".
4. **Difficulty transparency** — the HR report shows which questions were `N/A` (not
   reached) so a short interview isn't silently read as a weak one.
5. **Human final say** — the module outputs a **recommendation**, never an auto-reject.
   HR sees all evidence and decides. Candidate never sees any score (plan 3.9).
6. **Re-scorable** — `rubric_version` stamped; if HR tunes weights, old interviews can be
   re-scored for consistency.
7. **No protected-attribute inference** — prompts never ask the model to guess age,
   gender, ethnicity, or nationality, and any such text in a model output is scrubbed.

---

## 7. Data model additions

Extend `interview_reports` (plan schema) with:

```sql
alter table interview_reports
  add column cognitive_composite  int,          -- 0–100
  add column reasoning_subscore   int,
  add column clarity_subscore     int,
  add column fluency_cefr         text,         -- A2..C2
  add column fluency_local        int,
  add column fluency_model        int,
  add column fluency_breakdown    jsonb,        -- the five CEFR sub-bands + notes
  add column evidence             jsonb,        -- [{score_key, ts_ms, quote}]
  add column flags                text[],       -- low_sample | degraded | terminated | bluff_suspected ...
  add column rubric_version       text,
  add column llm_tokens_used      int;
-- competency_scores jsonb already exists:
--   [{ ord, competency, score, confidence, justification, evidence:[{ts_ms,quote}], bluff_suspected }]
```

Plus the new `interview_turn_metrics` table from §2 and a config table:

```sql
create table interview_rubric_config (
  id                    int primary key default 1,
  rubric_version        text not null default 'v1',
  cognitive_weights     jsonb not null,   -- { competency:0.6, reasoning:0.3, clarity:0.1 }
  fluency_weights       jsonb not null,   -- { local:0.45, model:0.55 } + per-metric weights
  metric_bands          jsonb not null,   -- the piecewise bands from §5.1
  difficulty_weighting  bool not null default false,
  min_speech_seconds    int  not null default 90,
  updated_at            timestamptz not null default now()
);
```

---

## 8. Overall recommendation synthesis

Final Gemini Flash call — sees **only** the computed numbers + top evidence, not raw
transcript (keeps it consistent with the scores):

```
Inputs: cognitive_composite, per-competency scores, fluency_score + CEFR,
        integrity_score (Step 4 / plan 3.8), communication scores, flags.
Output JSON:
{
  "recommendation": "strong_yes" | "yes" | "maybe" | "no",
  "rationale": "<= 120 words",
  "top_evidence": [{ "ts_ms": int, "why": "..." }],   // exactly 3
  "strengths": ["..."], "concerns": ["..."]
}
```

Hard guards around it (not left to the model):

- `integrity_score < 40` (heavy cheating signal) → cap recommendation at `maybe` and add
  a `"review_integrity"` flag.
- `status = 'terminated'` for a hard rule → recommendation forced to `no` unless HR
  overrides; rationale notes the termination.
- Any `N/A` on a **core** competency (`difficulty >= 4`) → cannot be `strong_yes`.

---

## 9. HR report display (what Step 6 adds to the page)

- **Score cards:** Cognitive composite (with the competency bars), English fluency (band +
  the five sub-bars), Integrity (from Step 4), Communication/confidence (from Step 3).
- **Per-question drill-down:** each question → its score, the model's justification, and
  **clickable evidence timestamps** that seek the recording + highlight the transcript
  line (reuses the Step-4 violation-timeline seek behaviour).
- **Fluency evidence panel:** the objective metrics table (§5.1) with the healthy ranges
  shown, next to the model's CEFR summary.
- **Flags banner:** `low_sample`, `degraded`, `terminated`, `bluff_suspected`,
  `review_integrity` — each links to its evidence.
- **Raw model rationale:** collapsible, verbatim, for auditability.
- **"Re-score" button** (HR/admin only) → re-runs §3 with current `rubric_config`.

---

## 10. Testing

Pure functions carry most of the load (repo rule: mock Gemini + Supabase in unit tests).

| Unit | Test |
|---|---|
| Every metric calculator (§2.1) | Table-driven fixtures: known transcript + VAD segments → exact expected numbers; edge cases (empty turn, all-code turn, single word). |
| Band mapping (§5.1) | Value at each breakpoint → expected 0–100; monotonic; clamps at ends. |
| `local_fluency` / `cognitive_composite` aggregation | Weighted sums with fixture sub-scores; weights from a fixture config; `N/A` competencies excluded. |
| Grounding gate | Model output with a non-substring quote → judgement dropped; with valid quote → kept. |
| Zod schemas | Malformed model JSON (missing evidence, score out of range, bad CEFR) → rejected with a typed error. |
| Recommendation guards (§8) | `integrity < 40` caps at `maybe`; terminated → `no`; core `N/A` blocks `strong_yes`. |
| Idempotency | Run job twice on the same fixture interview → identical `interview_reports` row (bar `generated_at`). |
| Fairness | Fixture: strong content + weak grammar → high Cognitive, low-ish fluency, and vice-versa (scores don't bleed). |

Integration (mocked Flash returning canned JSON): full job over a fixture interview
(transcript + turn_metrics + events) → assert the written `interview_reports` +
`interview_turn_metrics` shape and every derived number.

---

## 11. Failure modes

| Failure | Handling |
|---|---|
| Gemini Flash quota / 5xx during the job | Retry with backoff (`tenacity`-style); job stays `pending`; HR sees "scoring in progress"; never a half-written report (write is one transaction at the end). |
| Model returns unparseable / ungrounded output for a question | That competency → "insufficient signal" (metrics-only note); job still completes. |
| No/short transcript (candidate barely spoke) | `low_sample` flag; competency scores mostly `N/A`; fluency "indicative only"; recommendation likely `no` with rationale "insufficient response". |
| VAD data missing (3.7d failed) | Pause-based metrics `null`; local fluency computed from the remaining metrics with renormalised weights. |
| Web Speech API unavailable (browser) | `asr_agreement` `null`; intelligibility leans on provider `asr_confidence` + the model's audio check only. |
| Recording clips unavailable for audio check | Fluency runs text-only; `fluency_model` from turns alone; note added. |
| `degraded_mode` interview | Weighting shift + `degraded` flag as §5.3. |

---

## 12. Build order (fits plan §Phase 6)

1. **`interview_turn_metrics` table + the Step-5 proxy writes one row per turn** (timing,
   word count, filler count) — no VAD/ASR yet.
2. **Local metric calculators** (`lib/interview/metrics/`) + their unit tests.
3. **Wire VAD segments + Web Speech API second ASR** into the turn rows (pauses, agreement).
4. **Post-call job skeleton**: segment transcript, roll up local metrics, write a
   metrics-only `interview_reports` (no model yet).
5. **Gemini Flash competency rubric** + grounding gate + Zod.
6. **Gemini Flash fluency rubric** + local/model blend.
7. **Recommendation synthesis** + hard guards.
8. **`interview_rubric_config`** + "Re-score" button.
9. **HR report UI**: score cards, per-question drill-down, fluency evidence panel, flags.

Each step is independently shippable and demoable against a fixture interview.

---

## 13. Open questions

1. **CEFR vs plain 0–100 only** — do HR want the CEFR label surfaced, or is a single
   "English fluency: 78/100 (strong)" enough? (We compute both; display is a toggle.)
2. **Difficulty weighting** — on or off by default for the Cognitive composite?
3. **Audio for the fluency model** — how many seconds of clips is enough for a reliable
   pronunciation read without pushing token cost up? Start with 3 × 12s.
4. **Filler lexicon per locale** — extend beyond en-US ("na", "haan", code-switching) if we
   go multi-language (ties to Step 5 open question 3).
5. **Bluff detection threshold** — how aggressively should `bluff_suspected` feed the
   recommendation vs just being shown to HR?
6. **Benchmark / calibration set** — collect ~20 past human-scored interviews to calibrate
   the band breakpoints and weights before trusting the composite.
