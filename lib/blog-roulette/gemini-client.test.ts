import { describe, it, expect } from 'vitest';
import { fallbackQuizQuestions, fallbackGradeAnswers } from './gemini-client';

describe('fallbackQuizQuestions', () => {
  it('generates 3 questions referencing tech terms found in the text', () => {
    const text =
      'This post covers React and useEffect in depth. We built a Docker container ' +
      'to run the Node server, and used async functions throughout. The middleware ' +
      'validates JWT tokens before hitting the GraphQL API.';

    const questions = fallbackQuizQuestions(text);

    expect(questions).toHaveLength(3);
    for (const q of questions) {
      expect(q.q.length).toBeGreaterThan(0);
      expect(q.expected_topic.length).toBeGreaterThan(0);
    }
  });

  it('falls back to generic questions when no tech terms or long sentences are found', () => {
    const text = 'short. text. no terms.';
    const questions = fallbackQuizQuestions(text);

    expect(questions).toHaveLength(3);
    expect(questions[0].q).toMatch(/core technical challenge/i);
  });
});

describe('fallbackGradeAnswers', () => {
  const questions = [
    { q: 'Why did you use React hooks?', expected_topic: 'State management with useEffect' },
    { q: 'How did you configure Docker?', expected_topic: 'Container networking setup' },
  ];

  it('marks very short answers as incorrect', () => {
    const result = fallbackGradeAnswers(questions, ['ok', 'ok']);
    expect(result.correct).toBe(0);
    expect(result.per).toEqual([false, false]);
  });

  it('marks answers with keyword overlap as correct', () => {
    const result = fallbackGradeAnswers(questions, [
      'I used React hooks for state management purposes',
      'I set up Docker container networking carefully',
    ]);
    expect(result.correct).toBe(2);
    expect(result.per).toEqual([true, true]);
  });

  it('marks off-topic answers as incorrect even if long enough', () => {
    const result = fallbackGradeAnswers(questions, [
      'This has nothing whatsoever relevant inside it at all',
      'Totally unrelated content about cooking pasta dishes',
    ]);
    expect(result.correct).toBe(0);
    expect(result.per).toEqual([false, false]);
  });
});
