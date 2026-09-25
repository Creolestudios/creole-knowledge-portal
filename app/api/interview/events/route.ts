import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/events
 *
 * Public endpoint. Logs real-time proctoring events (gaze_away, reading_suspected, no_face, multi_face, etc.)
 * into the interview_events table and broadcasts via Supabase Realtime to the HR monitoring dashboard.
 *
 * Body: { interviewId: string, category: string, severity?: string, confidence?: number, snapshotPath?: string, meta?: Record<string, unknown> }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const category = body?.category as string | undefined;
  const rawSeverity = (body?.severity as string) || 'warning';
  const severity = rawSeverity === 'error' ? 'warning' : rawSeverity;
  const confidence = typeof body?.confidence === 'number' ? body.confidence : 1.0;
  const snapshotPath = body?.snapshotPath as string | undefined;
  const meta = body?.meta || {};

  if (!interviewId || !category) {
    return NextResponse.json({ error: 'interviewId and category are required' }, { status: 400 });
  }

  const tsMs = Date.now();

  const { data: eventData, error } = await supabaseAdmin
    .from('interview_events')
    .insert({
      session_id: interviewId,
      // Columns from 20260918120000 migration (event_type / metadata)
      event_type: category,
      metadata: meta,
      // Columns from 20260918000000 + 20260923000000 migration (category / meta / ts_ms etc.)
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
    console.error('[interview-events] DB insert failed:', error);
  }

  // Supabase Realtime broadcast to HR live monitoring channel
  try {
    const channel = supabaseAdmin.channel(`interview-monitor:${interviewId}`);
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'proctoring_event',
      payload: {
        interviewId,
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
    console.warn('[interview-events] Realtime broadcast warning:', rtErr);
  }

  return NextResponse.json({ success: true, event: eventData });
}
