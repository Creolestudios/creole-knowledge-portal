import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    let candidate_name = '';
    let candidate_email = '';
    let candidate_phone = '';
    let resume_storage_path = '';
    let jd_storage_path = '';
    let resumeText = '';
    let jdText = '';
    let parsedResume: Record<string, unknown> | undefined;
    let parsedJd: Record<string, unknown> | undefined;
    let skillGap: Record<string, unknown> | undefined;
    let questionCount: number | undefined;
    let durationMinutes: number | undefined;
    let similarityConfirmed: boolean | undefined;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      candidate_name = (formData.get('candidate_name') as string) || '';
      candidate_email = (formData.get('candidate_email') as string) || '';
      candidate_phone = (formData.get('candidate_phone') as string) || '';
      resumeText = (formData.get('resumeText') as string) || '';
      jdText = (formData.get('jdText') as string) || '';

      const resumeFile = formData.get('resumeFile') as File | null;
      if (resumeFile && resumeFile.size > 0) {
        resume_storage_path = `resumes/${Date.now()}_${resumeFile.name}`;
      }

      const jdFile = formData.get('jdFile') as File | null;
      if (jdFile && jdFile.size > 0) {
        jd_storage_path = `jds/${Date.now()}_${jdFile.name}`;
      }
    } else {
      const body = await req.json();
      candidate_name = body.candidate_name || '';
      candidate_email = body.candidate_email || '';
      candidate_phone = body.candidate_phone || '';
      resumeText = body.resumeText || '';
      jdText = body.jdText || '';
      resume_storage_path = body.resume_storage_path || '';
      jd_storage_path = body.jd_storage_path || '';
      parsedResume = body.parsed_resume || undefined;
      parsedJd = body.parsed_jd || undefined;
      skillGap = body.skill_gap || undefined;
      questionCount = typeof body.question_count === 'number' ? body.question_count : undefined;
      durationMinutes = typeof body.duration_minutes === 'number' ? body.duration_minutes : undefined;
      similarityConfirmed = typeof body.similarity_confirmed === 'boolean' ? body.similarity_confirmed : undefined;
    }

    const { data: session, error } = await supabaseAdmin
      .from('interview_sessions')
      .insert({
        candidate_name,
        candidate_email,
        candidate_phone,
        resume_storage_path,
        jd_storage_path,
        parsed_resume: parsedResume || (resumeText ? { summary: resumeText } : {}),
        parsed_jd: parsedJd || (jdText ? { keyResponsibilities: [jdText] } : {}),
        skill_gap: skillGap || {},
        question_count: questionCount,
        duration_minutes: durationMinutes,
        similarity_confirmed: similarityConfirmed,
        status: 'draft',
      })
      .select()
      .single();

    if (error || !session) {
      console.error('Error creating interview session:', error);
      return NextResponse.json(
        { error: error?.message || 'Failed to create interview session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { data: sessions, error } = await supabaseAdmin
      .from('interview_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
