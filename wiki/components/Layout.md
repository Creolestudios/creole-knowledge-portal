---
title: Layout Components
tags: [components, layout, ui]
created: 2026-05-16
updated: 2026-06-13
---
# 🖼️ Layout Components

Documentation for the structural components that define the application's shell.

## 🏗️ Core Layouts

### Main Application Layout
- **File**: `app/layout.tsx`
- **Purpose**: The root layout for the entire application.
- **Responsibilities**:
  - Configures the HTML `<html>` and `<body>` tags.
  - Loads global styles (`globals.css`).
  - Wraps all pages in the necessary providers (e.g., Theme, Auth).

### Dashboard Layout
- **Purpose**: Provides the consistent shell for the authenticated user's experience.
- **Features**:
  - Navigation header.
  - User profile context.
  - Responsive container for digest content.

### Admin Layout
- **Purpose**: A restricted shell for administrative tasks.
- **Features**:
  - Admin-specific navigation.
  - High-privilege action warnings.

## 🎨 Styling Standards
- **Global Styles**: Managed in `app/globals.css`.
- **Brand Tokens**: Uses custom Tailwind tokens like `bg-brand` and `text-brand`.
- **Theming**: Defaults to a dark-mode centric palette (`bg-[#0a0a0a]`).
