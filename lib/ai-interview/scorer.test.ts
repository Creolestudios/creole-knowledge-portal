import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

import { classifyWarningCriticality } from './scorer';

describe('scorer - classifyWarningCriticality', () => {
  it('classifies unauthorized devices, background voices, multi-face, and tab switches as critical', () => {
    expect(classifyWarningCriticality('cell_phone')).toBe('critical');
    expect(classifyWarningCriticality('object_detected', { object: 'cell phone' })).toBe('critical');
    expect(classifyWarningCriticality('unauthorized_voice')).toBe('critical');
    expect(classifyWarningCriticality('multi_face')).toBe('critical');
    expect(classifyWarningCriticality('tab_switch')).toBe('critical');
    expect(classifyWarningCriticality('window_blur')).toBe('critical');
    expect(classifyWarningCriticality('proctoring_violation')).toBe('critical');
  });

  it('classifies gaze away, reading suspected, and head turned away as mild', () => {
    expect(classifyWarningCriticality('gaze_away')).toBe('mild');
    expect(classifyWarningCriticality('reading_suspected')).toBe('mild');
    expect(classifyWarningCriticality('head_turned_away')).toBe('mild');
  });

  it('classifies framing issues and temporary face absences as basic', () => {
    expect(classifyWarningCriticality('no_face')).toBe('basic');
    expect(classifyWarningCriticality('framing_issue')).toBe('basic');
    expect(classifyWarningCriticality('unknown_minor_event')).toBe('basic');
  });
});
