import { NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import { generateAccessCode, validateDocumentFile, MAX_JD_TEXT_LENGTH } from '@/lib/ai-interview/validators';

export const runtime = 'nodejs';
export const maxDuration = 30;

function validateFile(file: File | null, label: string): NextResponse | null {
  const result = validateDocumentFile(file, label);
  return result ? NextResponse.json(result, { status: 400 }) : null;
}

/**
 * POST /api/admin/ai-interviews
 *
 * Admin-only. Uploads a resume, plus a job description supplied either as
 * a file or as pasted text, to private Storage / the DB. Creates an
 * ai_interviews row and returns a shareable link + passcode for the candidate.
 *
 * Body: multipart/form-data with field "resume" (file), and the job
 * description as EITHER field "jd" (file) OR "jdText" (string) — exactly
 * one is required. Optional: "candidateName", "candidateEmail", "jobTitle".
 */
export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const resume = form.get('resume') as File | null;
  const jd = form.get('jd') as File | null;
  const jdText = (form.get('jdText') as string | null)?.trim() || null;
  const candidateName = (form.get('candidateName') as string | null)?.trim() || null;
  const candidateEmail = (form.get('candidateEmail') as string | null)?.trim() || null;
  const jobTitle = (form.get('jobTitle') as string | null)?.trim() || null;

  const resumeError = validateFile(resume, 'Resume');
  if (resumeError) return resumeError;

  if (!jd && !jdText) {
    return NextResponse.json(
      { error: 'Job description is required — upload a file or paste the text' },
      { status: 400 },
    );
  }
  if (jd) {
    const jdError = validateFile(jd, 'Job description');
    if (jdError) return jdError;
  } else if (jdText!.length > MAX_JD_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Job description text too long (max ${MAX_JD_TEXT_LENGTH.toLocaleString()} characters)` },
      { status: 400 },
    );
  }

  const interviewId = crypto.randomUUID();
  const resumeExt = resume!.name.split('.').pop() ?? 'pdf';
  const resumePath = `${interviewId}/resume.${resumeExt}`;

  const resumeBuffer = Buffer.from(await resume!.arrayBuffer());

  const { error: resumeUploadError } = await supabaseAdmin.storage
    .from('ai-interview-documents')
    .upload(resumePath, resumeBuffer, { contentType: resume!.type, upsert: false });

  if (resumeUploadError) {
    console.error('[ai-interviews] resume upload failed:', resumeUploadError.message);
    return NextResponse.json({ error: 'Failed to upload resume' }, { status: 500 });
  }

  let jdPath: string | null = null;
  if (jd) {
    const jdExt = jd.name.split('.').pop() ?? 'pdf';
    jdPath = `${interviewId}/jd.${jdExt}`;
    const jdBuffer = Buffer.from(await jd.arrayBuffer());

    const { error: jdUploadError } = await supabaseAdmin.storage
      .from('ai-interview-documents')
      .upload(jdPath, jdBuffer, { contentType: jd.type, upsert: false });

    if (jdUploadError) {
      console.error('[ai-interviews] JD upload failed:', jdUploadError.message);
      await supabaseAdmin.storage.from('ai-interview-documents').remove([resumePath]);
      return NextResponse.json({ error: 'Failed to upload job description' }, { status: 500 });
    }
  }

  const record = {
    id: interviewId,
    created_by: admin.userId,
    candidate_name: candidateName,
    candidate_email: candidateEmail,
    job_title: jobTitle,
    resume_storage_path: resumePath,
    jd_storage_path: jdPath,
    jd_text: jdPath ? null : jdText,
    access_code: generateAccessCode(),
  };

  let insertResult = await supabaseAdmin.from('ai_interviews').insert(record).select('id, access_code').single();

  // Access codes are unique; on the rare collision, retry once with a fresh code.
  if (insertResult.error?.code === '23505') {
    insertResult = await supabaseAdmin
      .from('ai_interviews')
      .insert({ ...record, access_code: generateAccessCode() })
      .select('id, access_code')
      .single();
  }

  if (insertResult.error) {
    console.error('[ai-interviews] insert failed:', insertResult.error.message);
    const pathsToRemove = jdPath ? [resumePath, jdPath] : [resumePath];
    await supabaseAdmin.storage.from('ai-interview-documents').remove(pathsToRemove);
    return NextResponse.json({ error: 'Failed to create interview record' }, { status: 500 });
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  const interviewLink = `${origin}/interview/${insertResult.data.id}`;

  return NextResponse.json({
    interviewId: insertResult.data.id,
    link: interviewLink,
    accessCode: insertResult.data.access_code,
  });
}

/**
 * GET /api/admin/ai-interviews
 *
 * Admin-only. Lists interviews created by the calling admin, most recent first.
 */
export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('ai_interviews')
    .select('id, candidate_name, candidate_email, job_title, access_code, status, expires_at, created_at')
    .eq('created_by', admin.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ai-interviews] list failed:', error.message);
    return NextResponse.json({ error: 'Failed to load interviews' }, { status: 500 });
  }

  return NextResponse.json({ interviews: data });
}
