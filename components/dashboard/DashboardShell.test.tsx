// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardShell from './DashboardShell';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: '/dashboard',
  tab: null as string | null,
  date: null as string | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => {
    const params: Record<string, string> = {};
    if (nav.tab) params.tab = nav.tab;
    if (nav.date) params.date = nav.date;
    return new URLSearchParams(params);
  },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/data/activity', () => ({
  getActivity: vi.fn().mockResolvedValue([]),
  computeWeeklyStats: vi.fn().mockReturnValue({ daysRead: 3, briefingDays: 5, quizzesSubmitted: 2, correctPct: 80, wrongPct: 20 }),
}));

vi.mock('./DailyBlogTab', () => ({ default: () => (<div data-testid="daily-tab" />) }));
vi.mock('./PastBlogsTab', () => ({ default: () => (<div data-testid="past-tab" />) }));
vi.mock('./ActivityTab', () => ({ default: () => (<div data-testid="activity-tab" />) }));
vi.mock('./SidebarActivityWidget', () => ({ default: () => (<div data-testid="sidebar-widget" />) }));

describe('DashboardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.pathname = '/dashboard';
    nav.tab = null;
    nav.date = null;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, records: [], streak: 5 }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Daily Blog tab by default and shows the user name/domain', () => {
    render(
      <DashboardShell displayName="dev" displayDomain="creolestudios.com" footer={<div>Footer</div>} />,
    );
    expect(screen.getByTestId('daily-tab')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('shows Blog Roulette as the fourth sidebar option with the correct URL', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    const roulette = screen.getByRole('link', { name: /blog roulette/i });
    expect(roulette).toBeInTheDocument();
    expect(roulette).toHaveAttribute('href', '/blog-roulette');
    expect(screen.getByRole('link', { name: /daily blog/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /past blogs/i })).toHaveAttribute(
      'href',
      '/dashboard?tab=past',
    );
    expect(screen.getByRole('link', { name: /activity tracker/i })).toHaveAttribute(
      'href',
      '/dashboard?tab=activity',
    );
  });

  it('renders Past Blogs when the dashboard tab query is past', () => {
    nav.tab = 'past';
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    expect(screen.getByTestId('past-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-tab')).not.toBeInTheDocument();
  });

  it('renders Activity Tracker when the dashboard tab query is activity', () => {
    nav.tab = 'activity';
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    expect(screen.getByTestId('activity-tab')).toBeInTheDocument();
  });

  it('renders roulette children when the URL is /blog-roulette', () => {
    nav.pathname = '/blog-roulette';
    render(
      <DashboardShell displayName="dev" displayDomain="x.com" footer={null}>
        <div data-testid="roulette-page" />
      </DashboardShell>,
    );
    expect(screen.getByTestId('roulette-page')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-tab')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /blog roulette/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('displays the reading streak returned by /api/activity', async () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    await waitFor(() => {
      expect(screen.getByText('5 days')).toBeInTheDocument();
    });
  });

  it('opens and closes the mobile sidebar drawer', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByLabelText('Close menu'));
  });

  it('falls back to the mock user/profile when none are provided', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    expect(screen.getByTestId('daily-tab')).toBeInTheDocument();
  });

  it('uses singular day copy for a one-day streak', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, records: [], streak: 1 }),
    });
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    await waitFor(() => {
      expect(screen.getByText('1 day')).toBeInTheDocument();
    });
  });

  it('restores a past-blog date from the query string', () => {
    nav.tab = 'past';
    nav.date = '2026-08-01';
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    expect(screen.getByTestId('past-tab')).toBeInTheDocument();
  });

  it('switches preview tabs locally without navigating', () => {
    nav.pathname = '/preview';
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByRole('link', { name: /past blogs/i }));
    expect(screen.getByTestId('past-tab')).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('closes the mobile drawer from the backdrop and tracks content scroll', () => {
    const { container } = render(
      <DashboardShell displayName="dev" displayDomain="x.com" footer={null} />,
    );
    fireEvent.click(screen.getByLabelText('Open menu'));
    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);

    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    Object.defineProperty(scroller, 'scrollHeight', { value: 200, configurable: true });
    fireEvent.scroll(scroller);
  });
});
