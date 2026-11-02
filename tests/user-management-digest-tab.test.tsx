// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } }, error: null }),
    },
  }),
}));

import UserManagement from '@/components/user-management';

describe('UserManagement Admin & Manager Digest Sub-Tab', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders sub-tab buttons and switches to Admin & Manager Digest view', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/users')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              user_id: 'u-1',
              email: 'john@creolestudios.com',
              role: 'user',
              current_role: 'Frontend Dev',
              years_of_experience: 3,
              primary_tech_stack: ['React'],
              secondary_tech_stack: [],
              future_interests: 'AI',
            },
          ],
        });
      }
      if (url.includes('/api/admin/zoho/digest-recipients')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'rec-1',
                email: 'cto@creolestudios.com',
                name: 'Chief Tech Officer',
                role: 'admin',
                is_active: true,
                created_at: '2026-11-01T00:00:00Z',
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<UserManagement />);

    // Wait for user list to load
    await waitFor(() => {
      expect(screen.getByTestId('tab-user-profiles')).toBeDefined();
      expect(screen.getByTestId('tab-admin-manager-digest')).toBeDefined();
    });

    // Switch to Digest tab
    fireEvent.click(screen.getByTestId('tab-admin-manager-digest'));

    await waitFor(() => {
      expect(screen.getByTestId('admin-manager-digest-section')).toBeDefined();
      expect(screen.getByText('Admin & Manager Digest Emails')).toBeDefined();
      expect(screen.getByTestId('digest-email-chip-cto@creolestudios.com')).toBeDefined();
    });
  });

  it('adds a new digest recipient email via tag input', async () => {
    let recipients = [
      {
        id: 'rec-1',
        email: 'cto@creolestudios.com',
        is_active: true,
        created_at: '2026-11-01T00:00:00Z',
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/users')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      if (url.includes('/api/admin/zoho/digest-recipients')) {
        if (opts?.method === 'POST') {
          const body = JSON.parse(opts.body);
          const newRec = {
            id: 'rec-2',
            email: body.email,
            is_active: true,
            created_at: new Date().toISOString(),
          };
          recipients.push(newRec);
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: newRec }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: recipients }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-admin-manager-digest')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('tab-admin-manager-digest'));

    await waitFor(() => {
      expect(screen.getByTestId('digest-email-input')).toBeDefined();
    });

    const emailInput = screen.getByTestId('digest-email-input');
    fireEvent.change(emailInput, { target: { value: 'manager@creolestudios.com' } });

    const addButton = screen.getByTestId('add-digest-email-button');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/zoho/digest-recipients',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'manager@creolestudios.com' }),
        })
      );
    });
  });

  it('removes a digest recipient email tag and dispatches delete', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/users')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.includes('/api/admin/zoho/digest-recipients')) {
        if (opts?.method === 'DELETE') {
          return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [{ id: 'rec-1', email: 'cto@creolestudios.com' }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-admin-manager-digest')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('tab-admin-manager-digest'));

    await waitFor(() => {
      expect(screen.getByTestId('remove-digest-email-cto@creolestudios.com')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('remove-digest-email-cto@creolestudios.com'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/zoho/digest-recipients?email=cto%40creolestudios.com',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('triggers manual digest dispatch via Trigger Today\'s Digest Now button', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/users')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.includes('/api/admin/zoho/digest-recipients')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [{ id: 'rec-1', email: 'cto@creolestudios.com' }],
          }),
        });
      }
      if (url.includes('/api/admin/zoho/send-digest-email')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            recipientCount: 1,
            usersEvaluated: 5,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-admin-manager-digest')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('tab-admin-manager-digest'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Trigger Today's Digest Now/i })).toBeDefined();
    });

    const triggerBtn = screen.getByRole('button', { name: /Trigger Today's Digest Now/i });
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/zoho/send-digest-email',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
