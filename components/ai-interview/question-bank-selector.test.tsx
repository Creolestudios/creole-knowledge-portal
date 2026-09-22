// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuestionBankSelector } from './question-bank-selector';
import { SessionGenerationError } from '@/lib/ai-interview/create-session-and-invite';
import type { ExtractionResult } from '@/lib/ai-interview/types';

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
}));

vi.mock('@/lib/ai-interview/create-session-and-invite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-interview/create-session-and-invite')>(
    '@/lib/ai-interview/create-session-and-invite',
  );
  return { ...actual, createInterviewSessionWithInvite: mockCreateSession };
});

const bankRows = [
  { id: 'b1', title: 'HR 1', question_text: 'Introduce yourself.', category: 'hr', difficulty: 'easy', is_mandatory: true, default_order: 1 },
  { id: 'b2', title: 'HR 2', question_text: 'What matters to you?', category: 'hr', difficulty: 'easy', is_mandatory: false, default_order: 2 },
  { id: 'b3', title: 'Team 1', question_text: 'Describe teamwork.', category: 'teamwork', difficulty: 'medium', is_mandatory: false, default_order: 1 },
];

const extraction: ExtractionResult = {
  candidateProfile: { name: 'Jane', extractedSkills: ['React', 'TypeScript'], domains: ['Web'] },
  jdRequirements: { mustHaveSkills: ['React'], niceToHaveSkills: [], keyResponsibilities: [] },
  analysis: {
    matchPercentage: 80,
    matchedKeywords: ['React', 'TypeScript'],
    missingKeywords: ['Node.js'],
    resumeOnlyKeywords: [],
    skillGapSummary: '',
    keyStrengths: [],
    improvementAreas: [],
  },
  extractedAt: new Date().toISOString(),
};

describe('QuestionBankSelector', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('generate-questions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              questions: [
                {
                  question_text: 'How do you structure React state for scale?',
                  category: 'technical',
                  difficulty: 'medium',
                  intent: 'State Management',
                },
                {
                  question_text: 'How do you approach debugging complex TypeScript generics?',
                  category: 'technical',
                  difficulty: 'hard',
                  intent: 'Type Safety',
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ questions: bankRows }) });
      }),
    );
    mockCreateSession.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads categories from the bank and reveals questions when a category is selected', async () => {
    render(<QuestionBankSelector extraction={extraction} onComplete={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());
    expect(screen.queryByText('Introduce yourself.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('hr'));
    await waitFor(() => expect(screen.getByText('Introduce yourself.')).toBeInTheDocument());
    expect(screen.getByText('What matters to you?')).toBeInTheDocument();
  });

  it('disables Generate until the selected count matches the configured question count', async () => {
    render(<QuestionBankSelector extraction={extraction} onComplete={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Total question count/i), { target: { value: '2' } });
    fireEvent.click(screen.getByText('hr'));
    await waitFor(() => expect(screen.getByText('Introduce yourself.')).toBeInTheDocument());

    const generateButton = screen.getByText('Generate Interview Link');
    expect(generateButton).toBeDisabled();

    fireEvent.click(screen.getByText('Introduce yourself.'));
    expect(generateButton).toBeDisabled();

    fireEvent.click(screen.getByText('What matters to you?'));
    await waitFor(() => expect(generateButton).not.toBeDisabled());
  });

  it('requires low-match confirmation before enabling Generate when match is below 70%', async () => {
    const lowMatchExtraction = {
      ...extraction,
      analysis: { ...extraction.analysis, matchPercentage: 40 },
    };
    render(<QuestionBankSelector extraction={lowMatchExtraction} onComplete={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    await waitFor(() => expect(screen.getByText('Introduce yourself.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Introduce yourself.'));

    const generateButton = screen.getByText('Generate Interview Link');
    expect(generateButton).toBeDisabled();

    fireEvent.click(screen.getByText(/below the 70% recommended threshold/i));
    await waitFor(() => expect(generateButton).not.toBeDisabled());
  });

  it('on confirm: calls createInterviewSessionWithInvite with the selected question-bank IDs', async () => {
    const sessionResult = {
      extraction,
      session: { id: 's1', status: 'questions_generated' },
      questions: [{ id: 'q1', question_text: 'Introduce yourself.' }],
      invite: { invite_url: 'http://localhost/interview/tok', passcode: '654321' },
    };
    mockCreateSession.mockResolvedValue(sessionResult);
    const onComplete = vi.fn();

    render(<QuestionBankSelector extraction={extraction} onComplete={onComplete} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    await waitFor(() => expect(screen.getByText('Introduce yourself.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Introduce yourself.'));

    fireEvent.click(screen.getByText('Generate Interview Link'));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(sessionResult));
    expect(mockCreateSession).toHaveBeenCalledWith(extraction, 30, {
      questionCount: 1,
      similarityConfirmed: false,
      questionBankIds: ['b1'],
      customQuestions: [],
    });
  });

  it('on failure: shows a stage-specific error message', async () => {
    mockCreateSession.mockRejectedValue(new SessionGenerationError('invite', 'db down'));

    render(<QuestionBankSelector extraction={extraction} onComplete={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    await waitFor(() => expect(screen.getByText('Introduce yourself.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Introduce yourself.'));
    fireEvent.click(screen.getByText('Generate Interview Link'));

    await waitFor(() =>
      expect(screen.getByText('Creating the interview link & passcode failed: db down')).toBeInTheDocument(),
    );
  });

  it('counts a custom question toward the configured total', async () => {
    mockCreateSession.mockResolvedValue({
      extraction,
      session: { id: 's1' },
      questions: [],
      invite: {},
    });

    render(<QuestionBankSelector extraction={extraction} onComplete={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('hr')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Write any other question...'), {
      target: { value: 'How would you handle a production incident?' },
    });
    fireEvent.click(screen.getByText('Add question'));

    const generateButton = screen.getByText('Generate Interview Link');
    await waitFor(() => expect(generateButton).not.toBeDisabled());
    fireEvent.click(generateButton);

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith(
        extraction,
        30,
        expect.objectContaining({
          questionCount: 1,
          customQuestions: ['How would you handle a production incident?'],
        }),
      ),
    );
  });
});
