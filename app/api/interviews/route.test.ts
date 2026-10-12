import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const { mockSupabaseAdmin, mockRequireAdminUser } = vi.hoisted(() => {
  return {
    mockSupabaseAdmin: {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn(),
    },
    mockRequireAdminUser: vi.fn(),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  requireAdminUser: mockRequireAdminUser,
}));

describe('POST /api/interviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
  });

  it('returns 401 when not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/interviews', {
      method: 'POST',
      body: JSON.stringify({ candidate_name: 'Test User' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('handles multipart/form-data successfully', async () => {
    const formData = new FormData();
    formData.append('candidate_name', 'Test User');
    formData.append('candidate_email', 'test@example.com');
    formData.append('candidate_phone', '1234567890');
    formData.append('resumeText', 'Test resume text');
    formData.append('jdText', 'Test jd text');
    
    const resumeFile = new File(['dummy resume'], 'resume.pdf', { type: 'application/pdf' });
    const jdFile = new File(['dummy jd'], 'jd.pdf', { type: 'application/pdf' });
    formData.append('resumeFile', resumeFile);
    formData.append('jdFile', jdFile);

    const req = new NextRequest('http://localhost:3000/api/interviews', {
      method: 'POST',
      body: formData,
    });
    // NextRequest constructor sets content-type for FormData automatically

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'session-123' },
      error: null,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    
    expect(mockSupabaseAdmin.insert).toHaveBeenCalled();
    const insertArgs = mockSupabaseAdmin.insert.mock.calls[0][0];
    expect(insertArgs.candidate_name).toBe('Test User');
    expect(insertArgs.resume_storage_path).toContain('resume.pdf');
    expect(insertArgs.jd_storage_path).toContain('jd.pdf');
    expect(insertArgs.created_by).toBe('admin-1');
  });

  it('handles supabase insertion error', async () => {
    const req = new NextRequest('http://localhost:3000/api/interviews', {
      method: 'POST',
      body: JSON.stringify({
        candidate_name: 'Error User',
      }),
      headers: { 'content-type': 'application/json' },
    });

    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Database error');
  });
});
