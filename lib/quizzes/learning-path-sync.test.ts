import { describe, it, expect } from 'vitest';
import {
  buildLearningPathQuizPayload,
  buildTopicVocabulary,
  topicTokensFromText,
} from './learning-path-sync';

describe('buildTopicVocabulary', () => {
  it('normalizes user-filled stack terms', () => {
    expect(buildTopicVocabulary(['Next.js', 'React', '  '])).toEqual(
      expect.arrayContaining(['next.js', 'nextjs', 'react']),
    );
  });
});

describe('topicTokensFromText', () => {
  it('matches only against the user vocabulary', () => {
    const vocab = buildTopicVocabulary(['React', 'TypeScript', 'Next.js']);
    expect(topicTokensFromText('How does React use TypeScript with Next.js?', vocab)).toEqual(
      expect.arrayContaining(['react', 'typescript', 'next.js']),
    );
    expect(topicTokensFromText('What is Docker?', vocab)).toEqual([]);
  });
});

describe('buildLearningPathQuizPayload', () => {
  it('aggregates weak and next topics using the user profile terms', () => {
    const payload = buildLearningPathQuizPayload(
      'blog-1',
      [
        {
          id: 'a1',
          status: 'completed',
          score: 1,
          percentage: 20,
          passed: false,
          attempt_number: 1,
          quiz_answers: [
            { question_id: 'q1', is_correct: false },
            { question_id: 'q2', is_correct: true },
          ],
        },
        {
          id: 'a2',
          status: 'completed',
          score: 4,
          percentage: 80,
          passed: true,
          attempt_number: 2,
          quiz_answers: [
            { question_id: 'q1', is_correct: true },
            { question_id: 'q3', is_correct: false },
          ],
        },
      ],
      [
        { id: 'q1', question: 'Explain React hooks' },
        { id: 'q2', question: 'What is Docker?' },
        { id: 'q3', question: 'Tune Redis caching' },
      ],
      4,
      5,
      true,
      ['React', 'Docker', 'Redis'],
    );

    expect(payload.blog_id).toBe('blog-1');
    expect(payload.passed).toBe(true);
    expect(payload.percentage).toBe(80);
    expect(payload.attempt_number).toBe(2);
    expect(payload.weak_topics).toEqual(expect.arrayContaining(['react', 'redis']));
    expect(payload.next_step_topics).toEqual(expect.arrayContaining(['docker', 'react']));
  });

  it('falls back to profile stack when questions do not mention those terms', () => {
    const payload = buildLearningPathQuizPayload(
      'blog-1',
      [
        {
          id: 'a1',
          status: 'completed',
          score: 0,
          percentage: 0,
          passed: false,
          attempt_number: 1,
          quiz_answers: [{ question_id: 'q1', is_correct: false }],
        },
      ],
      [{ id: 'q1', question: 'Explain event loop fairness heuristics' }],
      0,
      5,
      false,
      ['Flutter', 'Dart'],
    );

    expect(payload.weak_topics).toEqual(expect.arrayContaining(['flutter', 'dart']));
  });

  it('mines question keywords into weak_topics when profile stack is empty', () => {
    const payload = buildLearningPathQuizPayload(
      'blog-1',
      [
        {
          id: 'a1',
          status: 'completed',
          score: 0,
          percentage: 0,
          passed: false,
          attempt_number: 1,
          quiz_answers: [{ question_id: 'q1', is_correct: false }],
        },
      ],
      [{ id: 'q1', question: 'Explain Redis caching with Python workers' }],
      0,
      5,
      false,
      [],
    );

    expect(payload.weak_topics.length).toBeGreaterThan(0);
    expect(payload.weak_topics).toEqual(
      expect.arrayContaining(['redis', 'caching', 'python', 'workers']),
    );
  });
});
