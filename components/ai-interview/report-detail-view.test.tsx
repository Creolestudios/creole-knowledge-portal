// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReportDetailView } from './report-detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock ReportChatCopilot to simplify test assertions
vi.mock('./report-chat-copilot', () => ({
  ReportChatCopilot: ({ candidateName }: { candidateName?: string }) => (
    <div data-testid="mock-chat-copilot">Mock Chat Copilot for {candidateName}</div>
  ),
}));

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
    verdict_headline: 'Top-tier Distributed Systems Architect',
    executive_summary:
      'Jane demonstrated deep engineering acumen with scalable architecture concepts.\n\nHer English communication is clear, natural, and well-structured throughout the session.\n\nStrongly recommended to advance to Round 2 interviews without reservations.',
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

  it('renders candidate overview, personalized headline, executive summary, and executive triad (Features 2 & 3)', () => {
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

    // Header & Info
    expect(screen.getByText('Jane Doe — Interview Result')).toBeInTheDocument();

    // Feature 2: Personalized Headline & 2-3 paragraph summary
    expect(screen.getByText('Top-tier Distributed Systems Architect')).toBeInTheDocument();
    expect(screen.getByText(/Jane demonstrated deep engineering acumen/i)).toBeInTheDocument();
    expect(screen.getByText(/Her English communication is clear/i)).toBeInTheDocument();
    expect(screen.getByText(/Strongly recommended to advance to Round 2/i)).toBeInTheDocument();

    // Feature 3: Executive Triad
    expect(screen.getByText('Technical Depth')).toBeInTheDocument();
    expect(screen.getAllByText('Communication').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Smartness')).toBeInTheDocument();
  });

  it('filters questions by All Questions, HR Questions, and Technical Questions (Feature 4)', () => {
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

    // Initial state: "All Questions" filter active, showing both questions
    expect(screen.getByText(/Please introduce yourself and highlight your experience/i)).toBeInTheDocument();
    expect(screen.getByText(/Describe how you handle event-driven architectures/i)).toBeInTheDocument();

    // Filter to HR Questions only
    const hrFilterBtn = screen.getByRole('button', { name: /HR Questions/i });
    fireEvent.click(hrFilterBtn);

    expect(screen.getByText(/Please introduce yourself and highlight your experience/i)).toBeInTheDocument();
    expect(screen.queryByText(/Describe how you handle event-driven architectures/i)).not.toBeInTheDocument();

    // Filter to Technical Questions only
    const techFilterBtn = screen.getByRole('button', { name: /Technical Questions/i });
    fireEvent.click(techFilterBtn);

    expect(screen.queryByText(/Please introduce yourself and highlight your experience/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Describe how you handle event-driven architectures/i)).toBeInTheDocument();
    expect(screen.queryByText(/Round 2 Technical Deep-Dive Recommendations/i)).not.toBeInTheDocument();
  });

  it('displays proctoring incident log with Strike 1, 2, 3 and clean high contrast without numeric counters (Feature 6)', () => {
    const warnings = [
      {
        id: 'w-1',
        strikeNumber: 1,
        category: 'face' as const,
        categoryLabel: 'Face / Gaze',
        reason: 'Multiple faces detected in frame.',
        timestamp: '10:14:02 AM',
      },
      {
        id: 'w-2',
        strikeNumber: 2,
        category: 'object' as const,
        categoryLabel: 'Object / Phone',
        reason: 'Unauthorized device / smartphone detected.',
        timestamp: '10:18:45 AM',
      },
    ];

    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        voiceWarningCount={0}
        faceWarningCount={1}
        objectWarningCount={1}
        totalWarnings={2}
        proctoringWarnings={warnings}
        followUpQuestions={mockFollowUp}
      />
    );

    expect(screen.getByText('Session Integrity & Proctoring')).toBeInTheDocument();
    expect(screen.getByText('Proctoring Incident Log')).toBeInTheDocument();
    expect(screen.getByText('Strike 1')).toBeInTheDocument();
    expect(screen.getByText('Multiple faces detected in frame.')).toBeInTheDocument();
    expect(screen.getByText('Strike 2')).toBeInTheDocument();
    expect(screen.getByText('Unauthorized device / smartphone detected.')).toBeInTheDocument();

    // Verify numeric count badges are removed
    expect(screen.queryByText(/3 \/ 3 Warnings Used/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Continuous Warning Counter/i)).not.toBeInTheDocument();
  });

  it('renders Google Drive full interview video link card and Zoho Recruit link option', () => {
    render(
      <ReportDetailView
        session={{
          ...mockSession,
          zoho_recruiter_link: 'https://recruit.zoho.com/recruit/Candidate.do?id=12345',
        }}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        recording={{
          fileId: 'drive-file-999',
          webViewLink: 'https://drive.google.com/file/d/drive-file-999/view',
          previewUrl: 'https://drive.google.com/file/d/drive-file-999/preview',
        }}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={0}
        followUpQuestions={mockFollowUp}
      />
    );

    // Video recording card has link and copy button (no embedded video player)
    expect(screen.getByText('Full Interview Video Recording')).toBeInTheDocument();
    const driveLink = screen.getByRole('link', { name: /Open in Google Drive/i });
    expect(driveLink).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-file-999/view');
    expect(screen.getByText('Copy Video Link')).toBeInTheDocument();

    // Zoho Recruit single button in candidate info header
    const zohoLink = screen.getByRole('link', { name: /Open in Zoho Recruit/i });
    expect(zohoLink).toHaveAttribute('href', 'https://recruit.zoho.com/recruit/Candidate.do?id=12345');
    expect(zohoLink).toHaveAttribute('target', '_blank');
  });

  it('renders direct video jump links and elapsed timing in proctoring incident log', () => {
    const warningsWithOffsets = [
      {
        id: 'w-1',
        strikeNumber: 1,
        category: 'face' as const,
        categoryLabel: 'Face / Gaze Violation',
        reason: 'Multiple faces detected in frame.',
        timestamp: '10:14:02 AM',
        offsetSeconds: 155,
        elapsedLabel: '02:35',
      },
    ];

    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        recording={{
          fileId: 'drive-file-999',
          webViewLink: 'https://drive.google.com/file/d/drive-file-999/view',
          previewUrl: 'https://drive.google.com/file/d/drive-file-999/preview',
        }}
        voiceWarningCount={0}
        faceWarningCount={1}
        objectWarningCount={0}
        totalWarnings={1}
        proctoringWarnings={warningsWithOffsets}
        followUpQuestions={mockFollowUp}
      />
    );

    // Elapsed timing badge & jump buttons
    const timingElements = screen.getAllByText(/02:35/i);
    expect(timingElements.length).toBeGreaterThanOrEqual(2);
    
    // In-portal video jump buttons targeting the exact second in the recording
    const jumpButtons = screen.getAllByRole('button', { name: /02:35/i });
    expect(jumpButtons.length).toBeGreaterThanOrEqual(1);

    // External Google Drive direct link targeting the exact second
    const driveLinks = screen.getAllByRole('link', { name: /^Google Drive/i });
    expect(driveLinks.length).toBeGreaterThanOrEqual(1);
    expect(driveLinks[0]).toHaveAttribute(
      'href',
      'https://drive.google.com/file/d/drive-file-999/view?t=2m35s'
    );

    // Wall clock timestamp is pure text without a jump link (no ↗)
    expect(screen.getByText(/10:14:02 AM/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /10:14:02 AM/i })).not.toBeInTheDocument();
  });

  it('formats rawTsMs into user local time and preserves exact video jump buttons and links', () => {
    const rawTime = new Date('2026-10-09T07:49:02.000Z').getTime();
    const expectedLocalTime = new Date(rawTime).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const warningsWithRawTs = [
      {
        id: 'term-strike-1',
        strikeNumber: 1,
        category: 'general' as const,
        categoryLabel: 'Integrity Violation (Terminated)',
        reason: 'The candidate clicked outside the interview window or switched tabs.',
        rawTsMs: rawTime,
        offsetSeconds: 20,
        elapsedLabel: '00:20',
      },
    ];

    render(
      <ReportDetailView
        session={mockSession}
        report={mockReport}
        questions={mockQuestions}
        answers={mockAnswers}
        transcript={mockTranscript}
        recording={{
          fileId: 'rec-test-123',
          webViewLink: 'https://drive.google.com/file/d/rec-test-123/view',
          previewUrl: 'https://drive.google.com/file/d/rec-test-123/preview',
        }}
        voiceWarningCount={0}
        faceWarningCount={0}
        objectWarningCount={0}
        totalWarnings={1}
        proctoringWarnings={warningsWithRawTs}
        followUpQuestions={mockFollowUp}
      />
    );

    // Dynamic local time formatted from rawTsMs
    expect(screen.getByText(new RegExp(expectedLocalTime, 'i'))).toBeInTheDocument();

    // In-portal video jump buttons
    const jumpButtons = screen.getAllByRole('button', { name: /00:20/i });
    expect(jumpButtons.length).toBeGreaterThanOrEqual(1);

    // Exact Google Drive link
    const driveLinks = screen.getAllByRole('link', { name: /^Google Drive/i });
    expect(driveLinks.length).toBeGreaterThanOrEqual(1);
    expect(driveLinks[0]).toHaveAttribute(
      'href',
      'https://drive.google.com/file/d/rec-test-123/view?t=20s'
    );
  });

  it('opens and closes the slide-over AI Copilot drawer via sticky bottom bar trigger (Feature 7)', () => {
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

    // Initial state: drawer not open
    expect(screen.queryByTestId('mock-chat-copilot')).not.toBeInTheDocument();

    // Click sticky bar trigger
    const copilotTriggerBtn = screen.getByRole('button', { name: /Ask AI Copilot/i });
    fireEvent.click(copilotTriggerBtn);

    // Drawer opens
    expect(screen.getByText('Report AI Copilot')).toBeInTheDocument();
    expect(screen.getByTestId('mock-chat-copilot')).toBeInTheDocument();

    // Close button works
    const closeBtn = screen.getByTitle('Close Copilot');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('mock-chat-copilot')).not.toBeInTheDocument();
  });
});
