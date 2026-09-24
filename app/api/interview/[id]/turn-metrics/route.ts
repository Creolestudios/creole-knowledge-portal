import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/[id]/turn-metrics
 *
 * Saves objective per-turn speech and audio characteristics into interview_turn_metrics.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!id || !body) {
      return NextResponse.json({ error: 'Session ID and metric payload are required.' }, { status: 400 });
    }

    const {
      questionOrd = null,
      turnIndex = 0,
      speechMs = 0,
      pauseMsTotal = 0,
      pauseCount = 0,
      wordCount = 0,
      fillerCount = 0,
      responseLatencyMs = 0,
      unauthorizedVoiceDetected = false,
      rawText = '',
    } = body;

    const { data: inserted, error } = await supabaseAdmin
      .from('interview_turn_metrics')
      .insert({
        session_id: id,
        question_ord: typeof questionOrd === 'number' ? questionOrd : null,
        turn_index: Number.isFinite(turnIndex) ? turnIndex : 0,
        speech_ms: Number.isFinite(speechMs) ? speechMs : 0,
        pause_ms_total: Number.isFinite(pauseMsTotal) ? pauseMsTotal : 0,
        pause_count: Number.isFinite(pauseCount) ? pauseCount : 0,
        word_count: Number.isFinite(wordCount) ? wordCount : 0,
        filler_count: Number.isFinite(fillerCount) ? fillerCount : 0,
        response_latency_ms: Number.isFinite(responseLatencyMs) ? responseLatencyMs : 0,
        unauthorized_voice_detected: Boolean(unauthorizedVoiceDetected),
        raw_text: typeof rawText === 'string' ? rawText : '',
      })
      .select()
      .single();

    if (error) {
      console.error('[turn-metrics] Insert error:', error.message);
      return NextResponse.json({ error: 'Failed to record turn metrics.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, metric: inserted });
  } catch (error) {
    console.error('[turn-metrics] Server error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
