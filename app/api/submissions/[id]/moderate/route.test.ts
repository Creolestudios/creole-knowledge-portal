import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: vi.fn(),
}));

vi.mock('@/lib/data/db', () => ({
  getSubmissionById: vi.fn(),
  saveSubmission: vi.fn(),
  addAuditLog: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { getSubmissionById, saveSubmission, addAuditLog } from '@/lib/data/db';

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/submissions/sub-1/moderate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/submissions/[id]/moderate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const res = await POST(mockRequest({ action: 'APPROVE' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not an admin', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });
    (requireAdminUser as any).mockResolvedValue(null);

    const res = await POST(mockRequest({ action: 'APPROVE' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 when submission does not exist', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@creole.com' } } }) },
    });
    (requireAdminUser as any).mockResolvedValue({ id: 'admin1' });
    (getSubmissionById as any).mockResolvedValue(null);

    const res = await POST(mockRequest({ action: 'APPROVE' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when action is invalid', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@creole.com' } } }) },
    });
    (requireAdminUser as any).mockResolvedValue({ id: 'admin1' });
    (getSubmissionById as any).mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });

    const res = await POST(mockRequest({ action: 'INVALID_ACTION' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(400);
  });

  it('approves a submission successfully', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@creole.com' } } }) },
    });
    (requireAdminUser as any).mockResolvedValue({ id: 'admin1' });
    (getSubmissionById as any).mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });

    const res = await POST(mockRequest({ action: 'APPROVE', reason: 'Looks great' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submission.status).toBe('APPROVED');
    expect(saveSubmission).toHaveBeenCalled();
    expect(addAuditLog).toHaveBeenCalledWith(
      'MODERATOR_APPROVED',
      'admin@creole.com',
      'sub-1',
      'Moderator override: APPROVE. Reason: Looks great'
    );
  });

  it('rejects/flags a submission successfully', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@creole.com' } } }) },
    });
    (requireAdminUser as any).mockResolvedValue({ id: 'admin1' });
    (getSubmissionById as any).mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });

    const res = await POST(mockRequest({ action: 'REJECT' }), {
      params: Promise.resolve({ id: 'sub-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submission.status).toBe('FLAGGED');
    expect(addAuditLog).toHaveBeenCalledWith(
      'MODERATOR_REJECTED',
      'admin@creole.com',
      'sub-1',
      'Moderator override: REJECT. Reason: No reason provided.'
    );
  });
});
