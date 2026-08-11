---
title: ADR-002: Supabase Auth for Identity
tags: [decisions, adr, auth, supabase]
created: 2026-06-13
updated: 2026-06-13
---
# ADR-002: Supabase Auth for Identity

## Status
Accepted

## Context
The project needs a secure, scalable identity provider and a database that supports both relational data and vector embeddings for AI synthesis. Building a custom auth system would introduce significant security overhead and delay delivery.

## Decision
Adopt **Supabase** as the integrated identity provider and database.

- **Auth**: Use Supabase Magic Link (OTP) and Google OAuth for passwordless, corporate-friendly login.
- **Database**: Use PostgreSQL with the `pgvector` extension to store user profiles, articles, and daily digests.
- **Client Logic**: Implement a tiered client strategy (`client.ts`, `server.ts`, `admin.ts`) to strictly separate browser-safe operations from privileged server-side admin tasks.

## Consequences
- **Vendor Lock-in**: The project is now dependent on Supabase's infrastructure.
- **Development Speed**: drastically reduced time-to-market for auth and DB setup.
- **Security**: Offloads password management and session handling to a trusted provider.
- **Capability**: Native support for vector similarity search via `pgvector` is critical for Strategy B and C of the content pipeline.
