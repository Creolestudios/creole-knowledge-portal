import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getInterviewReports } from '@/lib/ai-interview/report-store';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

export const runtime = 'nodejs';

/**
 * GET /api/interview/reports
 *
 * Returns all interviews that have reached a terminal state (completed or
 * terminated) joined with their scoring report. This drives the HR Reports
 * list page so non-technical reviewers can see every candidate at a glance.
 */
export async function GET() {
  try {
    // Fetch all interview sessions so HR sees all candidate attempts
    const { data: sessions, error: sessErr } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, voice_warning_count, face_warning_count, object_warning_count')
      .order('updated_at', { ascending: false });

    if (sessErr) {
      return NextResponse.json({ error: sessErr.message }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ reports: [] });
    }

    // Fetch matching reports for all session IDs in one query (checks table + fallback event store)
    const sessionIds = sessions.map((s) => s.id);
    const reportMap = await getInterviewReports(sessionIds);

    // Auto-trigger scoring in background for any completed session without a report
    for (const s of sessions) {
      if (s.status === 'completed' && !reportMap.has(s.id)) {
        scoreInterviewSession({ sessionId: s.id }).catch((err) => {
          console.warn(`[interview-reports] Background auto-score for ${s.id} failed:`, err);
        });
      }
    }

    const merged = sessions.map((s) => {
      const report = reportMap.get(s.id) ?? null;
      const jobTitle =
        (s.parsed_jd as { jobTitle?: string } | null)?.jobTitle ?? null;

      // Normalize status: 'cancelled' in assess is an integrity termination
      const rawStatus = s.status || 'in_progress';
      const isTerminated = rawStatus === 'terminated' || rawStatus === 'cancelled';
      const normalizedStatus: 'completed' | 'terminated' | 'in_progress' =
        rawStatus === 'completed' ? 'completed' : isTerminated ? 'terminated' : 'in_progress';

      const voiceWarnings = s.voice_warning_count ?? 0;
      const faceWarnings = s.face_warning_count ?? 0;
      const objectWarnings = s.object_warning_count ?? 0;
      const totalWarnings = voiceWarnings + faceWarnings + objectWarnings;

      // Provide clear recommendation even if background scoring hadn't run for a terminated session
      const recommendation =
        report?.recommendation ?? (isTerminated ? 'no' : null);

      const recommendationRationale =
        report?.recommendation_rationale ??
        (isTerminated
          ? `Interview terminated due to proctoring violation (${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}).`
          : null);

      const flags = report?.flags ?? (isTerminated ? ['interview_terminated'] : []);

      return {
        id: s.id,
        candidateName: s.candidate_name ?? 'Unknown Candidate',
        candidateEmail: s.candidate_email ?? null,
        jobTitle,
        status: normalizedStatus,
        completedAt: s.updated_at ?? s.created_at,
        // Scores
        cognitiveScore: report?.cognitive_composite ?? null,
        fluencyScore: report?.fluency_score ?? null,
        fluencyCefr: report?.fluency_cefr ?? null,
        recommendation,
        recommendationRationale,
        flags,
        // Warning counts
        voiceWarnings,
        faceWarnings,
        objectWarnings,
        // Whether a scoring report exists or is resolved
        hasReport: report !== null || isTerminated,
      };
    });

    return NextResponse.json({ reports: merged });
  } catch (err) {
    console.error('[interview-reports] GET error:', err);
    return NextResponse.json({ error: 'Failed to load reports.' }, { status: 500 });
  }
}
