// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AdminInterviewReportPage from './page';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getInterviewReport } from '@/lib/ai-interview/report-store';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/ai-interview/report-store', () => ({
  getInterviewReport: vi.fn(),
}));

vi.mock('@/lib/ai-interview/scorer', () => ({
  scoreInterviewSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

describe('AdminInterviewReportPage - Exact Warning Timestamps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accurately calculates warning video offsets when warning was displayed on screen', async () => {
    const mockSession = {
      id: 'session-screen-toast-test',
      candidate_name: 'Test Candidate',
      candidate_email: 'candidate@test.com',
      status: 'terminated',
      created_at: '2026-10-09T10:24:02.000Z',
      updated_at: '2026-10-09T10:27:00.000Z',
      parsed_jd: null,
      parsed_resume: null,
      voice_warning_count: 2,
      face_warning_count: 1,
      object_warning_count: 0,
    };

    const actualRecorderStartTime = 1791541521895; // 10:25:21.895 - when screen recording started
    const strike1Time = 1791541551458; // 10:25:51.458 - warning toast shown on screen (+29.56s -> 00:29)
    const strike2Time = 1791541569830; // 10:26:09.830 - warning toast shown on screen (+47.93s -> 00:47)
    const strike3Time = 1791541574542; // 10:26:14.542 - warning toast shown on screen (+52.64s -> 00:52)

    const mockEvents = [
      {
        id: 'evt-rec-start',
        session_id: 'session-screen-toast-test',
        event_type: 'recording_started',
        category: 'recording_started',
        severity: 'info',
        ts_ms: actualRecorderStartTime + 29551,
        created_at: new Date(actualRecorderStartTime + 29551).toISOString(),
        meta: { startedAt: actualRecorderStartTime },
      },
      {
        id: 'strike-1',
        session_id: 'session-screen-toast-test',
        event_type: 'unauthorized_voice',
        category: 'unauthorized_voice',
        severity: 'warning',
        ts_ms: strike1Time,
        created_at: new Date(strike1Time).toISOString(),
        metadata: { reason: 'Background voice detected', strikeNumber: 1 },
        meta: { reason: 'Background voice detected', strikeNumber: 1 },
      },
      {
        id: 'strike-2',
        session_id: 'session-screen-toast-test',
        event_type: 'gaze_away',
        category: 'gaze_away',
        severity: 'warning',
        ts_ms: strike2Time,
        created_at: new Date(strike2Time).toISOString(),
        metadata: { reason: 'Please keep your attention focused on the interview screen.', strikeNumber: 2 },
        meta: { reason: 'Please keep your attention focused on the interview screen.', strikeNumber: 2 },
      },
      {
        id: 'strike-3',
        session_id: 'session-screen-toast-test',
        event_type: 'unauthorized_voice',
        category: 'unauthorized_voice',
        severity: 'warning',
        ts_ms: strike3Time,
        created_at: new Date(strike3Time).toISOString(),
        metadata: { reason: 'Background voice detected', strikeNumber: 3 },
        meta: { reason: 'Background voice detected', strikeNumber: 3 },
      },
      {
        id: 'evt-full-rec',
        session_id: 'session-screen-toast-test',
        event_type: 'full_recording',
        category: 'full_recording',
        severity: 'info',
        ts_ms: 1791541624138,
        created_at: '2026-10-09T10:27:04.138Z',
        meta: {
          fileId: 'test-drive-file',
          durationSeconds: 90,
          recordingStartTime: actualRecorderStartTime,
          webViewLink: 'https://drive.google.com/file/d/test-drive-file/view',
        },
      },
    ];

    const mockReport = {
      executive_summary: 'Evaluation completed.',
      recommendation: 'no',
      recommendation_rationale: 'Terminated due to 3 strikes.',
      flags: ['interview_terminated'],
    };

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockSession }),
            }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: mockEvents }),
            }),
          }),
        };
      }
      if (table === 'interview_transcript' || table === 'interview_questions' || table === 'interview_answers') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [] }),
              then: (fn: any) => fn({ data: [] }),
            }),
          }),
        };
      }
      if (table === 'interview_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'inv-1', status: 'revoked' } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      };
    });

    (getInterviewReport as any).mockResolvedValue(mockReport);

    const PageComponent = await AdminInterviewReportPage({
      params: Promise.resolve({ id: 'session-screen-toast-test' }),
    });

    render(PageComponent);

    // Strike 1 banner was shown on screen at +29.56s -> exact 00:29 video offset
    expect(screen.getByText(/Jump directly to 00:29 in Video/i)).toBeInTheDocument();
    
    // Strike 2 banner was shown on screen at +47.93s -> exact 00:47 video offset
    expect(screen.getByText(/Jump directly to 00:47 in Video/i)).toBeInTheDocument();

    // Strike 3 banner was shown on screen at +52.64s -> exact 00:52 video offset
    expect(screen.getByText(/Jump directly to 00:52 in Video/i)).toBeInTheDocument();

    // Google Drive direct links target the exact second where warning was shown (?t=29s, ?t=47s, ?t=52s)
    const driveLinks = screen.getAllByRole('link', { name: /^Google Drive/i });
    expect(driveLinks[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/test-drive-file/view?t=29s');
    expect(driveLinks[1]).toHaveAttribute('href', 'https://drive.google.com/file/d/test-drive-file/view?t=47s');
    expect(driveLinks[2]).toHaveAttribute('href', 'https://drive.google.com/file/d/test-drive-file/view?t=52s');
  });

  it('respects direct client-provided offsetSeconds when available', async () => {
    const mockSession = {
      id: 'session-direct-offset-test',
      candidate_name: 'Test Candidate',
      candidate_email: 'candidate@test.com',
      status: 'terminated',
      created_at: '2026-10-09T10:24:02.000Z',
      voice_warning_count: 1,
      face_warning_count: 0,
      object_warning_count: 0,
    };

    const mockEvents = [
      {
        id: 'strike-direct-1',
        session_id: 'session-direct-offset-test',
        event_type: 'unauthorized_voice',
        category: 'unauthorized_voice',
        severity: 'warning',
        ts_ms: Date.now(),
        created_at: new Date().toISOString(),
        meta: {
          reason: 'Secondary speech detected.',
          strikeNumber: 1,
          offsetSeconds: 42,
        },
      },
      {
        id: 'evt-full-rec-2',
        session_id: 'session-direct-offset-test',
        event_type: 'full_recording',
        category: 'full_recording',
        severity: 'info',
        ts_ms: Date.now(),
        created_at: new Date().toISOString(),
        meta: {
          fileId: 'drive-file-direct',
          durationSeconds: 120,
          webViewLink: 'https://drive.google.com/file/d/drive-file-direct/view',
        },
      },
    ];

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockSession }),
            }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: mockEvents }),
            }),
          }),
        };
      }
      if (table === 'interview_transcript' || table === 'interview_questions' || table === 'interview_answers') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [] }),
              then: (fn: any) => fn({ data: [] }),
            }),
          }),
        };
      }
      if (table === 'interview_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'inv-1', status: 'revoked' } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      };
    });

    (getInterviewReport as any).mockResolvedValue({
      executive_summary: 'Report summary',
      recommendation: 'no',
      flags: [],
    });

    const PageComponent = await AdminInterviewReportPage({
      params: Promise.resolve({ id: 'session-direct-offset-test' }),
    });

    render(PageComponent);

    // Directly recorded 42 seconds -> 00:42
    expect(screen.getByText(/Jump directly to 00:42 in Video/i)).toBeInTheDocument();
    const driveLinks = screen.getAllByRole('link', { name: /^Google Drive/i });
    expect(driveLinks[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-file-direct/view?t=42s');
  });

  it('attaches accurate timestamps to all three strikes and avoids debouncing distinct strikes in quick succession', async () => {
    const sessionStart = 1791540000000; // 10:00:00
    const recStart = 1791540005000;    // 10:00:05
    const strike1Time = 1791540085000;  // 10:01:25 (+80s -> 01:20)
    const strike2Time = 1791540087000;  // 10:01:27 (+82s -> 01:22, exactly 2s after strike 1!)
    const strike3Time = 1791540135000;  // 10:02:15 (+130s -> 02:10)

    const mockSession = {
      id: 'session-three-strikes-timestamps',
      candidate_name: 'Alex Rivera',
      candidate_email: 'alex@example.com',
      status: 'terminated',
      created_at: new Date(sessionStart).toISOString(),
      voice_warning_count: 2,
      face_warning_count: 1,
      object_warning_count: 0,
    };

    const mockEvents = [
      {
        id: 'evt-rec-start',
        session_id: 'session-three-strikes-timestamps',
        event_type: 'recording_started',
        category: 'recording_started',
        severity: 'info',
        ts_ms: recStart,
        created_at: new Date(recStart).toISOString(),
        meta: { startedAt: recStart },
      },
      {
        id: 'strike-1',
        session_id: 'session-three-strikes-timestamps',
        event_type: 'unauthorized_voice',
        category: 'unauthorized_voice',
        severity: 'warning',
        ts_ms: strike1Time,
        created_at: new Date(strike1Time).toISOString(),
        // direct offset was 0 due to recorder startup delay; must fallback to computed elapsed time (01:20)
        meta: { reason: 'Secondary speaker detected', strikeNumber: 1, screenToastOffsetSec: 0, client_ts: strike1Time },
      },
      {
        id: 'strike-2',
        session_id: 'session-three-strikes-timestamps',
        event_type: 'unauthorized_voice',
        category: 'unauthorized_voice',
        severity: 'warning',
        ts_ms: strike2Time,
        created_at: new Date(strike2Time).toISOString(),
        // 2 seconds later with strikeNumber 2: must NEVER be debounced!
        meta: { reason: 'Secondary speaker detected', strikeNumber: 2, screenToastOffsetSec: 82, client_ts: strike2Time },
      },
      {
        id: 'strike-3',
        session_id: 'session-three-strikes-timestamps',
        event_type: 'gaze_away',
        category: 'gaze_away',
        severity: 'warning',
        ts_ms: strike3Time,
        created_at: new Date(strike3Time).toISOString(),
        meta: { reason: 'Looking away from screen', strikeNumber: 3, screenToastOffsetSec: 130, client_ts: strike3Time },
      },
      {
        id: 'evt-full-rec',
        session_id: 'session-three-strikes-timestamps',
        event_type: 'full_recording',
        category: 'full_recording',
        severity: 'info',
        ts_ms: strike3Time + 5000,
        created_at: new Date(strike3Time + 5000).toISOString(),
        meta: {
          fileId: 'three-strike-drive-file',
          durationSeconds: 150,
          recordingStartTime: recStart,
          webViewLink: 'https://drive.google.com/file/d/three-strike-drive-file/view',
        },
      },
    ];

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_sessions') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: mockSession }) }) }) };
      }
      if (table === 'interview_events') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: mockEvents }) }) }) };
      }
      if (table === 'interview_invites') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'inv-3', status: 'revoked' } }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }), order: async () => ({ data: [] }), then: (fn: any) => fn({ data: [] }) }) }),
      };
    });

    (getInterviewReport as any).mockResolvedValue({
      executive_summary: 'Report summary',
      recommendation: 'no',
      flags: [],
    });

    const PageComponent = await AdminInterviewReportPage({
      params: Promise.resolve({ id: 'session-three-strikes-timestamps' }),
    });

    render(PageComponent);

    // All three distinct strikes are present with accurate timestamps:
    expect(screen.getByText('Strike 1')).toBeInTheDocument();
    expect(screen.getByText('Strike 2')).toBeInTheDocument();
    expect(screen.getByText('Strike 3')).toBeInTheDocument();

    // Strike 1 recovered from 0s directOffsetSec to computed elapsed time 01:20
    expect(screen.getByText(/Jump directly to 01:20 in Video/i)).toBeInTheDocument();

    // Strike 2 was NOT dropped by debounce, shows exact 01:22
    expect(screen.getByText(/Jump directly to 01:22 in Video/i)).toBeInTheDocument();

    // Strike 3 shows exact 02:10
    expect(screen.getByText(/Jump directly to 02:10 in Video/i)).toBeInTheDocument();

    // Google Drive direct links target exact video seconds
    const driveLinks = screen.getAllByRole('link', { name: /^Google Drive/i });
    expect(driveLinks).toHaveLength(3);
    expect(driveLinks[0]).toHaveAttribute('href', 'https://drive.google.com/file/d/three-strike-drive-file/view?t=1m20s');
    expect(driveLinks[1]).toHaveAttribute('href', 'https://drive.google.com/file/d/three-strike-drive-file/view?t=1m22s');
    expect(driveLinks[2]).toHaveAttribute('href', 'https://drive.google.com/file/d/three-strike-drive-file/view?t=2m10s');
  });
});
