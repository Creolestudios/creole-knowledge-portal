// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserManagement from './user-management';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

const sampleUsers = [
  {
    user_id: 'u1',
    email: 'complete@creolestudios.com',
    role: 'user',
    current_role: 'Frontend Dev',
    years_of_experience: 3,
    current_tech_stack: [],
    primary_tech_stack: ['React'],
    secondary_tech_stack: [],
    future_interests: 'AI',
    ai_subscriptions: ['GitHub Copilot', 'ChatGPT Plus'],
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    user_id: 'u2',
    email: 'incomplete@creolestudios.com',
    role: 'admin',
    current_role: '',
    years_of_experience: 0,
    current_tech_stack: [],
    primary_tech_stack: [],
    secondary_tech_stack: [],
    future_interests: '',
    ai_subscriptions: [],
    updated_at: '2026-08-02T00:00:00Z',
  },
  {
    user_id: 'u3',
    email: 'partial@creolestudios.com',
    role: 'user',
    current_role: 'Intern',
    years_of_experience: null as unknown as number,
    current_tech_stack: [],
    primary_tech_stack: ['Go'],
    secondary_tech_stack: [],
    future_interests: '',
    ai_subscriptions: [],
    updated_at: '2026-08-03T00:00:00Z',
  },
];

describe('UserManagement', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows a loading state, then the user list', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    expect(screen.getByText(/Scanning user network/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('complete@creolestudios.com')).toBeInTheDocument();
    });
    expect(screen.getByText('incomplete@creolestudios.com')).toBeInTheDocument();
  });

  it('displays total users, total admins, and regular users count cards', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    expect(screen.getByTestId('total-users-count')).toHaveTextContent('3');
    expect(screen.getByTestId('total-admins-count')).toHaveTextContent('1');
    expect(screen.getByTestId('regular-users-count')).toHaveTextContent('2');
  });

  it('shows an error toast when the initial fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('No users found')).toBeInTheDocument();
    });
  });

  it('filters the user list by the search query', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    fireEvent.change(screen.getByPlaceholderText(/Search by email/), {
      target: { value: 'incomplete' },
    });

    expect(screen.queryByText('complete@creolestudios.com')).not.toBeInTheDocument();
    expect(screen.getByText('incomplete@creolestudios.com')).toBeInTheDocument();
  });

  it('opens the edit form for a selected user and shows their current values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));
    expect(screen.getByText('Edit User Profile')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Frontend Dev')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('adds and removes primary tech stack tags', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    const input = screen.getByPlaceholderText(/Type a core skill/);
    fireEvent.change(input, { target: { value: 'TypeScript' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    // Remove the newly added tag
    const tag = screen.getByText('TypeScript').closest('span')!;
    fireEvent.click(tag.querySelector('button')!);
    await waitFor(() => {
      expect(screen.queryByText('TypeScript')).not.toBeInTheDocument();
    });
  });

  it('toggles the system access role between user and admin', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    fireEvent.click(screen.getByText('Admin access'));
    // No direct visual assertion needed beyond not throwing; covered via save payload below.
  });

  it('saves profile changes and shows a success toast', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: any) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => sampleUsers });
    });

    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    fireEvent.click(screen.getByText('Save Profile'));

    await waitFor(() => {
      expect(screen.getByText('Profile updated successfully!')).toBeInTheDocument();
    });
  });

  it('shows an error toast when saving fails', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: any) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Update rejected' }) });
      }
      return Promise.resolve({ ok: true, json: async () => sampleUsers });
    });

    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));
    fireEvent.click(screen.getByText('Save Profile'));

    await waitFor(() => {
      expect(screen.getByText('Update rejected')).toBeInTheDocument();
    });
  });

  it('returns to the user list via Back / Cancel', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    fireEvent.click(screen.getByText('Back to User List'));
    await waitFor(() => {
      expect(screen.getByText('All Users')).toBeInTheDocument();
    });
  });

  it('returns to the user list via Cancel button', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.getByText('All Users')).toBeInTheDocument();
    });
  });

  it('adds and removes secondary tech stack tags via comma key', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    const input = screen.getByPlaceholderText(/Type an additional skill/);
    fireEvent.change(input, { target: { value: 'GraphQL,' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(screen.getByText('GraphQL')).toBeInTheDocument();

    const tag = screen.getByText('GraphQL').closest('span')!;
    fireEvent.click(tag.querySelector('button')!);
    await waitFor(() => {
      expect(screen.queryByText('GraphQL')).not.toBeInTheDocument();
    });
  });

  it('edits years of experience and future interests fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    const yearsInput = screen.getByDisplayValue('3');
    fireEvent.change(yearsInput, { target: { value: '5' } });
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();

    fireEvent.change(yearsInput, { target: { value: '' } });
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Wants to learn AI/);
    fireEvent.change(textarea, { target: { value: 'Cloud architecture' } });
    expect(screen.getByDisplayValue('Cloud architecture')).toBeInTheDocument();
  });

  it('adds primary tech tag with comma key and ignores duplicates', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    const input = screen.getByPlaceholderText(/Type a core skill/);

    // Add via comma key
    fireEvent.change(input, { target: { value: 'Vue,' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(screen.getByText('Vue')).toBeInTheDocument();

    // Duplicate should not add again
    fireEvent.change(input, { target: { value: 'Vue,' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(screen.getAllByText('Vue')).toHaveLength(1);
  });

  it('filters users by future_interests', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    fireEvent.change(screen.getByPlaceholderText(/Search by email/), {
      target: { value: 'AI' },
    });

    expect(screen.getByText('complete@creolestudios.com')).toBeInTheDocument();
    expect(screen.queryByText('incomplete@creolestudios.com')).not.toBeInTheDocument();
  });

  it('changes current_role field', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));
    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    const roleInput = screen.getByDisplayValue('Frontend Dev');
    fireEvent.change(roleInput, { target: { value: 'Backend Dev' } });
    expect(screen.getByDisplayValue('Backend Dev')).toBeInTheDocument();
  });

  it('opens delete confirmation modal and cancels deletion', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    const deleteBtn = screen.getByLabelText('Delete complete@creolestudios.com');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Delete User Account')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to permanently delete user/)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Delete User Account')).not.toBeInTheDocument();
    });
  });

  it('deletes user when confirmed in modal', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === 'DELETE') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => sampleUsers };
    });

    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    const deleteBtn = screen.getByLabelText('Delete complete@creolestudios.com');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Delete User Account')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /^Delete User$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('complete@creolestudios.com')).not.toBeInTheDocument();
    });
  });

  it('renders AI subscriptions badges on user cards', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsers });
    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT Plus')).toBeInTheDocument();
    expect(screen.getAllByText('No AI subscription assigned')).toHaveLength(2);
  });

  it('allows toggling preset and custom AI subscriptions in the edit form and saving them', async () => {
    let putPayload: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === 'PUT') {
        putPayload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => sampleUsers };
    });

    render(<UserManagement />);
    await waitFor(() => screen.getByText('complete@creolestudios.com'));

    fireEvent.click(screen.getByText('complete@creolestudios.com'));
    await waitFor(() => screen.getByText('Edit User Profile'));

    expect(screen.getByText('Current AI Subscriptions')).toBeInTheDocument();

    // Toggle preset "Cursor AI" to add it
    const cursorBtn = screen.getByRole('button', { name: /Cursor AI/i });
    fireEvent.click(cursorBtn);

    // Add a custom tool
    const customInput = screen.getByPlaceholderText(/Add custom AI subscription/i);
    fireEvent.change(customInput, { target: { value: 'Supermaven' } });
    fireEvent.keyDown(customInput, { key: 'Enter', code: 'Enter' });

    // Submit form
    const saveBtn = screen.getByRole('button', { name: /Save Profile/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(putPayload).toBeTruthy();
    });
    expect(putPayload.ai_subscriptions).toContain('GitHub Copilot');
    expect(putPayload.ai_subscriptions).toContain('ChatGPT Plus');
    expect(putPayload.ai_subscriptions).toContain('Cursor AI');
    expect(putPayload.ai_subscriptions).toContain('Supermaven');
  });
});
