---
title: Setup Guide
created: 2026-05-16
updated: 2026-05-16
tags: setup, installation, environment
---
# Setup Guide

This guide covers the steps required to set up the development environment for the Creole Knowledge Portal.

## Prerequisites

*   Node.js (version managed by `package.json`, recommend LTS)
*   npm or yarn (npm is used in `package.json` scripts)
*   Supabase account (for local development and deployment)
*   Google Cloud account (for Google OAuth integration)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone [repository-url]
    cd creole-knowledge-portal
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Variables:**
    Create a `.env.local` file in the root directory and populate it with the necessary credentials. See `.env.example` for details.

    *   `GEMINI_API_KEY`
    *   `SUPABASE_URL`
    *   `SUPABASE_ANON_KEY`
    *   `SUPABASE_SERVICE_ROLE_KEY` (Server-side only)
    *   `NEXT_PUBLIC_SUPABASE_URL`
    *   `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    *   `GOOGLE_CLIENT_ID`
    *   `GOOGLE_CLIENT_SECRET`

    **Note:** Never commit `.env.local` to version control.

## Running the Application

1.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:3000`.

2.  **Run linters and tests:**
    ```bash
    npm run lint
    npm run test
    ```

## Database Setup

Refer to the Supabase project settings for database schema and table information. Ensure your local Supabase instance or development database is configured correctly.