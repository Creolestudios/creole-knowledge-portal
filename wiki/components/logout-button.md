---
title: LogoutButton Component
tags: [components, authentication, layout]
created: 2026-05-27
updated: 2026-05-27
---

# LogoutButton Component

The `LogoutButton` component provides a standard trigger to securely terminate user authentication sessions.

- **File Path**: [logout-button.tsx](file:///var/www/html/creole-knowledge-portal/components/logout-button.tsx)
- **Component Type**: Client Component (`'use client'`)
- **Dependencies**: Lucide React (`LogOut`), Next.js Router Navigation (`useRouter`), Supabase Client.

---

## 🔩 Props & Configuration Interface

```typescript
interface LogoutButtonProps {
  variant?: 'default' | 'sidebar';
}
```

The component adjusts its visual representation based on the `variant` string:

### 1. `default` Variant

- **Styling**: Standard text button with standard margins.
- **Coloring**: Renders inline with neutral gray text and highlights to bright red when hovered.
- **Use Case**: Inline menu headers, profile dropdown trays.

### 2. `sidebar` Variant

- **Styling**: Block-level navigation element.
- **Coloring**: Bright white hover text against a dark grey background highlight (`bg-zinc-800`). Contains dynamic slide-out icon animations.
- **Use Case**: Bottom section of side navigation panels.

---

## ⚡ Execution Flow

1. User clicks the button container.
2. The component calls `await supabase.auth.signOut()` to clear server-session tokens and cookies.
3. Upon success, invokes `router.push('/')` to force page redirection to the login root route.
4. Invokes `router.refresh()` to reload layout contexts, resetting cookie values handled by the Edge Middleware middleware.
