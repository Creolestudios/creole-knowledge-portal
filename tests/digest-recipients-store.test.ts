import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockFrom = vi.fn();
const mockListUsers = vi.fn();
const mockUpdateUserById = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
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
  getDigestRecipientEmails,
  getAllDigestRecipients,
  addDigestRecipientEmail,
  removeDigestRecipientEmail,
} from '@/lib/zoho/digest-recipients-store';

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

describe('Digest Recipients Store - Schema Cache Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupCache();
  });

  afterEach(() => {
    cleanupCache();
  });

  it('reads from public.admin_digest_recipients when table exists in database', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ email: 'manager@creolestudios.com' }],
          error: null,
        }),
      }),
    });

    const emails = await getDigestRecipientEmails();
    expect(emails).toEqual(['manager@creolestudios.com']);
  });

  it('handles "Could not find table public.admin_digest_recipients in schema cache" gracefully without throwing', async () => {
    // Simulate Supabase PostgREST PGRST205 schema cache error
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.admin_digest_recipients' in the schema cache",
          },
        }),
      }),
    });

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'admin-1',
            email: 'admin@creolestudios.com',
            user_metadata: {
              digest_recipient_emails: ['fallback-cto@creolestudios.com'],
            },
          },
        ],
      },
      error: null,
    });

    const emails = await getDigestRecipientEmails();
    expect(emails).toEqual(['fallback-cto@creolestudios.com']);
  });

  it('adds an email to metadata fallback when table does not exist', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              code: 'PGRST205',
              message: "Could not find the table 'public.admin_digest_recipients' in the schema cache",
            },
          }),
        }),
      }),
    });

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'admin-1',
            email: 'admin@creolestudios.com',
            user_metadata: {},
          },
        ],
      },
      error: null,
    });

    mockUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null });

    const result = await addDigestRecipientEmail('director@creolestudios.com');
    expect(result.email).toBe('director@creolestudios.com');
    expect(result.source).toBe('metadata_fallback');
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({
        user_metadata: expect.objectContaining({
          digest_recipient_emails: expect.arrayContaining(['director@creolestudios.com']),
        }),
      })
    );
  });

  it('removes an email from metadata fallback', async () => {
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.admin_digest_recipients' in the schema cache",
          },
        }),
      }),
    });

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'admin-1',
            email: 'admin@creolestudios.com',
            user_metadata: {
              digest_recipient_emails: ['keep@creolestudios.com', 'remove@creolestudios.com'],
            },
          },
        ],
      },
      error: null,
    });

    mockUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null });

    const success = await removeDigestRecipientEmail('remove@creolestudios.com');
    expect(success).toBe(true);
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({
        user_metadata: expect.objectContaining({
          digest_recipient_emails: ['keep@creolestudios.com'],
        }),
      })
    );
  });
});
