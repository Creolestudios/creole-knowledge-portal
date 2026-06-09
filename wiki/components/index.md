---
title: Components Map of Content
tags: [moc, components, documentation]
created: 2026-05-27
updated: 2026-05-27
---

# Components Map of Content (MOC)

This page lists and describes all primary React and UI components used in the **Creole Knowledge Portal** application.

---

## 🏗️ Interactive & Stateful Components

- [[components/user-management|User Management]]: Admin panel component for searching, viewing, and modifying user profiles, tech stacks, and interest sets.
- [[components/logout-button|Logout Button]]: Authentication helper component providing sidebar and default styling variations for session termination.

---

## 🛠️ General Guidelines

1. **State Ownership**: React state should be managed locally using standard React hooks (`useState`, `useEffect`) and shared using client-side libraries only when required.
2. **Icons**: Use the standard `lucide-react` library for all icons to maintain visual consistency.
3. **Animations**: Use `motion/react` (Framer Motion) for all transition animations. Ensure components use clean enter/exit stages via `<AnimatePresence>`.
4. **Styling**: Component styles should strictly leverage Tailwind CSS utility classes and design tokens declared in `app/globals.css`.
