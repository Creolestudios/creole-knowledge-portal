---
title: "ADR-003: Standalone Build Output for Cloud Run"
tags: [adr, deployment, cloud-run, docker, decision]
created: 2025-05-16
updated: 2025-05-16
---

# ADR-003: Standalone Build Output for Cloud Run

## Status

Accepted

## Context

The application needs to be deployed to Google Cloud Run, which runs containerized applications. Next.js offers several output modes:
- **Default** — Requires full `node_modules` in the container
- **Standalone** — Produces a minimal self-contained output
- **Export** — Static HTML only (no server features)

The app uses server-side features (middleware, route handlers, SSR) so static export is not viable.

## Decision

Configure `output: 'standalone'` in `next.config.ts` to produce a minimal deployment artifact suitable for Docker containers on Cloud Run.

## Consequences

### Positive
- Dramatically smaller Docker images (only necessary files included)
- Faster container startup times
- No need to install `node_modules` in production container
- Compatible with Cloud Run's stateless container model
- Includes a built-in minimal Node.js server

### Negative
- Some packages may need explicit `transpilePackages` configuration (e.g., `motion`)
- Static assets need separate handling (typically served from `.next/static`)
- Development workflow differs slightly from production behavior
- Cookie configuration must account for Cloud Run's proxy layer (SameSite=none, Secure=true)
