// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlogRouletteListPage from './page';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/blog-roulette',
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const mockGetUser = vi.fn();
const mockOrder = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser: (...args: any[]) => mockGetUser(...args), signOut: vi.fn().mockResolvedValue({}) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: (...args: any[]) => mockOrder(...args),
        }),
      }),
    }),
  }),
}));

function blog(overrides: Partial<any> = {}) {
  return {
    id: 'blog-1',
    title: 'My Technical Blog',
    status: 'DRAFT',
    reading_time: 5,
    word_count: 1200,
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('BlogRouletteListPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('redirects to login when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    render(<BlogRouletteListPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('shows the empty state with a call-to-action when there are no blogs', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({ data: [] });

    render(<BlogRouletteListPage />);
    await waitFor(() => {
      expect(screen.getByText('No blogs yet. Share what you know.')).toBeInTheDocument();
    });
  });

  it('lists blogs with their status badge and metadata', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({ data: [blog()] });

    render(<BlogRouletteListPage />);
    await waitFor(() => {
      expect(screen.getByText('My Technical Blog')).toBeInTheDocument();
    });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('1200 words')).toBeInTheDocument();
  });

  it('shows the Knowledge Badge and Google Doc link for a published blog', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({
      data: [blog({ status: 'PUBLISHED', drive_url: 'https://docs.google.com/x' })],
    });

    render(<BlogRouletteListPage />);
    await waitFor(() => screen.getByText('My Technical Blog'));
    expect(screen.getByText('Knowledge Badge')).toBeInTheDocument();
    expect(screen.getByText('View Google Doc')).toBeInTheDocument();
  });

  it('shows a retry-publish button for a failed publish and retries successfully', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({ data: [blog({ status: 'PUBLISH_FAILED' })] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webViewLink: 'https://docs.google.com/y' }),
    });

    render(<BlogRouletteListPage />);
    await waitFor(() => screen.getByText('Retry Publish'));

    fireEvent.click(screen.getByText('Retry Publish'));

    await waitFor(() => {
      expect(screen.getByText('View Google Doc')).toBeInTheDocument();
    });
  });

  it('shows a retry error message when the retry publish call fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({ data: [blog({ status: 'PUBLISH_FAILED' })] });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Drive quota exceeded' }) });

    render(<BlogRouletteListPage />);
    await waitFor(() => screen.getByText('Retry Publish'));
    fireEvent.click(screen.getByText('Retry Publish'));

    await waitFor(() => {
      expect(screen.getByText('Drive quota exceeded')).toBeInTheDocument();
    });
  });

  it('navigates to the editor when a blog card is activated with Enter or Space', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockOrder.mockResolvedValue({ data: [blog()] });

    render(<BlogRouletteListPage />);
    await waitFor(() => screen.getByText('My Technical Blog'));

    const card = document.getElementById('blog-card-blog-1')!;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/blog-roulette/blog-1/edit');

    mockPush.mockClear();
    fireEvent.keyDown(card, { key: ' ' });
    expect(mockPush).toHaveBeenCalledWith('/blog-roulette/blog-1/edit');

    mockPush.mockClear();
    fireEvent.keyDown(card, { key: 'a' });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
