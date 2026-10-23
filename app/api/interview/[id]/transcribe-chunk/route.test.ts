import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAdminUser, mockTranscribeAudioChunk } = vi.hoisted(() => {
  const mockRequireAdminUser = vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@creole.com' });
  const mockTranscribeAudioChunk = vi.fn(async () => 'I have three years experience in React.' as string | null);

  return { mockRequireAdminUser, mockTranscribeAudioChunk };
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: mockRequireAdminUser,
  supabaseAdmin: {},
}));

vi.mock('@/lib/ai-interview/transcribe', () => ({
  transcribeAudioChunk: mockTranscribeAudioChunk,
}));

vi.mock('@/lib/ai-interview/invite-token', () => ({
  resolveInterviewSessionId: async (id: string) => id,
}));

import { POST } from './route';

function makeParams(id = 'sess-1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/interview/[id]/transcribe-chunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates required session ID', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['audio-data'], { type: 'audio/webm' }), 'chunk.webm');

    const req = new NextRequest('http://localhost/api/interview//transcribe-chunk', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, makeParams(''));
    expect(res.status).toBe(400);
  });

  it('returns transcribed text from live audio snippet', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['candidate-speaking'], { type: 'audio/webm' }), 'chunk.webm');

    const req = new NextRequest('http://localhost/api/interview/sess-1/transcribe-chunk', {
      method: 'POST',
      body: formData,
      headers: {
        cookie: 'interview_verified_id=sess-1',
      },
    });

    const res = await POST(req, makeParams('sess-1'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.text).toBe('I have three years experience in React.');
    expect(mockTranscribeAudioChunk).toHaveBeenCalledTimes(1);
  });

  it('returns empty text gracefully if audio snippet contains no speech', async () => {
    mockTranscribeAudioChunk.mockResolvedValueOnce(null);

    const formData = new FormData();
    formData.append('file', new Blob(['silence'], { type: 'audio/webm' }), 'chunk.webm');

    const req = new NextRequest('http://localhost/api/interview/sess-1/transcribe-chunk', {
      method: 'POST',
      body: formData,
      headers: {
        cookie: 'interview_verified_id=sess-1',
      },
    });

    const res = await POST(req, makeParams('sess-1'));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.text).toBe('');
  });

  it('returns 415 for unsupported audio mime types', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['data'], { type: 'video/mp4' }), 'video.mp4');

    const req = new NextRequest('http://localhost/api/interview/sess-1/transcribe-chunk', {
      method: 'POST',
      body: formData,
      headers: {
        cookie: 'interview_verified_id=sess-1',
      },
    });

    const res = await POST(req, makeParams('sess-1'));
    expect(res.status).toBe(415);
  });
});
