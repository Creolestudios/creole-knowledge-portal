import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { state, mockRequireAdminUser, mockFrom, mockUpload, mockInsert, mockUpdate, mockTranscribe } = vi.hoisted(() => {
  const state = {
    question: { id: 'q1' } as { id: string } | null,
    questionError: null as { message: string } | null,
    uploadError: null as { message: string } | null,
    saveError: null as { message: string } | null,
    existingAnswer: null as { id: string } | null,
  };

  const mockRequireAdminUser = vi.fn().mockResolvedValue(null);
  const mockUpload = vi.fn(async () => ({ error: state.uploadError }));
  const mockInsert = vi.fn(async () => ({ error: state.saveError }));
  const mockUpdate = vi.fn(() => ({ eq: async () => ({ error: state.saveError }) }));
  const mockTranscribe = vi.fn(async () => 'I built the payments service.' as string | null);

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_questions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: state.question, error: state.questionError }),
            }),
          }),
        }),
      };
    }
    if (table === 'interview_answers') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.existingAnswer, error: null }) }),
          }),
        }),
        insert: mockInsert,
        update: mockUpdate,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { state, mockRequireAdminUser, mockFrom, mockUpload, mockInsert, mockUpdate, mockTranscribe };
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: mockRequireAdminUser,
  supabaseAdmin: {
    from: mockFrom,
    storage: { from: () => ({ upload: mockUpload }) },
  },
}));

vi.mock('@/lib/ai-interview/transcribe', () => ({ transcribeAnswer: mockTranscribe }));

import { POST } from './route';

function makeParams(id = 'sess-1') {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(
  fields: Record<string, string> = {},
  file: Blob | null = new Blob(['audio-bytes'], { type: 'audio/webm;codecs=opus' }),
  cookieValue: string | null = 'sess-1'
): NextRequest {
  const formData = new FormData();
  formData.append('questionId', 'q1');
  formData.append('startedAtMs', '1000');
  formData.append('endedAtMs', '13000');
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  if (file) formData.append('file', file, 'answer');

  const req = new NextRequest('http://localhost/api/interview/sess-1/answers', {
    method: 'POST',
    body: formData,
  });
  if (cookieValue) req.cookies.set('interview_verified_id', cookieValue);
  return req;
}

describe('POST /api/interview/[id]/answers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.question = { id: 'q1' };
    state.questionError = null;
    state.uploadError = null;
    state.saveError = null;
    state.existingAnswer = null;
    mockRequireAdminUser.mockResolvedValue(null);
    mockTranscribe.mockResolvedValue('I built the payments service.');
  });

  it('rejects a candidate whose verification cookie does not match the interview', async () => {
    const res = await POST(makeRequest({}, undefined, 'another-session'), makeParams());
    expect(res.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('allows an admin without the verification cookie', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await POST(makeRequest({}, undefined, null), makeParams());
    expect(res.status).toBe(200);
  });

  it('returns 400 when the audio file is missing', async () => {
    const res = await POST(makeRequest({}, null), makeParams());
    expect(res.status).toBe(400);
  });

  it('rejects an audio format the bucket does not accept', async () => {
    const res = await POST(makeRequest({}, new Blob(['x'], { type: 'audio/wav' })), makeParams());
    expect(res.status).toBe(415);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects a question that belongs to a different interview', async () => {
    state.question = null;
    state.questionError = { message: 'no rows' };

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('stores the audio and the transcript against the question', async () => {
    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, transcribed: true });

    expect(mockUpload).toHaveBeenCalledWith(
      'sess-1/q1.webm',
      expect.any(Buffer),
      { contentType: 'audio/webm', upsert: true }
    );
    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm');
    expect(mockInsert).toHaveBeenCalledWith({
      session_id: 'sess-1',
      question_id: 'q1',
      transcript: 'I built the payments service.',
      audio_storage_path: 'sess-1/q1.webm',
      total_time_taken_sec: 12,
    });
  });

  it('replaces the previous take when the candidate re-answers a question', async () => {
    state.existingAnswer = { id: 'answer-1' };

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ question_id: 'q1', transcript: 'I built the payments service.' })
    );
  });

  it('keeps the recording when transcription fails, saving the answer without a transcript', async () => {
    mockTranscribe.mockRejectedValue(new Error('gemini quota exceeded'));

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, transcribed: false });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: null, audio_storage_path: 'sess-1/q1.webm' })
    );
  });

  it('falls back to a zero duration when the timing fields are not usable', async () => {
    await POST(makeRequest({ startedAtMs: 'not-a-number' }), makeParams());

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ total_time_taken_sec: 0 }));
  });

  it('returns 500 when the audio upload fails', async () => {
    state.uploadError = { message: 'bucket unavailable' };

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 500 when the answer row cannot be saved', async () => {
    state.saveError = { message: 'constraint violation' };

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(500);
  });
});
