// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReportDetailView } from './report-detail-view';

describe('ReportDetailView', () => {
  afterEach(() => cleanup());

  const mockSession = {
    id: 'test-session-123',
    candidate_name: 'Jane Doe',
    candidate_email: 'jane@example.com',
    status: 'completed',
    created_at: new Date().toISOString(),
    parsed_jd: { jobTitle: 'Senior Full Stack Engineer' },
  };

  const mockReport = {
    cognitive_composite: 88,
    reasoning_subscore: 90,
    clarity_subscore: 85,
    fluency_score: 92,
    fluency_cefr: 'C1',
    fluency_breakdown: {
      sub: {
        grammar: { band: 90, notes: 'Accurate' },
        vocabulary: { band: 92, notes: 'Rich' },
        coherence: { band: 94, notes: 'Structured' },
        fluency: { band: 90, notes: 'Smooth' },
      },
    },
    competency_scores: [
      {
        ord: 1,
        competency: 'Communication & Background',
        score: 5,
        justification: 'Clear, concise introduction with relevant accomplishments.',
        evidence: [{ quote: '6 years of experience building distributed systems' }],
        bluff_suspected: false,
      },
      {
        ord: 2,
        competency: 'System Architecture',
        score: 4,
        justification: 'Strong explanation of microservices and message queues.',
        evidence: [{ quote: 'we decoupled the payments system using Kafka' }],
        bluff_suspected: false,
      },
    ],
    local_metrics: { wpm: 140 },
    recommendation: 'strong_yes' as const,
    recommendation_rationale: 'Outstanding candidate with clean session.',
    flags: [],
  };

  const mockQuestions = [
    {
      id: 'q-hr-1',
      question_order: 1,
      category: 'hr',
      question_type: 'hr',
      question_text: 'Please introduce yourself and highlight your experience.',
      competency: 'Communication & Background',
      is_mandatory_hr: true,
    },
    {
      id: 'q-tech-2',
      question_order: 2,
      category: 'technical',
      question_type: 'technical',
      question_text: 'Describe how you handle event-driven architectures with high throughput.',
      competency: 'System Architecture',
      is_mandatory_hr: false,
    },
  ];

  const mockAnswers = [
    {
      id: 'a-hr-1',
      question_id: 'q-hr-1',
      transcript: 'I have 6 years of experience building distributed systems in TypeScript and Go.',
    },
    {
      id: 'a-tech-2',
      question_id: 'q-tech-2',
      transcript: 'In our previous platform we decoupled the payments system using Kafka with partitioned topics.',
    },
  ];

  const mockTranscript = [
    {
      id: 't-1',
      speaker: 'candidate',
      text: 'I have 6 years of experience building distributed systems in TypeScript and Go.',
      ts_ms: Date.now() - 50000,
    },
    {
      id: 't-2',
      speaker: 'candidate',
      text: 'In our previous platform we decoupled the payments system using Kafka with partitioned topics.',
      ts_ms: Date.now(),
    },
  ];

  const mockFollowUp = [
    'Can you walk through how you would configure consumer groups in Kafka to prevent lag?',
    'How do you manage schema evolution with Protobuf or Avro in distributed pipelines?',
  ];

  it('renders candidate overview and HR questions with respective answers under HR tab', () => {
    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={0}
        followUpQuestions={mockFollowUp}
      />
    );

    expect(screen.getByText('Jane Doe — Interview Result')).toBeInTheDocument();
    expect(screen.getByText('Strong Hire')).toBeInTheDocument();
    expect(screen.getByText('English Communication')).toBeInTheDocument();
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText(/Verified Clean Session/i)).toBeInTheDocument();

    // Verify HR question & respective candidate answer are visible in HR view
    expect(screen.getByText('HR & Behavioral Questions & Answers')).toBeInTheDocument();
    expect(screen.getByText(/Please introduce yourself and highlight your experience/i)).toBeInTheDocument();
    expect(screen.getByText(/I have 6 years of experience building distributed systems in TypeScript and Go/i)).toBeInTheDocument();
    expect(screen.getByText(/Clear, concise introduction with relevant accomplishments/i)).toBeInTheDocument();
  });

  it('switches to Technical tab and displays technical questions with respective answers and Round 2 recommendations', () => {
    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={0}
        followUpQuestions={mockFollowUp}
      />
    );

    // Switch to Technical tab
    const techTabBtn = screen.getByRole('button', { name: /Technical Evaluation/i });
    fireEvent.click(techTabBtn);

    // Verify Round 2 deep dive questions are rendered
    expect(screen.getByText('Round 2 Technical Deep-Dive Recommendations')).toBeInTheDocument();
    expect(
      screen.getByText(/Can you walk through how you would configure consumer groups in Kafka/i)
    ).toBeInTheDocument();

    // Verify Technical question & respective candidate answer are visible in Technical view
    expect(screen.getByText('Technical Questions & Answers')).toBeInTheDocument();
    expect(screen.getByText(/Describe how you handle event-driven architectures/i)).toBeInTheDocument();
    expect(screen.getByText(/In our previous platform we decoupled the payments system using Kafka/i)).toBeInTheDocument();
    expect(screen.getByText(/Strong explanation of microservices and message queues/i)).toBeInTheDocument();
  });

  it('switches to Transcript tab and displays speech logs', () => {
    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={0}
        followUpQuestions={mockFollowUp}
      />
    );

    const transcriptTabBtn = screen.getByRole('button', { name: /Full Transcript/i });
    fireEvent.click(transcriptTabBtn);

    expect(screen.getByText('Verbatim Interview Log')).toBeInTheDocument();
    expect(screen.getByText(/2 speech segments/i)).toBeInTheDocument();
  });

  it('correctly displays unanswered questions without leaking answers from other questions', () => {
    const questionsWithUnanswered = [
      ...mockQuestions,
      {
        id: 'q-tech-3',
        question_order: 3,
        category: 'technical',
        question_type: 'technical',
        question_text: 'Explain how you optimize Postgres queries with composite indexes.',
        competency: 'Database Optimization',
        is_mandatory_hr: false,
      },
    ];

    // Note: mockAnswers only has answers for q-hr-1 and q-tech-2, NOT q-tech-3
    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={questionsWithUnanswered}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={0}
        followUpQuestions={mockFollowUp}
      />
    );

    // Switch to Technical tab
    const techTabBtn = screen.getByRole('button', { name: /Technical Evaluation/i });
    fireEvent.click(techTabBtn);

    // Question 3 should be displayed
    expect(screen.getByText(/Explain how you optimize Postgres queries/i)).toBeInTheDocument();

    // Question 3 should show "No verbal response recorded for this question"
    expect(screen.getByText(/No verbal response recorded for this question/i)).toBeInTheDocument();
  });

  it('displays continuous 3-warning counter and breakdown across warning types', () => {
    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={1}
        faceWarningCount={1}
        objectWarningCount={1}
        totalWarnings={3}
        followUpQuestions={mockFollowUp}
      />
    );

    expect(screen.getByText('Continuous Warning Counter')).toBeInTheDocument();
    expect(screen.getByText('3 / 3 Warnings Used')).toBeInTheDocument();
    expect(screen.getByText(/Strike 1 ⚠️/)).toBeInTheDocument();
    expect(screen.getByText(/Strike 2 ⚠️/)).toBeInTheDocument();
    expect(screen.getByText(/Strike 3 ⚠️/)).toBeInTheDocument();
    expect(screen.getByText('Face / Gaze')).toBeInTheDocument();
    expect(screen.getByText('Object / Phone')).toBeInTheDocument();
    expect(screen.getByText('Voice / Audio')).toBeInTheDocument();
  });
});
