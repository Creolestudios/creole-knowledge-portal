import { describe, it, expect } from 'vitest';
import {
  generatePlannedTasksAdminEmail,
  PlannedTasksAdminEmailPayload,
} from './planned-tasks-admin-email';

describe('generatePlannedTasksAdminEmail', () => {
  const samplePayload: PlannedTasksAdminEmailPayload = {
    date: '2026-11-23',
    totalTasks: 8,
    totalUsers: 5,
    zeroCountUsers: 1,
    users: [
      { userName: 'Priya Sharma', taskCount: 3 },
      { userName: 'Srushti Amin', taskCount: 2 },
      { userName: 'Jayesh Patel', taskCount: 2 },
      { userName: 'Aman Joshi', taskCount: 1 },
      { userName: 'Krunal Shah', taskCount: 0 },
    ],
    portalUrl: 'https://ckp.creolestudios.com',
  };

  it('generates email subject with date and total tasks', () => {
    const { subject } = generatePlannedTasksAdminEmail(samplePayload);
    expect(subject).toContain('2026-11-23');
    expect(subject).toContain('8 Tasks');
  });

  it('renders strictly two columns: User Name and Task Count without emails or hours', () => {
    const { html, text } = generatePlannedTasksAdminEmail(samplePayload);

    // Verify 2-column header
    expect(html).toContain('User Name');
    expect(html).toContain('Task Count');

    // Verify User Names are present
    expect(html).toContain('Priya Sharma');
    expect(html).toContain('Srushti Amin');
    expect(html).toContain('Krunal Shah');

    // Verify no email addresses or hours are present in the table
    expect(html).not.toContain('@creolestudios.com');
    expect(html).not.toContain('4.0h');
    expect(html).not.toContain('2.0h');
    expect(text).not.toContain('@creolestudios.com');
  });

  it('accurately displays 0 for users with no tasks', () => {
    const { html, text } = generatePlannedTasksAdminEmail(samplePayload);

    // Krunal Shah has 0 tasks
    expect(html).toContain('Krunal Shah');
    expect(html).toContain('>0</span>');
    expect(text).toContain('Krunal Shah');
    expect(text).toContain(': 0');
  });

  it('does not render duplicate sync messages in header badge or date pill, nor open dashboard button', () => {
    const { html, text } = generatePlannedTasksAdminEmail(samplePayload);

    // Header sync badge and date bar sync label are removed
    expect(html).not.toContain('8:45 AM SYNC');
    expect(html).not.toContain('Synced: 08:45 AM IST');
    // Subtitle under title remains
    expect(html).toContain('Automatic 8:45 AM Zoho Projects Ingestion Report');
    // Open Zoho Admin Dashboard button is removed
    expect(html).not.toContain('Open Zoho Admin Dashboard');
    expect(text).not.toContain('Dashboard Link:');
  });

  it('divides users into two side-by-side tables for better dashboard UI', () => {
    const { html } = generatePlannedTasksAdminEmail(samplePayload);

    // 5 sample users split into ceil(5/2) = 3 and 2
    // Both columns exist in the layout
    expect(html).toContain('width="48.5%"');
    expect(html).toContain('User Name');
    expect(html).toContain('Task Count');
  });

  it('handles empty user list gracefully', () => {
    const emptyPayload: PlannedTasksAdminEmailPayload = {
      date: '2026-11-23',
      totalTasks: 0,
      totalUsers: 0,
      zeroCountUsers: 0,
      users: [],
    };

    const { html, text } = generatePlannedTasksAdminEmail(emptyPayload);
    expect(html).toContain('No developer tasks recorded');
    expect(text).toContain('No developer tasks recorded');
  });
});
