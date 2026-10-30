import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockDbTasks = [
  {
    id: 'db-task-1',
    zoho_task_id: 'zt-101',
    zoho_project_id: 'zp-201',
    project_name: 'Test Project',
    task_name: 'Implement Comments Mapping',
    task_description: 'Ensure user comments show up in modal',
    zoho_status: 'QA Review',
    is_qa_review: true,
    planned_hours: 4,
    actual_hours: 4.05,
    task_date: '2026-10-28',
    zoho_link: 'https://projects.zoho.com',
    zoho_task_comments: [
      {
        author_name: 'John Doe',
        comment_content: 'Tested the comments feature and confirmed working',
        comment_added_time: '2026-10-28T14:30:00.000Z',
      },
    ],
    zoho_task_evaluations: [
      {
        overall_score: 9.2,
        time_score: 10,
        comment_quality_score: 9.0,
        complexity_score: 8.5,
        repetition_score: 10,
        time_variance_minutes: 3,
        time_assessment_label: 'SLIGHT_OVERRUN_TOLERATED',
        summary_feedback: 'Well documented progress with comments',
      },
    ],
  },
];

let queryBuilderResult: { data: any; error: any } = { data: [], error: null };

vi.mock('@/lib/supabase/admin', () => {
  const queryBuilder: any = {
    select: vi.fn(() => queryBuilder),
    order: vi.fn(() => queryBuilder),
    eq: vi.fn(() => queryBuilder),
    or: vi.fn(() => queryBuilder),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (resolve: any) => resolve(queryBuilderResult),
  };
  return {
    supabaseAdmin: {
      from: vi.fn(() => queryBuilder),
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({
            data: { user: { id: 'user-123', email: 'jayesh.patel@creolestudios.com' } },
            error: null,
          })
        ),
      },
    })
  ),
}));

describe('User Zoho Evaluations API (/api/user/zoho/my-evaluations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryBuilderResult = { data: [], error: null };
  });

  it('returns read-only evaluation data for the authenticated employee', async () => {
    const req = new Request('http://localhost:3000/api/user/zoho/my-evaluations?type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.readOnly).toBe(true);
    expect(json.evaluation).toBeDefined();
    expect(json.evaluation.email).toBe('jayesh.patel@creolestudios.com');
    expect(json.evaluation.tillDateSummary).toBeDefined();
  });

  it('filters evaluation data by custom date range', async () => {
    const req = new Request('http://localhost:3000/api/user/zoho/my-evaluations?type=range&startDate=2026-10-01&endDate=2026-10-07');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.readOnly).toBe(true);
    expect(json.filter.range.start).toBe('2026-10-01');
    expect(json.filter.range.end).toBe('2026-10-07');
    expect(json.evaluation).toBeDefined();
  });

  it('correctly maps user comments and evaluations from database tasks', async () => {
    queryBuilderResult = { data: mockDbTasks, error: null };
    const req = new Request('http://localhost:3000/api/user/zoho/my-evaluations?type=range&startDate=2026-10-25&endDate=2026-10-31');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.evaluation).toBeDefined();
    expect(json.evaluation.dailyEvaluations).toHaveLength(1);

    const day = json.evaluation.dailyEvaluations[0];
    expect(day.date).toBe('2026-10-28');
    expect(day.tasks).toHaveLength(1);

    const task = day.tasks[0];
    expect(task.taskName).toBe('Implement Comments Mapping');
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].author).toBe('John Doe');
    expect(task.comments[0].content).toBe('Tested the comments feature and confirmed working');
    expect(task.evaluation).toBeDefined();
    expect(task.evaluation.overallScore).toBe(9.2);
  });
});
