---
title: "ADR-005: Use Google Gemini for Content Synthesis"
tags: [adr, ai, gemini, google, decision]
created: 2025-05-16
updated: 2025-05-16
---

# ADR-005: Use Google Gemini for Content Synthesis

## Status

Accepted

## Context

The portal needs an AI service to:
- Analyze blog content from configured sources
- Generate personalized recommendations based on user profiles
- Synthesize daily digests tailored to each team member's tech stack and interests

Options considered:
- **OpenAI GPT-4** — Powerful but expensive for daily batch processing
- **Google Gemini** — Competitive quality with generous free tier
- **Local LLM** — No API costs but requires infrastructure
- **Claude (Anthropic)** — Good quality but less integration with Google ecosystem

## Decision

Use Google Gemini (`@google/genai` SDK) for content synthesis and recommendation generation. The free tier is sufficient for an internal team tool with daily batch processing.

## Consequences

### Positive
- Generous free tier suitable for internal team size
- Good integration with Google ecosystem (team uses Google Workspace)
- `@google/genai` SDK is straightforward to use
- Supports structured output for recommendation formatting
- API key is simple to manage (single env var)

### Negative
- Free tier has rate limits that may need monitoring
- Vendor dependency on Google AI services
- Content quality depends on prompt engineering
- API key must be kept server-side only
- The blog fetch and synthesis pipeline is not yet implemented (planned as Python/FastAPI service)
