import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { getSubmissionById, saveSubmission, addAuditLog, Submission } from '@/lib/data/db';

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

    const admin = await requireAdminUser();
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const submission = await getSubmissionById(id);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const { action, reason } = await req.json();
    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json(
        { error: 'Valid action (APPROVE or REJECT) is required' },
        { status: 400 }
      );
    }

    let newStatus: Submission['status'];
    let auditAction: 'MODERATOR_APPROVED' | 'MODERATOR_REJECTED';

    if (action === 'APPROVE') {
      newStatus = 'APPROVED';
      auditAction = 'MODERATOR_APPROVED';
    } else {
      newStatus = 'FLAGGED';
      auditAction = 'MODERATOR_REJECTED';
    }

    submission.status = newStatus;

    // Save submission status changes
    await saveSubmission(submission);

    // Record audit log
    await addAuditLog(
      auditAction,
      user.email || '',
      id,
      `Moderator override: ${action}. Reason: ${reason || 'No reason provided.'}`
    );

    return NextResponse.json({ submission });
  } catch (error: any) {
    console.error('Error in POST /api/submissions/[id]/moderate:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
