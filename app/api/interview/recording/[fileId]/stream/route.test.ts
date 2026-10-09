import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { Readable } from 'stream';

const mockGet = vi.fn();
const mockDrive = {
  files: {
    get: mockGet,
  },
};

vi.mock('@/lib/ai-interview/google-drive-recorder', () => ({
  getDriveClient: () => mockDrive,
  getDriveCredentials: () => ({ client_email: 'test@example.com', private_key: 'key' }),
}));

describe('GET /api/interview/recording/[fileId]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for missing or invalid fileId', async () => {
    const req = new NextRequest('http://localhost/api/interview/recording/drive_file/stream');
    const res = await GET(req, { params: Promise.resolve({ fileId: 'drive_file' }) });
    expect(res.status).toBe(400);
  });

  it('streams full video with status 200 when no range header is requested', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: { id: 'file-123', size: '1000', mimeType: 'video/webm' },
      })
      .mockResolvedValueOnce({
        data: Readable.from([Buffer.from('video data')]),
      });

    const req = new NextRequest('http://localhost/api/interview/recording/file-123/stream');
    const res = await GET(req, { params: Promise.resolve({ fileId: 'file-123' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/webm');
    expect(res.headers.get('Content-Length')).toBe('1000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('returns status 206 Partial Content when Range header is provided', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: { id: 'file-123', size: '5000', mimeType: 'video/webm' },
      })
      .mockResolvedValueOnce({
        data: Readable.from([Buffer.from('chunk')]),
      });

    const req = new NextRequest('http://localhost/api/interview/recording/file-123/stream', {
      headers: { range: 'bytes=100-200' },
    });
    const res = await GET(req, { params: Promise.resolve({ fileId: 'file-123' }) });

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Type')).toBe('video/webm');
    expect(res.headers.get('Content-Range')).toBe('bytes 100-200/5000');
    expect(res.headers.get('Content-Length')).toBe('101');
  });
});
