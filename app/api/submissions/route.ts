import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { requireAdminUser } from '@/lib/supabase/admin';
import { getSubmissions, saveSubmission, addAuditLog, Submission } from '@/lib/data/db';
import { validateContent, generateQuiz } from '@/lib/ai/validator';

export async function GET(req: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const submissions = await getSubmissions();
    const admin = await requireAdminUser();
    const isAdmin = !!admin;

    // Regular users can only see their own submissions; admins see all
    const filtered = isAdmin
      ? submissions
      : submissions.filter((s) => s.author.toLowerCase() === user.email?.toLowerCase());

    return NextResponse.json({ submissions: filtered });
  } catch (error: any) {
    console.error('Error in GET /api/submissions:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { title, content } = await req.json();

    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // 1. Fetch existing submissions for plagiarism checking
    const existingSubmissions = await getSubmissions();

    // Filter to approved/pending blogs to ensure duplicate comparison makes sense
    const activeSubmissions = existingSubmissions.filter(
      (s) => s.status === 'APPROVED' || s.status === 'PENDING_QUIZ'
    );

    // 2. Validate content with AI Validator pipeline
    const validationReport = await validateContent(title, content, activeSubmissions);

    // 3. Determine initial status based on validation report thresholds
    let status: Submission['status'] = 'PENDING_QUIZ';
    let rejectionReason = '';

    if (validationReport.gibberishDetected) {
      status = 'REJECTED_AI';
      rejectionReason = 'Gibberish/keyboard-mash content detected.';
    } else if (validationReport.lowQualityDetected) {
      status = 'REJECTED_AI';
      rejectionReason = 'Content lacks depth or detail.';
    } else if (validationReport.aiSpamDetected) {
      status = 'REJECTED_AI';
      rejectionReason = 'AI-spammed or low-effort AI filler text detected.';
    } else if (validationReport.qualityScore < 50) {
      status = 'REJECTED_AI';
      rejectionReason = `Content quality score (${validationReport.qualityScore}/100) is below the minimum threshold (50).`;
    } else if (validationReport.plagiarismOverlap >= 50) {
      status = 'REJECTED_AI';
      rejectionReason = `High duplication overlap (${validationReport.plagiarismOverlap}%) with an existing blog.`;
    }

    // 4. Create new submission record
    const submissionId = crypto.randomUUID();
    const newSubmission: Submission = {
      id: submissionId,
      title: title.trim(),
      content: content.trim(),
      author: user.email || 'unknown@creolestudios.com',
      status,
      validationReport,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 5. Generate quiz if validation passed
    if (status === 'PENDING_QUIZ') {
      const questions = await generateQuiz(content);
      newSubmission.quiz = {
        questions,
        score: 0,
      };
    }

    // 6. Save and Audit Log
    await saveSubmission(newSubmission);
    await addAuditLog(
      'SUBMITTED',
      user.email || 'system',
      submissionId,
      `Blog submitted: "${title.trim()}"`
    );
    await addAuditLog(
      'AI_VALIDATED',
      'system',
      submissionId,
      `AI Report: Quality=${validationReport.qualityScore}, Plagiarism=${validationReport.plagiarismOverlap}%. Status decided: ${status}. Reason: ${validationReport.reason || rejectionReason || 'Passed checks.'}`
    );

    return NextResponse.json({ submission: newSubmission });
  } catch (error: any) {
    console.error('Error in POST /api/submissions:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
