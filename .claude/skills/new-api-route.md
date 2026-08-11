# Skill: Add a New API Route

## When to Use
Use when adding a server-side API endpoint under `app/api/`.

## Naming Convention
```
app/api/<resource>/route.ts          # e.g. app/api/digests/route.ts
app/api/<resource>/[id]/route.ts     # e.g. app/api/digests/[id]/route.ts
app/api/admin/<resource>/route.ts    # admin-only endpoints
```

## Route Handler Template
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('table')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[GET /api/resource]', error.message);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate body...
  const { data, error } = await supabase.from('table').insert(body).select().single();

  if (error) {
    console.error('[POST /api/resource]', error.message);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
```

## Admin Route Template
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const ADMIN_EMAIL = 'priya.dhanani@creolestudios.com';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email?.toLowerCase().trim() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data.users);
}
```

## Checklist
- [ ] Always verify auth before any data access
- [ ] Admin routes: check exact email match against `ADMIN_EMAIL` constant
- [ ] Return proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- [ ] Log errors server-side with `[route context]` prefix
- [ ] Never return stack traces or internal error details to client
- [ ] Use `await params` (Next.js 15 async params)
