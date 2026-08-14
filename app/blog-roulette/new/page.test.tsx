// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewBlogPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/blog-roulette/new',
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({ auth: { signOut: vi.fn().mockResolvedValue({}) } }),
}));

describe('NewBlogPage', () => {
  const originalFetch = global.fetch;
  const originalAlert = window.alert;

  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.alert = originalAlert;
  });

  it('disables "Suggest Keywords" until the title is at least 5 characters', () => {
    render(<NewBlogPage />);
    const suggestBtn = screen.getByText('Suggest Keywords').closest('button')!;
    expect(suggestBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Blog Title'), { target: { value: 'React' } });
    expect(suggestBtn).not.toBeDisabled();
  });

  it('fetches and displays primary and long-tail keyword suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          { keyword: 'react hooks', type: 'primary', trend_direction: 'rising' },
          { keyword: 'react hooks guide', type: 'long_tail', trend_direction: 'stable' },
        ],
      }),
    });

    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), { target: { value: 'React Hooks Deep Dive' } });
    fireEvent.click(screen.getByText('Suggest Keywords'));

    await waitFor(() => {
      expect(screen.getByText('react hooks')).toBeInTheDocument();
    });
    expect(screen.getByText('react hooks guide')).toBeInTheDocument();
    expect(screen.getByText('Rising')).toBeInTheDocument();
  });

  it('toggles a keyword selection on click', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [{ keyword: 'react hooks', type: 'primary', trend_direction: 'stable' }] }),
    });

    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), { target: { value: 'React Hooks Deep Dive' } });
    fireEvent.click(screen.getByText('Suggest Keywords'));
    await waitFor(() => screen.getByText('react hooks'));

    const kwBtn = screen.getByText('react hooks').closest('button')!;
    fireEvent.click(kwBtn);
    expect(kwBtn.className).toContain('bg-brand');
    fireEvent.click(kwBtn);
    expect(kwBtn.className).not.toContain('border-brand shadow-brand');
  });

  it('does not suggest when the fetch fails, leaving suggestions empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), { target: { value: 'React Hooks Deep Dive' } });
    fireEvent.click(screen.getByText('Suggest Keywords'));

    await waitFor(() => {
      expect(screen.getByText('Suggest Keywords')).toBeInTheDocument(); // still on the page
    });
    expect(screen.queryByText('Keyword Suggestions')).not.toBeInTheDocument();
  });

  it('alerts when trying to create a blog with too short a title', () => {
    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), { target: { value: 'short' } });
    // Continue button is disabled below 10 chars, so directly invoking isn't
    // possible via click; instead verify the button stays disabled.
    const createBtn = screen.getByText('Continue to Editor').closest('button')!;
    expect(createBtn).toBeDisabled();
  });

  it('creates a blog and navigates to its editor on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'blog-42' }) });
    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), {
      target: { value: 'A sufficiently long blog title' },
    });
    fireEvent.click(screen.getByText('Continue to Editor'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/blog-roulette/blog-42/edit');
    });
  });

  it('alerts with the server error when blog creation fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Title already taken' }) });
    render(<NewBlogPage />);
    fireEvent.change(screen.getByLabelText('Blog Title'), {
      target: { value: 'A sufficiently long blog title' },
    });
    fireEvent.click(screen.getByText('Continue to Editor'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Title already taken');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
