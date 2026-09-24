import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/[id]/transcript
 *
 * Real-time endpoint to persist speech utterances (from candidate, platform AI, or unauthorized voices).
 * Broadcasts each line via Supabase Realtime to the HR live monitoring channel.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!id || !body || typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'Valid session ID and text are required.' }, { status: 400 });
    }

    const speaker = ['ai', 'candidate', 'unauthorized_voice'].includes(body.speaker)
      ? body.speaker
      : 'candidate';

    const questionOrd = typeof body.questionOrd === 'number' ? body.questionOrd : null;
    const tsMs = typeof body.tsMs === 'number' ? body.tsMs : Date.now();
    const isFlagged = Boolean(body.isFlagged || speaker === 'unauthorized_voice');

    const { data: inserted, error } = await supabaseAdmin
      .from('interview_transcript')
      .insert({
        session_id: id,
        question_ord: questionOrd,
        speaker,
        text: body.text.trim(),
        ts_ms: tsMs,
        is_flagged: isFlagged,
      })
      .select()
      .single();

    if (error) {
      console.error('[interview-transcript] DB insert error:', error.message);
      return NextResponse.json({ error: 'Failed to record transcript line.' }, { status: 500 });
    }

    // Broadcast in real-time to HR monitoring dashboard
    try {
      const channel = supabaseAdmin.channel(`interview-monitor:${id}`);
      await channel.send({
        type: 'broadcast',
        event: 'transcript_line',
        payload: {
          id: inserted.id,
          sessionId: id,
          questionOrd,
          speaker,
          text: body.text.trim(),
          tsMs,
          isFlagged,
          createdAt: inserted.created_at,
        },
      });
    } catch (broadcastErr) {
      console.warn('[interview-transcript] Realtime broadcast warning:', broadcastErr);
    }

    return NextResponse.json({ ok: true, line: inserted });
  } catch (error) {
    console.error('[interview-transcript] Server error:', error);
    return NextResponse.json({ error: 'Failed to process transcript.' }, { status: 500 });
  }
}

/**
 * GET /api/interview/[id]/transcript
 *
 * Retrieves the full chronological transcript for an interview session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: transcript, error } = await supabaseAdmin
      .from('interview_transcript')
      .select('*')
      .eq('session_id', id)
      .order('ts_ms', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ transcript: transcript || [] });
  } catch (error) {
    console.error('[interview-transcript] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch transcript.' }, { status: 500 });
  }
}
