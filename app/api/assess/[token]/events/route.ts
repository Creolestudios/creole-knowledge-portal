import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/events
 *
 * Public endpoint. Logs real-time proctoring events from the candidate-facing
 * /assess/[token] page into interview_events and broadcasts via Supabase
 * Realtime to the HR monitoring dashboard.
 *
 * Body: { category: string, severity?: string, confidence?: number, snapshotPath?: string, meta?: Record<string, unknown> }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);

  const category = body?.category as string | undefined;
  const rawSeverity = (body?.severity as string) || 'warning';
  const severity = rawSeverity === 'error' ? 'warning' : rawSeverity;
  const confidence = typeof body?.confidence === 'number' ? body.confidence : 1.0;
  const snapshotPath = body?.snapshotPath as string | undefined;
  const meta = body?.meta || {};

  if (!category) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 });
  }

  // Resolve session_id from invite token (don't block on expired status for event logging)
  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  const tsMs = Date.now();

  const { data: eventData, error } = await supabaseAdmin
    .from('interview_events')
    .insert({
      session_id: invite.session_id,
      // Columns from 20260918120000 migration (event_type / metadata)
      event_type: category,
      metadata: meta,
      // Columns from 20260923000000 migration (category / meta / ts_ms etc.)
      ts_ms: tsMs,
      category,
      severity,
      confidence,
      snapshot_path: snapshotPath || null,
      meta,
    })
    .select()
    .single();

  if (error) {
    console.error('[assess-events] DB insert failed:', error);
  }

  // Supabase Realtime broadcast to HR live monitoring channel
  try {
    const channel = supabaseAdmin.channel(`interview-monitor:${invite.session_id}`);
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'proctoring_event',
      payload: {
        sessionId: invite.session_id,
        category,
        severity,
        confidence,
        snapshotPath,
        meta,
        tsMs,
      },
    });
    await supabaseAdmin.removeChannel(channel);
  } catch (rtErr) {
    console.warn('[assess-events] Realtime broadcast warning:', rtErr);
  }

  return NextResponse.json({ success: true, event: eventData });
}
