# Supabase Patterns

## Client Selection Rules

| Context | Import | Why |
|---------|--------|-----|
| Browser (Client Component) | `lib/supabase/client.ts` | Uses `createBrowserClient` |
| Server Component / Route Handler | `lib/supabase/server.ts` | Uses `createServerClient` with cookie forwarding |
| Admin operations (service role) | `lib/supabase/admin.ts` | Bypasses RLS — server-only |

⚠️ **Never** import `admin.ts` in a client component. It exposes `SUPABASE_SERVICE_ROLE_KEY`.

## Auth Patterns

### Magic Link (OTP)
```typescript
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: `${origin}/auth/callback` },
});
```

### Google OAuth
```typescript
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${origin}/auth/callback` },
});
```

### Get current user (Server)
```typescript
// In Server Component or Route Handler:
const supabase = await createClient(); // from lib/supabase/server.ts
const { data: { user } } = await supabase.auth.getUser();
```

### Admin: list all users
```typescript
// Only in Route Handler (server-side)
import { createAdminClient } from '@/lib/supabase/admin';
const admin = createAdminClient();
const { data: { users } } = await admin.auth.admin.listUsers();
```

## Middleware Pattern
Auth routing is handled exclusively in `middleware.ts`:
- `/` → login page (redirect to dashboard if already logged in)
- `/dashboard/*` → requires authenticated non-admin user
- `/admin/*` → requires authenticated admin email

**Do not** replicate this logic in page components.

## Cookies
- Cookies use `sameSite: 'none'` and `secure: true` for cross-origin compatibility
- The `setAll` method in the middleware must copy cookies to redirect responses

## Database Access
- Always use typed queries with Supabase's generated types (when available)
- For bulk user operations, use the admin client's `auth.admin.*` methods
- Never write raw SQL in components — use Supabase client query builder

## Error Handling
```typescript
const { data, error } = await supabase.from('table').select('*');
if (error) {
  console.error('[context] Supabase error:', error.message);
  return { error: 'Friendly message for user' };
}
```
