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
    { data: warnings },
    { data: answers },
  ] = await Promise.all([
    supabaseAdmin.from('interview_sessions').select('*').eq('id', id).single(),
    getInterviewReport(id),
    supabaseAdmin.from('interview_transcript').select('*').eq('session_id', id).order('ts_ms', { ascending: true }),
    supabaseAdmin.from('interview_questions').select('*').eq('session_id', id),
    supabaseAdmin.from('interview_events').select('*').eq('session_id', id).eq('severity', 'warning'),
    supabaseAdmin.from('interview_answers').select('*').eq('session_id', id),
  ]);

  if (!session) notFound();

  let report = initialReport;
  const isTerminal = session.status === 'completed' || session.status === 'terminated' || session.status === 'cancelled';
  if (!report && isTerminal) {
    try {
      const scoringResult = await scoreInterviewSession({ sessionId: id });
      report = (scoringResult.report as unknown as typeof initialReport) || null;
    } catch (err) {
      console.warn(`[admin-report] On-demand scoring failed for session ${id}:`, err);
    }
  }

  const sortedQuestions = [...(questions ?? [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  // Use authoritative session warning strike counters saved at completion/termination.
  // Fall back to event logs only if the session columns were unset.
  const rawVoiceCount =
    session.voice_warning_count !== undefined && session.voice_warning_count !== null
      ? session.voice_warning_count
      : (warnings ?? []).filter((w) => w.category === 'unauthorized_voice' || w.category === 'bg_voice' || w.category === 'background_voice').length;
  const rawFaceCount =
    session.face_warning_count !== undefined && session.face_warning_count !== null
      ? session.face_warning_count
      : (warnings ?? []).filter((w) => ['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(w.category)).length;
  const rawObjectCount =
    session.object_warning_count !== undefined && session.object_warning_count !== null
      ? session.object_warning_count
      : (warnings ?? []).filter((w) => ['object_detected', 'cell_phone', 'notes_detected'].includes(w.category)).length;

  const voiceWarningCount = Math.min(3, Math.max(0, rawVoiceCount));
  const faceWarningCount = Math.min(3, Math.max(0, rawFaceCount));
  const objectWarningCount = Math.min(3, Math.max(0, rawObjectCount));
  const totalWarnings = Math.min(3, voiceWarningCount + faceWarningCount + objectWarningCount);

  const fluencyBreakdown = report?.fluency_breakdown as Record<string, unknown> | null;
  const followUpQuestions =
    (fluencyBreakdown?.follow_up_recommendations as string[] | undefined) ??
    ((report as unknown as { follow_up_recommendations?: string[] })?.follow_up_recommendations as string[] | undefined) ??
    [];

  return (
    <ReportDetailView
      session={session}
      report={report as unknown as React.ComponentProps<typeof ReportDetailView>['report']}
      questions={sortedQuestions}
      answers={answers ?? []}
      transcript={transcript ?? []}
      voiceWarningCount={voiceWarningCount}
      faceWarningCount={faceWarningCount}
      objectWarningCount={objectWarningCount}
      totalWarnings={totalWarnings}
      followUpQuestions={followUpQuestions}
    />
  );
}
