import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ReportDetailView } from '@/components/ai-interview/report-detail-view';
import { getInterviewReport } from '@/lib/ai-interview/report-store';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminInterviewReportPage({ params }: PageProps) {
  const { id } = await params;

  const [
    { data: session },
    initialReport,
    { data: transcript },
    { data: questions },
    { data: warningEvents },
    { data: answers },
    { data: invite },
  ] = await Promise.all([
    supabaseAdmin
      .from('interview_sessions')
      // NOTE: interview_sessions does NOT have termination_reason column — use interview_events
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, voice_warning_count, face_warning_count, object_warning_count')
      .eq('id', id)
      .single(),
    getInterviewReport(id),
    supabaseAdmin
      .from('interview_transcript')
      .select('*')
      .eq('session_id', id)
      .order('ts_ms', { ascending: true }),
    supabaseAdmin
      .from('interview_questions')
      .select('*')
      .eq('session_id', id),
    // All events for warnings AND termination reason
    supabaseAdmin
      .from('interview_events')
      .select('id, session_id, event_type, category, severity, snapshot_path, metadata, meta, created_at, ts_ms')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('interview_answers')
      .select('*')
      .eq('session_id', id),
    // Invite status to determine true session state
    supabaseAdmin
      .from('interview_invites')
      .select('id, status')
      .eq('session_id', id)
      .maybeSingle(),
  ]);

  if (!session) notFound();

  // ── Derive true terminal state from both session + invite ──────────
  const inviteStatus = invite?.status || '';
  const rawStatus = session.status || 'draft';
  const isTerminated =
    rawStatus === 'cancelled' ||
    rawStatus === 'terminated' ||
    inviteStatus === 'revoked';
  const isTerminal =
    isTerminated ||
    rawStatus === 'completed' ||
    inviteStatus === 'completed';

  // ── Auto-score for ALL session statuses if no existing report ──────
  let report = initialReport;
  if (!report) {
    try {
      const scoringResult = await scoreInterviewSession({ sessionId: id });
      report = (scoringResult.report as unknown as typeof initialReport) || null;
    } catch (err) {
      console.warn(`[admin-report] On-demand scoring failed for session ${id}:`, err);
    }
  }

  // ── Sort questions by order ────────────────────────────────────────
  const sortedQuestions = [...(questions ?? [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  // ── Warning counts & detailed proctoring events ───────────────────
  const allEvents = warningEvents ?? [];
  const warnEvents = allEvents.filter(
    (e) =>
      e.severity === 'warning' ||
      e.severity === 'critical' ||
      e.severity === 'error' ||
      [
        'unauthorized_voice',
        'bg_voice',
        'background_voice',
        'gaze_away',
        'no_face',
        'multi_face',
        'reading_suspected',
        'object_detected',
        'object',
        'cell_phone',
        'notes_detected',
        'proctoring_violation',
      ].includes(e.category || e.event_type)
  );

  const voiceEvents = warnEvents.filter((w) =>
    ['unauthorized_voice', 'bg_voice', 'background_voice'].includes(w.category || w.event_type)
  );
  const faceEvents = warnEvents.filter((w) =>
    ['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(w.category || w.event_type)
  );
  const objectEvents = warnEvents.filter((w) =>
    ['object_detected', 'object', 'cell_phone', 'notes_detected'].includes(w.category || w.event_type)
  );

  const rawVoiceCount = Math.max(session.voice_warning_count ?? 0, voiceEvents.length);
  const rawFaceCount = Math.max(session.face_warning_count ?? 0, faceEvents.length);
  const rawObjectCount = Math.max(session.object_warning_count ?? 0, objectEvents.length);

  const voiceWarningCount = Math.min(3, Math.max(0, rawVoiceCount));
  const faceWarningCount = Math.min(3, Math.max(0, rawFaceCount));
  const objectWarningCount = Math.min(3, Math.max(0, rawObjectCount));
  const totalWarnings = Math.min(3, voiceWarningCount + faceWarningCount + objectWarningCount);

  // Extract structured list of warning incidents with reasons and timestamps
  const proctoringWarnings = warnEvents
    .filter((w) => w.event_type !== 'scoring_report')
    .map((w, index) => {
      const meta = (w.metadata || w.meta || {}) as Record<string, unknown>;
      const reason =
        (meta.reason as string) ||
        (w.event_type ? w.event_type.replaceAll('_', ' ') : 'Proctoring violation');
      const cat = w.category || w.event_type || '';
      let category: 'voice' | 'face' | 'object' | 'general' = 'general';
      let categoryLabel = 'Proctoring Alert';
      if (['unauthorized_voice', 'bg_voice', 'background_voice'].includes(cat)) {
        category = 'voice';
        categoryLabel = 'Voice / Audio Violation';
      } else if (['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(cat)) {
        category = 'face';
        categoryLabel = 'Face / Gaze Violation';
      } else if (['object_detected', 'object', 'cell_phone', 'notes_detected'].includes(cat)) {
        category = 'object';
        categoryLabel = 'Object / Phone Violation';
      }

      const strikeNum = (meta.warningCount as number) || index + 1;

      return {
        id: w.id,
        strikeNumber: Math.min(3, strikeNum),
        category,
        categoryLabel,
        reason,
        timestamp: w.created_at
          ? new Date(w.created_at).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : undefined,
        severity: w.severity || 'warning',
        snapshotPath: w.snapshot_path || null,
      };
    });

  // ── Termination reason from proctoring_violation events ───────────
  const violationEvent = allEvents.find((e) => e.event_type === 'proctoring_violation');
  const violationMeta = (violationEvent?.metadata || violationEvent?.meta) as { reason?: string } | undefined;
  const terminationReason = isTerminated
    ? (violationMeta?.reason ??
       (proctoringWarnings.length > 0
         ? `Terminated due to proctoring violation (${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}: ${proctoringWarnings[proctoringWarnings.length - 1]?.reason || 'Integrity rules breached'}).`
         : `Terminated due to proctoring violation (${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}).`))
    : null;

  // ── Inject terminationReason into session object for the view ─────
  const sessionWithReason = {
    ...session,
    termination_reason: terminationReason,
    // Also expose invite status so the view can use the correct status label
    invite_status: inviteStatus,
  };

  // ── Follow-up questions from fluency_breakdown ─────────────────────
  const fluencyBreakdown = report?.fluency_breakdown as {
    follow_up_recommendations?: string[];
    [key: string]: unknown;
  } | null;
  const followUpQuestions: string[] =
    (Array.isArray(fluencyBreakdown?.follow_up_recommendations)
      ? fluencyBreakdown!.follow_up_recommendations
      : null) ??
    ((report as unknown as { follow_up_recommendations?: string[] })?.follow_up_recommendations ?? []);

  // ── Google Drive Recording Event ──────────────────────────────────
  const recordingEvent = allEvents.find(
    (e) => e.category === 'full_recording' || e.event_type === 'full_recording'
  );
  const recMeta = (recordingEvent?.meta || recordingEvent?.metadata || {}) as Record<string, unknown>;
  const recording = recMeta.fileId
    ? {
        fileId: String(recMeta.fileId),
        webViewLink: (recMeta.webViewLink as string) || `https://drive.google.com/file/d/${recMeta.fileId}/view`,
        previewUrl: (recMeta.previewUrl as string) || `https://drive.google.com/file/d/${recMeta.fileId}/preview`,
        fileName: recMeta.fileName as string | undefined,
      }
    : null;

  return (
    <ReportDetailView
      session={sessionWithReason as unknown as React.ComponentProps<typeof ReportDetailView>['session']}
      recording={recording}
      report={report as unknown as React.ComponentProps<typeof ReportDetailView>['report']}
      questions={sortedQuestions}
      answers={answers ?? []}
      transcript={transcript ?? []}
      voiceWarningCount={voiceWarningCount}
      faceWarningCount={faceWarningCount}
      objectWarningCount={objectWarningCount}
      totalWarnings={totalWarnings}
      proctoringWarnings={proctoringWarnings}
      followUpQuestions={followUpQuestions}
    />
  );
}
