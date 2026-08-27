---
title: Blog Fetch — How Digests Work for Every User Type
tags: [fetch-blogs, personalization, learning-path, digests, next-day]
created: 2026-08-27
updated: 2026-08-27
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

---

## User types at a glance

| User type | How discovery works | How ranking/teaching works |
|---|---|---|
| **Has stacks / interests** | Tagged scrape (Dev.to tags, HN title match, matching RSS) | Personalized embedding + active stack theme |
| **No stacks / interests (day 1)** | Untagged “today’s latest” Dev.to + HN tops + admin feeds | Generic engineering query; theme inferred from articles |
| **No prefs, but has yesterday** | Continuity themes (`last_topics`, `active_stack`) steer tags | Embedding + prompts continue yesterday’s series |
| **Any user after quiz** | Same discovery path; pace adds keywords (`basics` / `advanced`) | Teaching style follows quiz pace (simpler ↔ harder) |

“Has discovery prefs” is true when **any** of these exist:

- `primary_tech_stack` / `secondary_tech_stack` / `interests`
- **or** continuity: `learning_path.last_topics` / `active_stack`

So a user who started empty can become “personalized” after day 1 without filling the gatekeeper form again.

Code: `profile_has_discovery_prefs`, `interest_scrape_terms` in `fetch-blogs/src/ranker/next_day.py`.

---

## 1. User WITH interests / stacks

Example: stacks `Node, React, Postgres` · interest `Want to learn about LLMs`.

### Scrape
- Build terms from stacks + interests (+ continuity + quiz pace hints), max 8.
- **Dev.to** — fetch by those tags (not only untagged latest).
- **HN** — prefer stories whose titles match terms, then fill with other tops.
- **Admin feeds** (Admin → Sources) — always interleaved (news domains skipped).
- **RSS registry** — only items that match terms.
- Skip URLs already in `learning_path.served_urls`.
- Cap ~24 articles; if nothing new, fall back to recent unserved learning articles in Mongo.

### Rank
- Refresh **profile embedding** from: role, stacks, interests, yesterday’s headline/TL;DR/themes, quiz marks, pace sentence.
- Merge pipeline articles + embedded corpus; drop non-learning.
- Vector similarity + TF-IDF/authority/recency score + Gemini re-rank → top ~10.

### Generate
- Prefer articles on the **active stack** theme.
- Gemini opening + teaching chapters: tutorials, APIs, debugging, architecture — **not** news.
- Prompt includes “continue yesterday’s briefing” when continuity exists.
- Publish stores sources into `served_urls` and refreshes `last_digest_*` / `last_topics`.

---

## 2. User WITHOUT interests / stacks

### Day 1 (cold start)
- `interest_scrape_terms` returns **`[]` on purpose** — no invented default tags.
- Scrape pulls **untagged latest** Dev.to + HN tops + admin/RSS (no title filter when terms are empty).
- Embedding query falls back to a generic “software engineering technical morning briefing” string if there is nothing else.
- Theme for teaching is inferred from whatever articles landed (or a generic `"tech"`).
- Still **learning-only**: news/repo dumps are dropped.

### Day 2+ (still empty prefs, but has a digest)
- Publish from day 1 filled `last_topics`, `last_digest_headline`, etc.
- `profile_has_discovery_prefs` becomes **true** via continuity.
- Scrape/rank/generate behave like a personalized user, steered by **yesterday’s themes**, not by admin stacks.

---

## 3. Next-day behavior (all users)

What changes after the first successful publish:

| Signal | Day 1 | Day 2+ |
|---|---|---|
| `served_urls` | empty | yesterday’s source URLs excluded |
| Yesterday’s briefing | none | headline, TL;DR, takeaways, themes fed into embedding + Gemini |
| Active stack run | starts from first stack (if any) | stays on one stack until ~7 digests / ~6 covered angles, then rotates |
| Quiz | none → pace `continue` | fail → simpler teaching; pass → advance |

Active stack / rotation: `resolve_active_stack`, `maybe_rotate_stack_run` in `fetch-blogs/src/models/profile.py`.

Weak/next-step topic lists may be stored from quizzes but are **not** used to drive the next scrape.

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
                    ┌─ has stacks/interests ─► tagged discovery
                    │
   Generate ────────┼─ empty prefs, day 1 ───► untagged latest (learning only)
                    │
                    └─ empty prefs, day 2+ ──► continuity from yesterday

   Then for everyone:
     rank (embeddings + scores) → learning briefing → save → update learning_path
```

**In one sentence:** digests are personalized learning briefings — tagged when prefs exist, “today’s best learning posts” when they don’t, and always continued from yesterday once a digest exists.
