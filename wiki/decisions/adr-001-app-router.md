---
title: ADR-001 App Router Usage
tags: [decision, architecture]
created: 2026-05-16
updated: 2026-05-16
---

# ADR-001: Next.js App Router

**Status:** Accepted

## Context
Next.js 15 App Router provides a more modern approach to routing and server-side component handling.

## Decision
Use Next.js App Router exclusively. No `pages/` directory.

## Consequences
- Better support for server components.
- Cleaner routing structure.
- Requires learning new conventions.
