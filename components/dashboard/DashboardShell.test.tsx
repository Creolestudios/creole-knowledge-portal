// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardShell from './DashboardShell';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: '/dashboard',
  tab: null as string | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.tab ? { tab: nav.tab } : {}),
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
  computeWeeklyStats: vi.fn().mockReturnValue({ daysRead: 3, quizzesSubmitted: 2, correctPct: 80, wrongPct: 20 }),
}));

vi.mock('@/lib/data/streak', () => ({
  computeStreak: vi.fn().mockReturnValue(5),
}));

vi.mock('./DailyBlogTab', () => ({ default: () => (<div data-testid="daily-tab" />) }));
vi.mock('./PastBlogsTab', () => ({ default: () => (<div data-testid="past-tab" />) }));
vi.mock('./ActivityTab', () => ({ default: () => (<div data-testid="activity-tab" />) }));
vi.mock('./SidebarActivityWidget', () => ({ default: () => (<div data-testid="sidebar-widget" />) }));
vi.mock('./GlobalSearch', () => ({
  default: ({ onPick }: { onPick: (date: string) => void }) => (
    <button data-testid="global-search" onClick={() => onPick('2026-08-01')}>
      Search
    </button>
  ),
}));

describe('DashboardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.pathname = '/dashboard';
    nav.tab = null;
  });

  it('renders the Daily Blog tab by default and shows the user name/domain', () => {
    render(
      <DashboardShell displayName="dev" displayDomain="creolestudios.com" footer={<div>Footer</div>} />,
    );
    expect(screen.getByTestId('daily-tab')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('creolestudios.com')).toBeInTheDocument();
  });

  it('shows Blog Roulette as the fourth sidebar option with the correct URL', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    const roulette = screen.getByRole('tab', { name: /blog roulette/i });
    expect(roulette).toBeInTheDocument();
    expect(roulette).toHaveAttribute('href', '/blog-roulette');
    expect(screen.getByRole('tab', { name: /daily blog/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('tab', { name: /past blogs/i })).toHaveAttribute(
      'href',
      '/dashboard?tab=past',
    );
    expect(screen.getByRole('tab', { name: /activity tracker/i })).toHaveAttribute(
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
    expect(screen.getByRole('tab', { name: /blog roulette/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('loads and displays the reading streak from computeStreak', async () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    await waitFor(() => {
      expect(screen.getByText('5 days')).toBeInTheDocument();
    });
  });

  it('navigates to Past Blogs with the picked date when a search result is chosen', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByTestId('global-search'));
    expect(nav.push).toHaveBeenCalledWith('/dashboard?tab=past&date=2026-08-01');
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
});
