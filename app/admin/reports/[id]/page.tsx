import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ReportDetailView } from '@/components/ai-interview/report-detail-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminInterviewReportPage({ params }: PageProps) {
  const { id } = await params;

  const [
    { data: session },
    { data: report },
    { data: transcript },
    { data: questions },
    { data: warnings },
    { data: answers },
  ] = await Promise.all([
    supabaseAdmin.from('interview_sessions').select('*').eq('id', id).single(),
    supabaseAdmin.from('interview_reports').select('*').eq('session_id', id).maybeSingle(),
    supabaseAdmin.from('interview_transcript').select('*').eq('session_id', id).order('ts_ms', { ascending: true }),
    supabaseAdmin.from('interview_questions').select('*').eq('session_id', id),
    supabaseAdmin.from('interview_events').select('*').eq('session_id', id).eq('severity', 'warning'),
    supabaseAdmin.from('interview_answers').select('*').eq('session_id', id),
  ]);

  if (!session) notFound();

  const sortedQuestions = [...(questions ?? [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  const voiceWarningCount =
    (session.voice_warning_count ?? 0) +
    (warnings ?? []).filter((w) => w.category === 'unauthorized_voice' || w.category === 'bg_voice').length;
  const faceWarningCount = session.face_warning_count ?? 0;
  const objectWarningCount = session.object_warning_count ?? 0;
  const totalWarnings = voiceWarningCount + faceWarningCount + objectWarningCount;

  const fluencyBreakdown = report?.fluency_breakdown as Record<string, unknown> | null;
  const followUpQuestions =
    (fluencyBreakdown?.follow_up_recommendations as string[] | undefined) ??
    ((report as unknown as { follow_up_recommendations?: string[] })?.follow_up_recommendations as string[] | undefined) ??
    [];

  return (
    <ReportDetailView
      session={session}
      report={report}
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
