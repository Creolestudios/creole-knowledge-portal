// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminDashboard from './page';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/components/user-management', () => ({
  default: () => <div data-testid="user-management" />,
}));
vi.mock('@/components/submissions-moderation', () => ({
  default: () => <div data-testid="submissions-moderation" />,
}));
vi.mock('@/components/ai-interview-manager', () => ({
  default: () => <div data-testid="ai-interview-manager" />,
}));
vi.mock('@/components/zoho/zoho-evaluation-manager', () => ({
  default: () => <div data-testid="zoho-evaluation-manager" />,
}));

const mockGetUser = vi.fn();
let queue: any[];

function makeChain() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => {
      const res = queue.length > 0 ? queue.shift() : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser: (...args: any[]) => mockGetUser(...args), signOut: vi.fn().mockResolvedValue({}) },
    from: vi.fn(() => makeChain()),
  }),
}));

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('redirects non-admin (or unauthenticated) users to the login page', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('redirects when the user profile is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@creolestudios.com' } } });
    queue = [{ data: null, error: { message: 'profile missing' } }];
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('redirects when the profile role is not admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'user' }, error: null }];

    render(<AdminDashboard />);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('loads existing blog sources for a verified admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [
      { data: { role: 'admin' }, error: null }, // profile check
      { data: [{ url: 'https://a.com' }, { url: 'https://b.com' }], error: null }, // sources
    ];

    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('https://a.com')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('https://b.com')).toBeInTheDocument();
  });

  it('adds and removes URL fields', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Add Another URL'));

    fireEvent.click(screen.getByText('Add Another URL'));
    expect(screen.getByText('2 / 10 URLs Added')).toBeInTheDocument();

    const removeButtons = screen.getAllByTitle('Remove source');
    fireEvent.click(removeButtons[0]);
    expect(screen.getByText('1 / 10 URLs Added')).toBeInTheDocument();
  });

  it('shows a validation error when saving with no non-empty URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Save Sources'));
    fireEvent.click(screen.getByText('Save Sources'));

    await waitFor(() => {
      expect(screen.getByText('At least one blog source URL is required.')).toBeInTheDocument();
    });
  });

  it('shows a validation error for a malformed URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Save Sources'));

    fireEvent.change(screen.getByPlaceholderText('https://example.com/blog'), {
      target: { value: 'not-a-url' },
    });
    fireEvent.click(screen.getByText('Save Sources'));

    await waitFor(() => {
      expect(screen.getByText(/Invalid URL format/)).toBeInTheDocument();
    });
  });

  it('saves valid sources successfully', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [
      { data: { role: 'admin' }, error: null },
      { data: [], error: null },
      { error: null }, // delete
      { error: null }, // insert
    ];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Save Sources'));

    fireEvent.change(screen.getByPlaceholderText('https://example.com/blog'), {
      target: { value: 'https://valid.com/blog' },
    });
    fireEvent.click(screen.getByText('Save Sources'));

    await waitFor(() => {
      expect(screen.getByText('Sources saved successfully! System updated.')).toBeInTheDocument();
    });
  });

  it('switches to the Users and Submissions tabs', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Manage Blog Sources'));

    fireEvent.click(screen.getByText('Users'));
    await waitFor(() => {
      expect(screen.getByTestId('user-management')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Submissions'));
    await waitFor(() => {
      expect(screen.getByTestId('submissions-moderation')).toBeInTheDocument();
    });
  });

  it('signs out and redirects to the login page', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Sign Out'));
    fireEvent.click(screen.getByText('Sign Out'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('does not display the option for user dashboard in the admin navigation', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Blog Sources'));

    expect(screen.queryByText('User Dashboard')).not.toBeInTheDocument();
  });

  it('activates Zoho Evaluation tab directly when URL has ?tab=zoho on page refresh/load', async () => {
    mockSearchParams = new URLSearchParams('tab=zoho');
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('zoho-evaluation-manager')).toBeInTheDocument();
    });
  });

  it('activates AI Interview tab directly when URL has ?tab=ai-interviews on page refresh/load', async () => {
    mockSearchParams = new URLSearchParams('tab=ai-interviews');
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-interview-manager')).toBeInTheDocument();
    });
  });

  it('updates the URL and localStorage when switching tabs', async () => {
    mockSearchParams = new URLSearchParams();
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@creolestudios.com' } },
    });
    queue = [{ data: { role: 'admin' }, error: null }, { data: [], error: null }];

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Blog Sources'));

    fireEvent.click(screen.getByText('Zoho Evaluation'));
    await waitFor(() => {
      expect(screen.getByTestId('zoho-evaluation-manager')).toBeInTheDocument();
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', expect.stringContaining('tab=zoho'));
    expect(localStorage.getItem('admin_active_tab')).toBe('zoho');
  });
});
