import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST, PUT, DELETE } from './route';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

let mockDbData: any = [];
let mockDbError: any = null;

const createQueryBuilder = () => {
  const qb: any = {
    select: vi.fn(() => qb),
    insert: vi.fn(() => qb),
    update: vi.fn(() => qb),
    delete: vi.fn(() => qb),
    eq: vi.fn(() => qb),
    order: vi.fn(() => qb),
    single: vi.fn(() => Promise.resolve({ data: mockDbData, error: mockDbError })),
    then: (resolve: any) => resolve({ data: mockDbData, error: mockDbError }),
  };
  return qb;
};

const VALID_TITLE = 'Implement OAuth refresh token rotation';
const VALID_DESCRIPTION =
  'Implement OAuth refresh token rotation endpoint with secure Redis token storage. Handle automatic token revocation upon replay detection and validate expiry windows. Write integration tests for expired token handling and verify seamless session renewal on the client side without disrupting active authenticated user workflows.';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => createQueryBuilder()),
  },
}));

describe('/api/user/zoho/planned-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData = [];
    mockDbError = null;
  });

  describe('GET', () => {
    it('returns 401 Unauthorized if user is not logged in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks?date=2026-11-17');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns list of planned tasks for target date', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      mockDbData = [
        {
          id: 'tsk-1',
          task_name: 'Fix login bug',
          planned_hours: 3.0,
          task_date: '2026-11-17',
          sync_status: 'queued',
        },
      ];

      const req = new Request('http://localhost/api/user/zoho/planned-tasks?date=2026-11-17');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.tasks).toHaveLength(1);
      expect(json.tasks[0].task_name).toBe('Fix login bug');
    });
  });

  describe('POST', () => {
    it('returns 400 Bad Request if compulsory fields are missing', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'CKP',
          taskName: '', // empty title
          taskDescription: 'Valid description',
          plannedHours: 4,
          targetDate: '2026-11-17',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Task Title is compulsory');
    });

    it('returns 400 Bad Request if task description is missing', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'CKP',
          taskName: 'Valid title',
          taskDescription: '', // empty description
          plannedHours: 4,
          targetDate: '2026-11-17',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Task Description & Technical Scope is compulsory');
    });

    it('returns 400 Bad Request if task description has fewer than 40 words', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'CKP',
          taskName: VALID_TITLE,
          taskDescription: 'Too short description of five words.',
          plannedHours: 4,
          targetDate: '2026-11-17',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('At least 40 words are required');
    });

    it('returns 400 Bad Request if task title is vague', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'CKP',
          taskName: 'work',
          taskDescription: VALID_DESCRIPTION,
          plannedHours: 4,
          targetDate: '2026-11-17',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('too vague');
    });

    it('successfully inserts planned task with status queued into zoho_tasks', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const expectedTask = {
        id: 'tsk-999',
        task_name: VALID_TITLE,
        task_description: VALID_DESCRIPTION,
        planned_hours: 4.0,
        task_date: '2026-11-17',
        sync_status: 'queued',
        zoho_status: 'Planned',
      };
      mockDbData = expectedTask;

      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'Creole Knowledge Portal',
          zohoProjectId: 'proj-101',
          taskName: VALID_TITLE,
          taskDescription: VALID_DESCRIPTION,
          plannedHours: 4.0,
          targetDate: '2026-11-17',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.task.sync_status).toBe('queued');
      expect(json.task.task_name).toBe(VALID_TITLE);
    });
  });

  describe('PUT', () => {
    it('returns 401 Unauthorized if user is not logged in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'tsk-1' }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 Bad Request if task ID is missing for update', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'CKP',
          taskName: 'Updated title',
          taskDescription: 'Updated desc',
          plannedHours: 3,
        }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Task ID is compulsory');
    });

    it('returns 400 Bad Request if task title is missing during update', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'tsk-1',
          projectName: 'CKP',
          taskName: '',
          taskDescription: 'Updated desc',
          plannedHours: 3,
        }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Task Title is compulsory');
    });

    it('successfully updates queued planned task', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const updatedTask = {
        id: 'tsk-1',
        task_name: VALID_TITLE,
        task_description: VALID_DESCRIPTION,
        planned_hours: 5.0,
        task_date: '2026-11-17',
        sync_status: 'queued',
        zoho_status: 'Planned',
      };
      mockDbData = updatedTask;

      const req = new Request('http://localhost/api/user/zoho/planned-tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'tsk-1',
          projectName: 'CKP',
          zohoProjectId: 'proj-1',
          taskName: VALID_TITLE,
          taskDescription: VALID_DESCRIPTION,
          plannedHours: 5.0,
        }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.task.id).toBe('tsk-1');
      expect(json.task.task_name).toBe(VALID_TITLE);
      expect(json.task.planned_hours).toBe(5.0);
    });
  });

  describe('DELETE', () => {
    it('returns 400 Bad Request if task ID is missing', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks', { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('successfully deletes a queued task', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'usr-123' } } });
      const req = new Request('http://localhost/api/user/zoho/planned-tasks?id=tsk-1', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });
});

