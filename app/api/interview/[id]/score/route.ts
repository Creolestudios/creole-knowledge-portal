import { NextRequest, NextResponse } from 'next/server';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';

export const runtime = 'nodejs';
export const maxDuration = 60; // Allow sufficient time for LLM evaluation

/**
 * POST /api/interview/[id]/score
 *
 * Runs the post-interview scoring pass:
 * 1. Isolates candidate speech from interview_transcript.
 * 2. Computes objective speech characteristics (WPM, pause rates, fillers).
 * 3. Evaluates competencies & English fluency (CEFR) via Gemini Flash.
 * 4. Persists the score to interview_reports.
 * 5. Marks interview session and invite status as 'completed'.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Session ID is required.' }, { status: 400 });
    }

    const targetSessionId = (await resolveInterviewSessionId(id)) || id;
    const now = new Date().toISOString();

    await Promise.all([
      supabaseAdmin
        .from('interview_sessions')
        .update({ status: 'completed', updated_at: now })
        .eq('id', targetSessionId),
      supabaseAdmin
        .from('interview_invites')
        .update({ status: 'completed', completed_at: now })
        .eq('session_id', targetSessionId),
      supabaseAdmin
        .from('ai_interviews')
        .update({ status: 'completed' })
        .eq('id', targetSessionId),
    ]).catch((err) => console.warn('[interview-score] Status update warning:', err));

    const result = await scoreInterviewSession({ sessionId: targetSessionId });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[interview-score] Scoring failed:', error);
    const message = error instanceof Error ? error.message : 'Scoring engine failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
