import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockRequireAdminUser = vi.fn();
const mockFrom = vi.fn();
const mockListUsers = vi.fn().mockResolvedValue({ data: { users: [] }, error: null });
const mockUpdateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });

const CACHE_FILE = path.join(process.cwd(), '.data', 'admin-digest-recipients.json');

function cleanupCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch {
    // ignore
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: (...args: any[]) => mockRequireAdminUser(...args),
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsers(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
      },
    },
  },
}));

import {
  GET as digestGet,
  POST as digestPost,
  PATCH as digestPatch,
  DELETE as digestDelete,
} from '@/app/api/admin/zoho/digest-recipients/route';

describe('Admin Digest Recipients API Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupCache();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-uuid-1' });
  });

  afterEach(() => {
    cleanupCache();
  });

  describe('GET /api/admin/zoho/digest-recipients', () => {
    it('returns 401 when user is not admin and in production', async () => {
      mockRequireAdminUser.mockResolvedValue(null);
      vi.stubEnv('NODE_ENV', 'production');

      const res = await digestGet();
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');

      vi.unstubAllEnvs();
    });

    it('returns configured digest recipients on success', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'rec-1', email: 'cto@creolestudios.com', name: 'CTO', role: 'admin', is_active: true },
            ],
            error: null,
          }),
        }),
      });

      const res = await digestGet();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].email).toBe('cto@creolestudios.com');
    });

    it('returns empty array when admin_digest_recipients table returns error without falling back to site admin profiles', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_digest_recipients') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'relation admin_digest_recipients does not exist' },
              }),
            }),
          };
        }
        return {};
      });

      const res = await digestGet();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('POST /api/admin/zoho/digest-recipients', () => {
    it('validates email address and rejects invalid format', async () => {
      const req = new Request('http://localhost/api/admin/zoho/digest-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      const res = await digestPost(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('Valid email address is required');
    });

    it('upserts new digest recipient successfully', async () => {
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'rec-new', email: 'manager@creolestudios.com', role: 'manager', is_active: true },
              error: null,
            }),
          }),
        }),
      });

      const req = new Request('http://localhost/api/admin/zoho/digest-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'manager@creolestudios.com', name: 'Dev Manager', role: 'manager' }),
      });

      const res = await digestPost(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.email).toBe('manager@creolestudios.com');
    });
  });

  describe('PATCH /api/admin/zoho/digest-recipients', () => {
    it('updates is_active status of recipient', async () => {
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'rec-1', is_active: false },
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = new Request('http://localhost/api/admin/zoho/digest-recipients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'rec-1', is_active: false }),
      });

      const res = await digestPatch(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.is_active).toBe(false);
    });
  });

  describe('DELETE /api/admin/zoho/digest-recipients', () => {
    it('deletes recipient by query parameter id', async () => {
      mockFrom.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const req = new Request('http://localhost/api/admin/zoho/digest-recipients?id=rec-to-delete', {
        method: 'DELETE',
      });

      const res = await digestDelete(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.deletedId).toBe('rec-to-delete');
    });

    it('deletes recipient by query parameter email', async () => {
      mockFrom.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const req = new Request('http://localhost/api/admin/zoho/digest-recipients?email=manager@creolestudios.com', {
        method: 'DELETE',
      });

      const res = await digestDelete(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.deletedEmail).toBe('manager@creolestudios.com');
    });
  });
});
