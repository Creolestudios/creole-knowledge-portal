---
title: ADR-001: Use Next.js App Router
created: 2026-05-16
updated: 2026-05-16
tags: decisions, adr, architecture, nextjs
---
# ADR-001: Use Next.js App Router

## Status

Accepted

## Context

The project requires a modern React framework for building its frontend. Key considerations include server-side rendering, efficient data fetching, routing, and component architecture. The team needs to decide on the primary routing and rendering paradigm for the Next.js application.

## Decision

Adopt the **Next.js App Router** as the primary routing and rendering paradigm for the Creole Knowledge Portal frontend.

This decision is based on the following:

*   **App Router Features:** Leverages Server Components by default, layouts, loading states, error handling, and improved data fetching patterns.
*   **Future-Proofing:** Aligns with the latest recommended practices in the Next.js ecosystem.
*   **Project Alignment:** The `CLAUDE.md` explicitly mandates the use of the App Router and discourages the use of the `pages/` directory.

## Consequences

*   **Development:** All new page creation and routing logic must adhere to App Router conventions.
*   **Codebase Structure:** Expect a directory structure under `app/` for routing and pages.
*   **Learning Curve:** Development team needs to be familiar with App Router concepts (Server Components, Client Components, data fetching in Server Components, etc.).
*   **Tooling:** Ensure development tools and linters are configured to support App Router conventions.

TODO: Add specific examples of how this decision impacts file structure and component implementation.