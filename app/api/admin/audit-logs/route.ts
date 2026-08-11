import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuditLogs } from '@/lib/data/db';

const ADMIN_EMAIL = 'priya.dhanani@creolestudios.com';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const logs = await getAuditLogs();

    // Sort by timestamp descending (most recent first)
    const sorted = logs.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({ auditLogs: sorted });
  } catch (error: any) {
    console.error('Error in GET /api/admin/audit-logs:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
