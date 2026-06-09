import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSubmissionById, saveSubmission, addAuditLog } from '@/lib/data/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const submission = await getSubmissionById(id);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // Check ownership
    const isAdmin = user.email?.toLowerCase() === 'priya.dhanani@creolestudios.com';
    if (!isAdmin && submission.author.toLowerCase() !== user.email?.toLowerCase()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (submission.status !== 'PENDING_QUIZ') {
      return NextResponse.json(
        { error: 'Quiz has already been taken or submission is closed' },
        { status: 400 }
      );
    }

    if (!submission.quiz || !submission.quiz.questions) {
      return NextResponse.json(
        { error: 'Quiz not initialized for this submission' },
        { status: 500 }
      );
    }

    const { userSelection } = await req.json();
    if (!userSelection || typeof userSelection !== 'object') {
      return NextResponse.json({ error: 'userSelection object is required' }, { status: 400 });
    }

    // Grade the quiz
    let score = 0;
    const questions = submission.quiz.questions;

    for (const q of questions) {
      const selectedIndex = userSelection[q.id];
      if (selectedIndex !== undefined && Number(selectedIndex) === q.correctOptionIndex) {
        score++;
      }
    }

    // Threshold: 2 or more correct answers out of 3 is required to pass
    const isPassing = score >= 2;
    const newStatus = isPassing ? 'APPROVED' : 'REJECTED_QUIZ';

    submission.status = newStatus;
    submission.quiz = {
      ...submission.quiz,
      userSelection,
      score,
    };

    await saveSubmission(submission);
    await addAuditLog(
      'QUIZ_TAKEN',
      user.email || 'unknown@creolestudios.com',
      id,
      `Quiz graded. Score: ${score}/${questions.length}. Passing threshold: 2/3. Status transitioned to: ${newStatus}.`
    );

    return NextResponse.json({ submission });
  } catch (error: any) {
    console.error('Error in POST /api/submissions/[id]/quiz:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
