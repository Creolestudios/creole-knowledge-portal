---
title: Blog Fetch — How Digests Work for Every User Type
tags: [fetch-blogs, personalization, learning-path, digests, next-day]
created: 2026-08-27
updated: 2026-09-01
---

# Blog Fetch — How Digests Work for Every User Type

This page explains **what the fetch-blogs pipeline does today** for different users: with interests, without interests, day 1 vs day 2+, and after a quiz.

Related: [[pages/fetch-blogs-walkthrough|Fetch Blogs Microservice Walkthrough]] (service layout, APIs, ops).

---

## One pipeline for everyone

Every digest run uses the same stages:

```text
scrape → extract → rank → generate → publish
```

| Stage | What it does |
|---|---|
| **Scrape** | Discover candidate URLs (Dev.to, Hacker News, admin RSS sources, small RSS registry) |
| **Extract** | Pull full article bodies |
| **Rank** | Score + embed + Gemini re-rank → pick ~8–10 learning articles |
| **Generate** | Gemini writes a ~20 min **learning** briefing (or scraped excerpts if Gemini is down) |
| **Publish** | Save `DailyDigest` in Mongo; update `learning_path` for tomorrow |

**Same-day rule:** if today’s digest already exists, Generate returns it (`cached: true`). No second digest for the same calendar day.

**Learning-only rule:** news, M&A, career fluff, and bare GitHub README dumps are filtered out (`is_non_learning` in `fetch-blogs/src/extractors/topic_filter.py`).

**English-only rule:** source blogs and the generated briefing (title, overview, body, takeaways) must be English. Portuguese/Spanish/French/German/CJK posts are dropped (`is_non_english_dominant`).

---

## User types at a glance

| User type | How discovery works | How ranking/teaching works |
|---|---|---|
| **Has interests** | Tagged scrape for **those interests only** (stack is ignored) | Embed + Gemini re-rank **interests only**; off-interest posts dropped |
| **No interests, newly joined (no yesterday)** | Tagged scrape for **primary/secondary stack** | Embed stack trending; first briefing on that stack |
| **No interests, returning (day 2+)** | Yesterday + quiz + uncovered topics on the **active stack only** | Rank with yesterday's embedding until that stack's topics are all covered, then rotate to the next family |
| **No interests and no stack** | Untagged latest learning posts from configured sites (last resort) | Generic engineering tutorial query |
| **Any user after quiz** | Same discovery path as above | Fail → simpler teaching; pass → next step |

“Has discovery prefs” is true when **interests** or **primary/secondary tech stack** is filled. Yesterday’s headline is **not** used as a scrape tag (that used to lock in Mac/Apple).

Code: `discovery_scrape_terms`, `discovery_match_terms` in `fetch-blogs/src/ranker/next_day.py`.

---

## 1. User WITH interests

Example: stacks `Node, React, Postgres` · interest `LLMs`.

### Scrape
- Terms = **interests only** (never mix in stack or yesterday).
- **Dev.to** — fetch by those tags.
- **HN / admin feeds / RSS** — only items whose title matches the interests.
- Skip URLs already in `learning_path.served_urls`.

### Rank
- Profile embedding = interests query only.
- Hard filter: article must match an interest term.
- Vector similarity + TF-IDF + Gemini re-rank → top ~10.

### Generate
- Teach from interest-matching articles only.
- Publish stores sources into `served_urls`.

---

## 2. User WITHOUT interests

### Newly joined (no yesterday briefing)
- Terms = `primary_tech_stack` + `secondary_tech_stack`.
- Scrape **today’s trending tutorials for that stack**.
- Rank/generate **hard-match the stack**. No generic hardware / Apple product posts.

### Returning (day 2+ — has yesterday headline/topics/embedding)
- **Must continue yesterday**, not start a new random stack topic.
- Rank query = stored `learning_path.last_digest_embedding` (the briefing vector saved at publish).
- Scrape tags = yesterday tech tokens (`last_topics`) + **quiz** (`weak_topics` on fail, `next_step_topics` on pass) + **uncovered topics in the active stack**. Other stack families are not scraped.
- Off-family titles are dropped (e.g. yesterday Python chunking → React 19 is rejected while the Python run is still open).
- Passing a quiz **does not** hop stacks. Rotation happens only after **every topic in that stack's curriculum is covered** (`stack_run_is_complete` → `maybe_rotate_stack_run`). One briefing that mentions chunk/chunks/chunking counts as a single topic.
- After the Python curriculum is done, the run moves to the next **family** on the profile (React, not FastAPI). The next briefing is that new stack — it does not keep pretending to continue Python.
- Gemini re-rank is told to continue yesterday’s theme while the run is open, then to start the new stack after rotation.
- Teaching copy still uses quiz pace (remedial vs advance).
- Raw headlines like “MacBook colors” are **not** used as scrape tags (only known tech tokens).

