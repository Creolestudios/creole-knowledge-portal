import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { extractKeywordsFromResumeAndJD } from '@/lib/ai-interview/extractor';
import { getSessionOrError } from '@/lib/ai-interview/session-utils';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { session, errorResponse } = await getSessionOrError(id);
    if (errorResponse || !session) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const resumeText =
      body.resumeText || session.parsed_resume?.summary || 'Standard Software Developer resume content';
    const jdText =
      body.jdText ||
      (Array.isArray(session.parsed_jd?.keyResponsibilities)
        ? session.parsed_jd.keyResponsibilities.join('\n')
        : 'Software Engineer job description requiring core technical skills');

    const extraction = await extractKeywordsFromResumeAndJD({
      resumeText,
      jdText,
    });

    const expYears = extraction.candidateProfile.yearsOfExperience || 0;
    const experience_level =
      expYears >= 7 ? 'senior' : expYears >= 3 ? 'mid' : 'junior';

    const { data: updatedSession, error: updateErr } = await supabaseAdmin
      .from('interview_sessions')
      .update({
        parsed_resume: extraction.candidateProfile,
        parsed_jd: extraction.jdRequirements,
        skill_gap: extraction.analysis,
        experience_level,
        status: 'parsed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      session: updatedSession,
      extraction,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
