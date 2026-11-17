import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';

vi.mock('../supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    })),
  },
}));

import {
  getISOWeekNumber,
  resolveUserSubtaskBucket,
  formatDateForZoho,
  syncQueuedPlannedTasks,
} from './planned-task-sync';

describe('Planned Task Sync Engine (Option B: Single Table)', () => {
  describe('Helper Functions', () => {
    it('calculates ISO week number correctly', () => {
      // 2026-11-16 is Monday of week 47
      const week = getISOWeekNumber('2026-11-16');
      expect(week).toBe(47);
    });

    it('formats date from YYYY-MM-DD to MM-DD-YYYY for Zoho API', () => {
      const formatted = formatDateForZoho('2026-11-17');
      expect(formatted).toBe('11-17-2026');
    });

    it('resolves direct named user subtask bucket', () => {
      const subtasks = [
        { id: 'sub-1', id_string: 'sub-1', name: 'srushti 10' },
        { id: 'sub-2', id_string: 'sub-2', name: 'krunal 10' },
        { id: 'sub-3', id_string: 'sub-3', name: 'others 20' },
      ];

      const bucket = resolveUserSubtaskBucket(subtasks, 'srushti');
      expect(bucket).toBeDefined();
      expect(bucket?.id).toBe('sub-1');
      expect(bucket?.isFallback).toBe(false);
    });

    it('falls back to others bucket when developer is not explicitly named', () => {
      const subtasks = [
        { id: 'sub-1', id_string: 'sub-1', name: 'priya 10' },
        { id: 'sub-2', id_string: 'sub-2', name: 'krunal 10' },
        { id: 'sub-3', id_string: 'sub-3', name: 'others 20' },
      ];

      // Aman is not in subtasks list
      const bucket = resolveUserSubtaskBucket(subtasks, 'aman');
      expect(bucket).toBeDefined();
      expect(bucket?.id).toBe('sub-3');
      expect(bucket?.name).toBe('others 20');
      expect(bucket?.isFallback).toBe(true);
    });
  });

  describe('syncQueuedPlannedTasks', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns empty result when no queued tasks exist in zoho_tasks', async () => {
      const result = await syncQueuedPlannedTasks('2026-11-17', { dryRun: true });
      expect(result.totalQueued).toBe(0);
      expect(result.syncedCount).toBe(0);
    });
  });
});