### No interests and no stack
- Last resort: untagged latest learning posts from configured sites.

---

## 3. Next-day behavior (all users)

What changes after the first successful publish:

| Signal | Day 1 | Day 2+ |
|---|---|---|
| `served_urls` | empty | yesterday’s source URLs excluded |
| Yesterday’s briefing | none | stored on the profile (`last_digest_*` + embedding). **Returning users with no interests rank against that embedding.** |
| Quiz | none → pace `continue` | fail → simpler teaching + scrape `weak_topics`; pass → advance + scrape `next_step_topics` |

Active stack / rotation: `resolve_active_stack`, `maybe_rotate_stack_run`, `stack_run_is_complete` in `fetch-blogs/src/models/profile.py`. Rotate only when every curriculum topic for the current family is in `stack_run_covered` (aliases collapsed). The next stack must be a **different family** (Python → React, not Python → FastAPI).

Weak/next-step topic lists from quizzes **do** steer the next scrape for returning users with empty interests (`quiz_focus_terms`). Users who filled interests still scrape interests only.

---

## 4. Quiz pace (all users who took the quiz)

| Quiz result | Pace | Effect |
|---|---|---|
| Not attempted | `continue` | Normal next piece in the stack run |
| Fail attempt 1 | `remedial` | Clearer / basics-oriented keywords + teaching |
| Fail attempt 2 | `simpler` | Even clearer teaching |
| Fail attempt 3 | `simplest` | Clearest teaching, same stack |
| Pass ≥ ~60% | `advance` | Next important piece, normal depth |
| Strong pass ≥ ~80% | `advance_hard` | Deeper / production / architecture angle |

Pace steers **embedding text**, a few scrape keyword extras, and synthesizer teaching instructions. It does **not** invent a new interest list.

---

## 5. Sources and filters (all users)

| Source | Role |
|---|---|
| Dev.to | Primary learning blogs (tagged or latest) |
| Hacker News | Tops; title-matched when prefs exist; news titles filtered |
| Admin `blog_sources` | Extra RSS/Atom feeds (HTTPS); news domains skipped |
| RSS registry | Small built-in list; matched to terms when prefs exist |

Dropped by `is_non_learning`:

- Career / soft-skill / portfolio fluff
- M&A, funding, earnings, layoffs, general news domains (TOI, WSJ, BI, …)
- Bare GitHub README / Show HN repo dumps (folder trees without a real tutorial)

---

## 6. What the dashboard does

1. User clicks **Synthesize** → Next.js `POST /api/digests/generate`.
2. Next.js asks FastAPI `/digests/generate` (with internal token).
3. If today already exists → return cached.
4. Else FastAPI syncs Supabase → Mongo profile, runs the Celery chain (or in-process fallback).
5. Dashboard loads flattened markdown from `/digests/{userId}/latest`.

If FastAPI times out or Gemini models 404, Next.js may show a **local fallback** article (banner + reason). That is not the full learning pipeline — fix by keeping Celery/FastAPI on a live Gemini model (e.g. `gemini-3.6-flash`) and allowing enough time for scrape→generate.

---

## 7. Mental model

```text
                    ┌─ has interests ─────────► scrape/rank/generate those interests only
                    │
   Generate ────────┼─ no interests, new join ► today's trending tutorials for that stack
                    │
                    ├─ no interests, returning ► yesterday + quiz + uncovered topics on the active stack; rotate family only when that stack is fully covered
                    │
                    └─ no interests, no stack ► last-resort learning posts

   Then for everyone:
     rank (embeddings + scores + Gemini) → learning briefing → save embedding for tomorrow
```

**In one sentence:** interests win when they exist; otherwise the briefing is today’s trending tutorials for the user’s tech stack — never a random hardware topic.
