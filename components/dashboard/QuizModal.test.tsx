// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuizModal from './QuizModal';
import type { Quiz } from '@/types/contracts';

vi.mock('@/lib/data/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
import { logActivity } from '@/lib/data/activity';

const quiz: Quiz = {
  quiz_id: 'q1',
  questions: [
    { id: 'q1', prompt: 'What is 2+2?', options: ['3', '4', '5'], answerIndex: 1 },
    { id: 'q2', prompt: 'What is the capital of France?', options: ['Paris', 'Rome'], answerIndex: 0 },
  ],
};

describe('QuizModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    const { container } = render(
      <QuizModal quiz={quiz} date="2026-08-01" open={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the confirm stage first', () => {
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={vi.fn()} />);
    expect(screen.getByText('Ready to start the quiz?')).toBeInTheDocument();
  });

  it('closes via "Not now" without logging activity', () => {
    const onClose = vi.fn();
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={onClose} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(onClose).toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('walks through the quiz, disables Next until answered, and submits a passing score', () => {
    const onClose = vi.fn();
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={onClose} />);

    fireEvent.click(screen.getByText('Start Quiz'));
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();

    const nextBtn = screen.getByText('Next').closest('button')!;
    expect(nextBtn).toBeDisabled();

    fireEvent.click(screen.getByText('4')); // correct answer for Q1
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Paris')); // correct answer for Q2

    const submitBtn = screen.getByText('Submit');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(screen.getByText('2/2 correct')).toBeInTheDocument();
    expect(screen.getByText(/Passed/)).toBeInTheDocument();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-01', quizTaken: true, quizScore: 2, quizTotal: 2 }),
    );
  });

  it('lets the user navigate back to a previous question', () => {
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Start Quiz'));
    fireEvent.click(screen.getByText('4'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  });

  it('shows a failing result and allows retaking the quiz', () => {
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Start Quiz'));

    fireEvent.click(screen.getByText('3')); // wrong answer for Q1
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Rome')); // wrong answer for Q2
    fireEvent.click(screen.getByText('Submit'));

    expect(screen.getByText('0/2 correct')).toBeInTheDocument();
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retake'));
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  });

  it('toggles the answer review panel showing correct/incorrect markers', () => {
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Start Quiz'));
    fireEvent.click(screen.getByText('3')); // wrong
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Paris')); // correct
    fireEvent.click(screen.getByText('Submit'));

    fireEvent.click(screen.getByText('Review answers'));
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByText('Hide answers')).toBeInTheDocument();
  });

  it('resets state and calls onClose when closed via the X button after finishing', () => {
    const onClose = vi.fn();
    render(<QuizModal quiz={quiz} date="2026-08-01" open onClose={onClose} />);
    fireEvent.click(screen.getByText('Start Quiz'));
    fireEvent.click(screen.getByText('4'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Paris'));
    fireEvent.click(screen.getByText('Submit'));
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });
});
