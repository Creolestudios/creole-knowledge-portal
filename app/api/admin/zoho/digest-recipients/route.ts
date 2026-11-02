import { NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import {
  getAllDigestRecipients,
  addDigestRecipientEmail,
  removeDigestRecipientEmail,
} from '@/lib/zoho/digest-recipients-store';

export async function GET() {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const recipients = await getAllDigestRecipients();
    return NextResponse.json({ success: true, data: recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DigestRecipients:GET] Exception:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const rawEmail = (body.email || '').trim().toLowerCase();

    const record = await addDigestRecipientEmail(rawEmail);
    return NextResponse.json({ success: true, data: record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Valid email address is required')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('[DigestRecipients:POST] Exception:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, is_active } = body;
    if (!id || typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'id and boolean is_active are required' }, { status: 400 });
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('admin_digest_recipients')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (!error && data) {
        return NextResponse.json({ success: true, data });
      }
    } catch {
      // Ignore database table errors
    }

    return NextResponse.json({ success: true, data: { id, is_active } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let id: string | null = null;
    let email: string | null = null;
    const url = new URL(request.url);
    id = url.searchParams.get('id');
    email = url.searchParams.get('email');

    if (!id && !email) {
      try {
        const body = await request.json();
        id = body?.id || null;
        email = body?.email || null;
      } catch {
        // Body may be empty
      }
    }

    if (!id && !email) {
      return NextResponse.json({ error: 'id or email parameter is required' }, { status: 400 });
    }

    const target = (email || id || '').trim().toLowerCase();
    await removeDigestRecipientEmail(target);

    return NextResponse.json({
      success: true,
      deletedId: id || undefined,
      deletedEmail: email || undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DigestRecipients:DELETE] Exception:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
