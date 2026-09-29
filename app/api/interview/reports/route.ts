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

    // Fetch matching reports, violation events, and ai_interviews for all session IDs in parallel
    const sessionIds = sessions.map((s) => s.id);
    const [reportMap, { data: violationEvents }, { data: aiInterviews }] = await Promise.all([
      getInterviewReports(sessionIds),
      supabaseAdmin
        .from('interview_events')
        .select('session_id, metadata, meta')
        .in('session_id', sessionIds)
        .eq('event_type', 'proctoring_violation'),
      supabaseAdmin
        .from('ai_interviews')
        .select('id, termination_reason')
        .in('id', sessionIds),
    ]);

    const violationReasonMap = new Map<string, string>();
    for (const ev of (violationEvents || [])) {
      const meta = (ev.metadata || ev.meta) as { reason?: string } | undefined;
      if (meta?.reason && !violationReasonMap.has(ev.session_id)) {
        violationReasonMap.set(ev.session_id, meta.reason);
      }
    }
    for (const ai of (aiInterviews || [])) {
      if (ai.termination_reason && !violationReasonMap.has(ai.id)) {
        violationReasonMap.set(ai.id, ai.termination_reason);
      }
    }

    // Auto-trigger scoring in background for any completed or terminated session without a report
    for (const s of sessions) {
      const isTerminal = s.status === 'completed' || s.status === 'terminated' || s.status === 'cancelled';
      if (isTerminal && !reportMap.has(s.id)) {
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

      const rawReason = violationReasonMap.get(s.id);
      const terminationReason = isTerminated
        ? rawReason ||
          (totalWarnings >= 3
            ? `Three proctoring warnings issued. Session auto-terminated (${totalWarnings} warnings: ${voiceWarnings} voice, ${faceWarnings} face, ${objectWarnings} object).`
            : 'Interview terminated due to continuous proctoring violations.')
        : null;

      // Provide clear recommendation even if background scoring hadn't run for a terminated session
      const recommendation =
        report?.recommendation ?? (isTerminated ? 'no' : null);

      const recommendationRationale =
        report?.recommendation_rationale ??
        (isTerminated
          ? terminationReason || `Interview terminated due to proctoring violation (${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}).`
          : null);

      const flags = report?.flags ?? (isTerminated ? ['interview_terminated'] : []);

      // Check if candidate actually spoke or answered anything
      const summaryText = (report?.fluency_breakdown as { summary?: string } | undefined)?.summary || '';
      const noAnswersGiven =
        summaryText.toLowerCase().includes('no candidate speech') ||
        summaryText.toLowerCase().includes('no answers were submitted') ||
        (Array.isArray(report?.competency_scores) &&
          report.competency_scores.length > 0 &&
          report.competency_scores.every((cs: { justification?: string }) =>
            (cs?.justification || '').toLowerCase().includes('provided no answer') ||
            (cs?.justification || '').toLowerCase().includes('no answer')
          ));

      const cognitiveScore = noAnswersGiven ? 0 : (report?.cognitive_composite ?? 0);
      const fluencyScore = noAnswersGiven ? 0 : (report?.fluency_score ?? 0);
      const fluencyCefr = noAnswersGiven ? null : (report?.fluency_cefr ?? null);

      return {
        id: s.id,
        candidateName: s.candidate_name ?? 'Unknown Candidate',
        candidateEmail: s.candidate_email ?? null,
        jobTitle,
        status: normalizedStatus,
        completedAt: s.updated_at ?? s.created_at,
        // Scores
        cognitiveScore,
        fluencyScore,
        fluencyCefr,
        terminationReason,
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
