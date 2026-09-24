import { NextRequest, NextResponse } from 'next/server';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

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

    const result = await scoreInterviewSession({ sessionId: id });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[interview-score] Scoring failed:', error);
    const message = error instanceof Error ? error.message : 'Scoring engine failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
