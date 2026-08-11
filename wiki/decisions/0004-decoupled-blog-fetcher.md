---
title: 'ADR 0004: Decoupled Python Blog Crawler & Summarizer'
tags: [adr, architecture, integration, backend]
created: 2026-05-27
updated: 2026-05-27
---

# ADR 0004: Decoupled Python Blog Crawler & Summarizer

## Status

**Proposed**

---

## Context

To recommend technical articles, the system must crawl registered blog URLs, parse HTML articles, synthesize summaries using Gemini AI, and save them.

Executing long-running scraping tasks, handling HTML parsing, and processing AI synthesis inside a Next.js server can cause slow-downs, increase resource usage, and lead to request timeouts. Additionally, Python has a much richer ecosystem of libraries for web crawling, HTML text sanitization, and AI pipeline orchestration.

---

## Decision

We proposed decoupling these background tasks into a dedicated Python microservice (`fetch-blogs`) built with **FastAPI**:

1. **Separation of Concerns**: Next.js serves as the frontend client interface and admin tool. The Python microservice handles scheduled blog scraping and summarization tasks.
2. **Database Integration**: The Python microservice queries target sites configured in `blog_sources`, runs the crawl pipeline, and writes the summarized results back to the database. Next.js reads summaries directly from the database, eliminating the need for complex inter-process APIs.
3. **Obeying Crawl Rules**: The Python crawler must verify target sites' `robots.txt` directives before scraping to ensure compliance with external site rules.

---

## Consequences

- **Positive**:
  - Better performance: Next.js frontend rendering remains fast and is unaffected by resource-intensive crawling tasks.
  - Development speed: Leverage Python libraries (like BeautifulSoup, Scrapy, and Pydantic) to build robust scraping and validation logic.
- **Negative**:
  - Requires maintaining and deploying a separate runtime environment (Python + FastAPI) alongside the Node.js application.
  - Requires setting up database access and Gemini AI keys on both the Python server and the Next.js backend.
