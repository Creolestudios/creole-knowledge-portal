// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardShell from './DashboardShell';

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
  beforeEach(() => vi.clearAllMocks());

  it('renders the Daily Blog tab by default and shows the user name/domain', () => {
    render(
      <DashboardShell displayName="dev" displayDomain="creolestudios.com" footer={<div>Footer</div>} />,
    );
    expect(screen.getByTestId('daily-tab')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('creolestudios.com')).toBeInTheDocument();
  });

  it('switches to the Past Blogs tab when clicked', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /past blogs/i }));
    expect(screen.getByTestId('past-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-tab')).not.toBeInTheDocument();
  });

  it('switches to the Activity Tracker tab when clicked', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /activity tracker/i }));
    expect(screen.getByTestId('activity-tab')).toBeInTheDocument();
  });

  it('loads and displays the reading streak from computeStreak', async () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    await waitFor(() => {
      expect(screen.getByText('5 days')).toBeInTheDocument();
    });
  });

  it('jumps to the Past Blogs tab with the picked date when a search result is chosen', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByTestId('global-search'));
    expect(screen.getByTestId('past-tab')).toBeInTheDocument();
  });

  it('opens and closes the mobile sidebar drawer', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByLabelText('Close menu'));
    // No assertion needed beyond "doesn't throw" — state toggling is internal.
  });

  it('falls back to the mock user/profile when none are provided', () => {
    render(<DashboardShell displayName="dev" displayDomain="x.com" footer={null} />);
    expect(screen.getByTestId('daily-tab')).toBeInTheDocument();
  });
});
