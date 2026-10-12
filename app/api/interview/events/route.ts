import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';

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
  const rawMeta = (body?.meta || {}) as Record<string, unknown>;
  const clientTs = typeof body?.ts_ms === 'number' && body.ts_ms > 0 ? body.ts_ms : undefined;
  const directOffsetSec = typeof body?.offsetSeconds === 'number' && body.offsetSeconds >= 0
    ? body.offsetSeconds
    : (typeof rawMeta.offsetSeconds === 'number' && rawMeta.offsetSeconds >= 0 ? rawMeta.offsetSeconds : undefined);

  const meta = {
    ...rawMeta,
    ...(directOffsetSec !== undefined ? { offsetSeconds: directOffsetSec } : {}),
    ...(clientTs ? { client_ts: clientTs } : {}),
  };

  if (!interviewId || !category) {
    return NextResponse.json({ error: 'interviewId and category are required' }, { status: 400 });
  }

  const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;
  const tsMs = Date.now();

  const { data: eventData, error } = await supabaseAdmin
    .from('interview_events')
    .insert({
      session_id: targetSessionId,
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
    const channel = supabaseAdmin.channel(`interview-monitor:${targetSessionId}`);
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'proctoring_event',
      payload: {
        interviewId: targetSessionId,
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

/**
 * GET /api/interview/events?interviewId=...
 *
 * Retrieves proctoring events and warnings for the given interview session.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const interviewId = searchParams.get('interviewId');

  if (!interviewId) {
    return NextResponse.json({ error: 'interviewId is required' }, { status: 400 });
  }

  const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

  const { data: events, error } = await supabaseAdmin
    .from('interview_events')
    .select('id, session_id, category, event_type, severity, confidence, snapshot_path, meta, metadata, ts_ms, created_at')
    .eq('session_id', targetSessionId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[interview-events] DB query failed:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }

  const rawEvents = events || [];
  const warningsMap = new Map<number, {
    id: string;
    count: number;
    category: string;
    reason: string;
    ts: number;
  }>();

  // Process events sorted chronologically (earliest to latest)
  const sortedEvents = [...rawEvents].sort((a, b) => {
    const aTs = a.ts_ms || (a.created_at ? new Date(a.created_at).getTime() : 0);
    const bTs = b.ts_ms || (b.created_at ? new Date(b.created_at).getTime() : 0);
    return aTs - bTs;
  });

  for (const evt of sortedEvents) {
    const metaObj = (evt.meta && typeof evt.meta === 'object' ? evt.meta : (evt.metadata && typeof evt.metadata === 'object' ? evt.metadata : {})) as Record<string, unknown>;
    const isWarning = evt.severity === 'warning' || typeof metaObj.warningCount === 'number';
    if (!isWarning) continue;

    const count = typeof metaObj.warningCount === 'number'
      ? metaObj.warningCount
      : (typeof metaObj.count === 'number' ? metaObj.count : (warningsMap.size + 1));

    const category = (evt.category || evt.event_type || 'warning') as string;
    const reason = (metaObj.reason as string) || ((evt as any).reason as string) || 'Proctoring rule violation';
    const ts = evt.ts_ms || (evt.created_at ? new Date(evt.created_at).getTime() : Date.now());

    warningsMap.set(count, {
      id: evt.id || `warn-${count}`,
      count,
      category,
      reason,
      ts,
    });
  }

  const warnings = Array.from(warningsMap.values()).sort((a, b) => a.count - b.count);

  return NextResponse.json({
    success: true,
    events: events || [],
    warnings,
    totalWarnings: warnings.length,
  });
}
