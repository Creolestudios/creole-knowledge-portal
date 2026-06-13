---
title: Setup Guide
tags: [setup, installation, environment]
created: 2026-05-16
updated: 2026-06-13
---
# Setup Guide

This guide covers the steps required to set up the development environment for the Creole Knowledge Portal.

## 🛠️ Prerequisites

- **Node.js**: LTS version (v20+ recommended).
- **npm**: Included with Node.js.
- **Supabase Account**: For authentication, database, and vector storage.
- **Google Cloud Console**: For Google OAuth credentials.
- **Gemini API Key**: From Google AI Studio for the content synthesis engine.

## 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone [repository-url]
   cd creole-knowledge-portal
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env.local` file in the root directory. Use the following template:

   ```env
   # Supabase Configuration
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key # Server-side ONLY

   # AI Configuration
   GEMINI_API_KEY=your_gemini_api_key

   # OAuth Configuration
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

   > ⚠️ **Security Warning**: Never commit `.env.local` to version control.

## 💻 Running the Application

### Development Mode
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

### Quality Checks
- **Linting**: `npm run lint`
- **Unit Tests**: `npm run test`
- **Full CI Gate**: `bash scripts/ci-test.sh`

## 🗄️ Database & Auth Setup

1. **Supabase Tables**: Ensure the following tables are initialized:
   - `user_profiles`
   - `articles`
   - `daily_digests`
2. **Vector Support**: Enable `pgvector` extension in the Supabase dashboard.
3. **Auth Providers**: Enable "Magic Link" and "Google" providers in the Supabase Auth settings.
4. **Redirect URLs**: Set `http://localhost:3000/auth/callback` as a valid redirect URL in Supabase.
