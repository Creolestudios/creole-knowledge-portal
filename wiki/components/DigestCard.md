---
title: Digest Card Component
created: 2026-05-16
updated: 2026-05-16
tags: components, digest
---
# Digest Card Component

This component is responsible for displaying a single article digest item on the user's dashboard.

- **File:** `components/DigestCard.tsx` (assumed path)

## Props

*   `article`: An object conforming to the `Article` or `DigestOutput` structure (depending on exact implementation), containing details like headline, TLDR, source, URL, etc.
*   `index`: The index of this digest in the list (for potential styling or tracking).

## Features

*   Displays the article headline and a brief summary (TLDR).
*   Shows the source domain and author.
*   Provides a link to the original article.
*   May include estimated reading time or other metadata.
*   Uses `motion` for animations (as per coding standards).

## Styling

*   Utilizes Tailwind CSS for styling.
*   Likely uses a predefined panel background color (e.g., `bg-[#0a0a0a]` or `bg-[#f8f9fa]`).

## Dependencies

*   `motion/react` for animations.
*   `clsx` and `tailwind-merge` for flexible class name management.

TODO: Add more details once the exact structure of the `article` prop is confirmed.