---
title: Roadmap & Known Issues
created: 2026-05-16
updated: 2026-05-16
tags: roadmap, issues, future
---
# Roadmap & Known Issues

## Future Plans

*   **Enhanced AI Digest Personalization:** Implement more sophisticated user profiling and content analysis to tailor AI digests more effectively.
*   **Expanded Blog Sources:** Integrate additional news sources and technical blogs, potentially with a UI for users to add their own RSS feeds.
*   **Community Features:** Explore features for users to share or comment on recommended articles.
*   **Performance Optimizations:** Further refine blog fetching and AI synthesis pipelines for speed and cost-efficiency.

## Known Issues

*   **Initial blog fetch reliability:** Some RSS feeds may occasionally fail to parse correctly due to non-standard formatting. (See `fetch-blogs/` module logs for details).
*   **Supabase connection stability:** Under heavy load, there might be intermittent connection issues with Supabase. (See `lib/supabase/` error logs).
*   **Admin email hardcoding:** The admin email (`priya.dhanani@creolestudios.com`) is currently hardcoded in `middleware.ts`. A future iteration may involve a more flexible configuration for admin roles.