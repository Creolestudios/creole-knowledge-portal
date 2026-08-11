---
title: Digest Card Component
tags: [components, digest]
created: 2026-05-16
updated: 2026-06-13
---
# 📄 Digest Card Component

The `DigestCard` is the central UI element for presenting synthesized AI content to the user.

## 🎯 Purpose
To provide a concise, scannable summary of a technical article that encourages the user to read the full synthesis or the original source.

## 🛠️ Implementation

### Props
The component expects a data structure matching the `DigestOutput` contract from the blog fetch module:
- `headline`: String.
- `tldr`: Array of strings (bullet points).
- `sources`: Array of source objects (title, url, author).
- `estimated_read_minutes`: Number.

### Styling & Animation
- **Framework**: Tailwind CSS 4.
- **Animations**: Uses `motion/react` for smooth entry and hover transitions.
- **Theme**: Adheres to the brand identity (e.g., `bg-brand` accents).

## 🔗 Related Files
- `app/dashboard/page.tsx`: Consumes the `DigestCard` to render the daily list.
- `fetch-blogs/src/models/`: Defines the Pydantic models that map to these props.
