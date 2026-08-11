---
title: ADR-003: Hybrid Content Strategy
tags: [decisions, adr, ai, scraping]
created: 2026-06-13
updated: 2026-06-13
---
# ADR-003: Hybrid Content Strategy

## Status
Accepted

## Context
Relying solely on RSS feeds (Strategy A) often misses high-quality, non-syndicated content. Conversely, purely AI-powered crawling (Strategy B) is expensive, slower, and can be prone to hallucinations or rate-limiting.

## Decision
Implement a **Hybrid Strategy (Strategy C)** as the primary production pipeline.

- **Fetch Layer**: Use Strategy A (RSS, Dev.to, Reddit) for broad, efficient content acquisition.
- **Ranking Layer**: Use Strategy B (Gemini embeddings + semantic re-ranking) to filter the broad fetch results for the highest relevance to the user's specific technical profile.
- **Synthesis Layer**: Use Gemini 2.0 Flash to synthesize the top-ranked articles into a long-form, structured digest.

## Consequences
- **Efficiency**: Maintains the low cost and high speed of RSS.
- **Quality**: Gains the precision of semantic AI ranking.
- **Complexity**: Requires maintaining two distinct fetch/rank logic paths in the Python service.
- **Cost**: Minimizes token usage by only sending the most relevant content to the synthesis LLM.
