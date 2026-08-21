// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/components/logout-button', () => ({
  default: () => <button type="button">Logout</button>,
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ displayName }: { displayName: string }) => (
    <div data-testid="dashboard-shell">{displayName}</div>
  ),
}));

const mockGetUser = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: (...args: unknown[]) => mockSingle(...args),
    })),
  })),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state then the dashboard shell for an authenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'dev@creolestudios.com' } },
    });
    mockSingle.mockResolvedValue({
      data: { current_role: 'Engineer' },
      error: null,
    });

    render(<DashboardPage />);
    expect(screen.getByText(/Loading your portal/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toHaveTextContent('Engineer');
    });
  });

  it('redirects to login when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });
});
