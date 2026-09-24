import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

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
    // Fetch all sessions that are done (completed or terminated)
    const { data: sessions, error: sessErr } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, voice_warning_count, face_warning_count, object_warning_count')
      .in('status', ['completed', 'terminated'])
      .order('updated_at', { ascending: false });

    if (sessErr) {
      return NextResponse.json({ error: sessErr.message }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ reports: [] });
    }

    // Fetch matching reports for all session IDs in one query
    const sessionIds = sessions.map((s) => s.id);
    const { data: reports } = await supabaseAdmin
      .from('interview_reports')
      .select('session_id, cognitive_composite, fluency_score, fluency_cefr, recommendation, recommendation_rationale, flags, competency_scores, rubric_version')
      .in('session_id', sessionIds);

    const reportMap = new Map((reports || []).map((r) => [r.session_id, r]));

    const merged = sessions.map((s) => {
      const report = reportMap.get(s.id) ?? null;
      const jobTitle =
        (s.parsed_jd as { jobTitle?: string } | null)?.jobTitle ?? null;

      return {
        id: s.id,
        candidateName: s.candidate_name ?? 'Unknown Candidate',
        candidateEmail: s.candidate_email ?? null,
        jobTitle,
        status: s.status as 'completed' | 'terminated',
        completedAt: s.updated_at ?? s.created_at,
        // Scores
        cognitiveScore: report?.cognitive_composite ?? null,
        fluencyScore: report?.fluency_score ?? null,
        fluencyCefr: report?.fluency_cefr ?? null,
        recommendation: report?.recommendation ?? null,
        recommendationRationale: report?.recommendation_rationale ?? null,
        flags: report?.flags ?? [],
        // Warning counts
        voiceWarnings: s.voice_warning_count ?? 0,
        faceWarnings: s.face_warning_count ?? 0,
        objectWarnings: s.object_warning_count ?? 0,
        // Whether a scoring report exists yet
        hasReport: report !== null,
      };
    });

    return NextResponse.json({ reports: merged });
  } catch (err) {
    console.error('[interview-reports] GET error:', err);
    return NextResponse.json({ error: 'Failed to load reports.' }, { status: 500 });
  }
}
