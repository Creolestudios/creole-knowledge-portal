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
});
