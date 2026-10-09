import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getInterviewReports } from '@/lib/ai-interview/report-store';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

export const runtime = 'nodejs';

/**
 * GET /api/interview/reports
 *
 * Returns all interviews joined with their scoring report.
 * Status is derived from BOTH session.status and invite.status to handle
 * all the real-world status values in the DB.
 */
export async function GET(request: Request) {
  try {
    const url = request?.url ? new URL(request.url) : null;
    const pageParam = Number(url?.searchParams.get('page'));
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const limitParam = Number(url?.searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(100, Math.floor(limitParam)) : 10;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Fetch paginated interview sessions
    let sessionsQuery = supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, voice_warning_count, face_warning_count, object_warning_count', { count: 'exact' })
      .order('updated_at', { ascending: false });

    if (typeof (sessionsQuery as unknown as { range: unknown }).range === 'function') {
      sessionsQuery = (sessionsQuery as unknown as { range: (from: number, to: number) => typeof sessionsQuery }).range(from, to);
    }

    const { data: sessions, error: sessErr, count } = await sessionsQuery;

    if (sessErr) {
      return NextResponse.json({ error: sessErr.message }, { status: 500 });
    }

    const totalSessions = count ?? (sessions?.length ?? 0);

    // Compute summary stats across all sessions
    let stats = {
      total: totalSessions,
      completed: 0,
      terminated: 0,
      avgCognitive: null as number | null,
    };

    try {
      const [
        completedRes,
        cancelledRes,
        terminatedRes,
        avgScoresRes,
      ] = await Promise.all([
        supabaseAdmin.from('interview_sessions').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        supabaseAdmin.from('interview_sessions').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
        supabaseAdmin.from('interview_sessions').select('*', { count: 'exact', head: true }).eq('status', 'terminated'),
        supabaseAdmin.from('interview_reports').select('cognitive_composite'),
      ]);

      const compCount = completedRes?.count ?? 0;
      const cancCount = cancelledRes?.count ?? 0;
      const termCount = terminatedRes?.count ?? 0;
      const repScores = avgScoresRes?.data;

      let avgCog: number | null = null;
      if (Array.isArray(repScores) && repScores.length > 0) {
        const validScores = repScores
          .map((r: { cognitive_composite?: number | null }) => r?.cognitive_composite)
          .filter((s): s is number => typeof s === 'number' && !Number.isNaN(s));
        if (validScores.length > 0) {
          avgCog = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length);
        }
      }

      stats = {
        total: totalSessions,
        completed: compCount,
        terminated: cancCount + termCount,
        avgCognitive: avgCog,
      };
    } catch {
      const completedOnPage = (sessions || []).filter((s) => s.status === 'completed').length;
      const terminatedOnPage = (sessions || []).filter((s) => s.status === 'cancelled' || s.status === 'terminated').length;
      stats = {
        total: totalSessions,
        completed: completedOnPage,
        terminated: terminatedOnPage,
        avgCognitive: null,
      };
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        reports: [],
        pagination: {
          page,
          limit,
          total: stats.total,
          totalPages: Math.max(1, Math.ceil(stats.total / limit)),
        },
        stats,
      });
    }

    const sessionIds = sessions.map((s) => s.id);

    // Fetch reports, invite statuses, violation events, warning events, and recording events in parallel
    const [
      reportMap,
      { data: invites },
      { data: violationEvents },
      { data: warningEvents },
      { data: recordingEvents },
    ] = await Promise.all([
      getInterviewReports(sessionIds),
      supabaseAdmin
        .from('interview_invites')
        .select('session_id, status')
        .in('session_id', sessionIds),
      // Proctoring violations for termination reason
      supabaseAdmin
        .from('interview_events')
        .select('session_id, metadata, meta')
        .in('session_id', sessionIds)
        .eq('event_type', 'proctoring_violation')
        .order('created_at', { ascending: false }),
      // Warning events for fallback counts
      supabaseAdmin
        .from('interview_events')
        .select('session_id, category, severity, event_type')
        .in('session_id', sessionIds)
        .eq('severity', 'warning'),
      // Recording events for full video link in Google Drive
      supabaseAdmin
        .from('interview_events')
        .select('session_id, metadata, meta')
        .in('session_id', sessionIds)
        .eq('event_type', 'full_recording')
        .order('created_at', { ascending: false }),
    ]);

    // Build invite status map (session_id → invite status)
    const inviteStatusMap = new Map<string, string>();
    for (const inv of (invites || [])) {
      if (inv.session_id && !inviteStatusMap.has(inv.session_id)) {
        inviteStatusMap.set(inv.session_id, inv.status || 'active');
      }
    }

    // Build violation reason map (session_id → first reason)
    const violationReasonMap = new Map<string, string>();
    for (const ev of (violationEvents || [])) {
      if (!violationReasonMap.has(ev.session_id)) {
        const meta = (ev.metadata || ev.meta) as { reason?: string } | undefined;
        if (meta?.reason) {
          violationReasonMap.set(ev.session_id, meta.reason);
        }
      }
    }

    // Build warning counts by category per session (fallback when session columns are null)
    const warningCountMap = new Map<string, { voice: number; face: number; object: number }>();
    for (const ev of (warningEvents || [])) {
      if (!warningCountMap.has(ev.session_id)) {
        warningCountMap.set(ev.session_id, { voice: 0, face: 0, object: 0 });
      }
      const counts = warningCountMap.get(ev.session_id)!;
      const cat = ev.category || ev.event_type || '';
      if (cat === 'unauthorized_voice' || cat === 'bg_voice' || cat === 'background_voice') counts.voice++;
      else if (['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(cat)) counts.face++;
      else if (['object_detected', 'cell_phone', 'notes_detected'].includes(cat)) counts.object++;
    }

    // Build recording map (session_id → recording links in Google Drive)
    const recordingMap = new Map<string, { webViewLink: string; previewUrl: string; fileId: string; fileName?: string }>();
    for (const ev of (recordingEvents || [])) {
      if (!recordingMap.has(ev.session_id)) {
        const meta = (ev.metadata || ev.meta) as Record<string, unknown> | undefined;
        if (meta?.fileId || meta?.webViewLink) {
          const fileId = String(meta.fileId || '');
          const webViewLink = (meta.webViewLink as string) || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '');
          const previewUrl = (meta.previewUrl as string) || (fileId ? `https://drive.google.com/file/d/${fileId}/preview` : '');
          if (webViewLink) {
            recordingMap.set(ev.session_id, {
              fileId,
              webViewLink,
              previewUrl,
              fileName: meta.fileName as string | undefined,
            });
          }
        }
      }
    }

    // Auto-trigger scoring in background for unscored terminal sessions
    const scoringSessionIds = new Set<string>();
    for (const s of sessions) {
      const invStatus = inviteStatusMap.get(s.id) || '';
      const isTerminal =
        s.status === 'completed' ||
        s.status === 'cancelled' ||
        s.status === 'terminated' ||
        invStatus === 'completed' ||
        invStatus === 'revoked';

      if (isTerminal && !reportMap.has(s.id) && !scoringSessionIds.has(s.id)) {
        scoringSessionIds.add(s.id);
        scoreInterviewSession({ sessionId: s.id }).catch((err) => {
          console.warn(`[interview-reports] Auto-score for ${s.id} failed:`, err);
        });
      }
    }

    const merged = sessions.map((s) => {
      const report = reportMap.get(s.id) ?? null;
      const jobTitle = (s.parsed_jd as { jobTitle?: string } | null)?.jobTitle ?? null;
      const invStatus = inviteStatusMap.get(s.id) || '';

      // ── Normalize status ────────────────────────────────────────────
      // Session statuses in DB: 'completed', 'cancelled', 'in_progress',
      //   'questions_generated', 'invite_issued', 'draft'
      // Invite statuses: 'completed', 'revoked', 'active', 'in_progress'
      const rawStatus = s.status || 'draft';
      const isTerminated =
        rawStatus === 'cancelled' ||
        rawStatus === 'terminated' ||
        invStatus === 'revoked';
      const isCompleted =
        rawStatus === 'completed' ||
        invStatus === 'completed' ||
        (!isTerminated && Boolean(report?.recommendation));

      const normalizedStatus: 'completed' | 'terminated' | 'in_progress' =
        isTerminated ? 'terminated'
        : isCompleted ? 'completed'
        : 'in_progress';

      // ── Warning counts ──────────────────────────────────────────────
      const fallbackCounts = warningCountMap.get(s.id) ?? { voice: 0, face: 0, object: 0 };
      const voiceWarnings = Math.min(3, Math.max(s.voice_warning_count ?? 0, fallbackCounts.voice));
      const faceWarnings = Math.min(3, Math.max(s.face_warning_count ?? 0, fallbackCounts.face));
      const objectWarnings = Math.min(3, Math.max(s.object_warning_count ?? 0, fallbackCounts.object));
      const totalWarnings = Math.min(3, voiceWarnings + faceWarnings + objectWarnings);

      // ── Termination reason ──────────────────────────────────────────
      const rawReason = violationReasonMap.get(s.id);
      const terminationReason = isTerminated
        ? rawReason ||
          (totalWarnings >= 3
            ? `Three proctoring warnings issued. Session auto-terminated (${totalWarnings} warnings: ${voiceWarnings} voice, ${faceWarnings} face, ${objectWarnings} object).`
            : 'Interview terminated due to proctoring violation.')
        : null;

      // ── Recommendation ──────────────────────────────────────────────
      const recommendation = report?.recommendation ?? (isTerminated ? 'no' : null);
      const recommendationRationale =
        report?.recommendation_rationale ??
        (isTerminated
          ? terminationReason || `Terminated due to proctoring violation (${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}).`
          : null);

      const flags = report?.flags ?? (isTerminated ? ['interview_terminated'] : []);

      // ── Scores ──────────────────────────────────────────────────────
      const summaryText = (report?.fluency_breakdown as { summary?: string } | undefined)?.summary || '';
      const noAnswersGiven =
        summaryText.toLowerCase().includes('no candidate speech') ||
        summaryText.toLowerCase().includes('no answers were submitted') ||
        (Array.isArray(report?.competency_scores) &&
          report.competency_scores.length > 0 &&
          (report.competency_scores as unknown[]).every((cs) => {
            const justification = (cs as { justification?: string })?.justification || '';
            return justification.toLowerCase().includes('provided no answer') ||
              justification.toLowerCase().includes('no answer');
          }));

      const cognitiveScore = noAnswersGiven ? 0 : (report?.cognitive_composite ?? (isTerminated ? 0 : null));
      const fluencyScore = noAnswersGiven ? 0 : (report?.fluency_score ?? (isTerminated ? 0 : null));
      const fluencyCefr = noAnswersGiven ? null : (report?.fluency_cefr ?? null);

      return {
        id: s.id,
        candidateName: s.candidate_name ?? 'Unknown Candidate',
        candidateEmail: s.candidate_email ?? null,
        jobTitle,
        status: normalizedStatus,
        completedAt: s.updated_at ?? s.created_at,
        cognitiveScore,
        fluencyScore,
        fluencyCefr,
        terminationReason,
        recommendation,
        recommendationRationale,
        flags,
        voiceWarnings,
        faceWarnings,
        objectWarnings,
        // hasReport: true if report data exists OR session is terminated (shows 0/no score and violation report)
        hasReport: report !== null || isTerminated,
        // Google Drive Full Video recording link
        recordingLink: recordingMap.get(s.id)?.webViewLink || null,
        recordingPreviewUrl: recordingMap.get(s.id)?.previewUrl || null,
        recordingFileId: recordingMap.get(s.id)?.fileId || null,
        hasRecording: recordingMap.has(s.id),
      };
    });

    return NextResponse.json({
      reports: merged,
      pagination: {
        page,
        limit,
        total: stats.total,
        totalPages: Math.max(1, Math.ceil(stats.total / limit)),
      },
      stats,
    });
  } catch (err) {
    console.error('[interview-reports] GET error:', err);
    return NextResponse.json({ error: 'Failed to load reports.' }, { status: 500 });
  }
}
