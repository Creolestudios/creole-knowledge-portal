import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const mockProcessZohoWebhookTask = vi.fn();
const mockSyncLiveZohoTasks = vi.fn();

vi.mock('@/lib/zoho/sync', () => ({
  processZohoWebhookTask: (...args: any[]) => mockProcessZohoWebhookTask(...args),
  syncLiveZohoTasks: (...args: any[]) => mockSyncLiveZohoTasks(...args),
}));

describe('Zoho Webhooks API (/api/webhooks/zoho)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessZohoWebhookTask.mockResolvedValue({ success: true, message: 'ok' });
    mockSyncLiveZohoTasks.mockResolvedValue({ success: true });
  });

  it('GET handles challenge verification query', async () => {
    const req = new Request('http://localhost:3000/api/webhooks/zoho?challenge=123456');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('active');
    expect(json.challenge).toBe('123456');
  });

  it('POST ingests task webhook payload and responds with 200 OK', async () => {
    const body = {
      action: 'task_created',
      task: {
        id: '56869000008177845',
        name: 'Live task from webhook',
        duration: '4:00',
      },
    };
    const req = new Request('http://localhost:3000/api/webhooks/zoho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockProcessZohoWebhookTask).toHaveBeenCalledWith(body);
    expect(mockSyncLiveZohoTasks).toHaveBeenCalledWith(true);
  });
});
