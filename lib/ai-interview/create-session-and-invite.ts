import {
  ExtractionResult,
  InterviewInvite,
  InterviewQuestion,
  InterviewSession,
  SessionGenerationResult,
} from './types';

/**
 * One error class for every stage of the chain below, so callers can show a
 * message that says exactly which step failed ("couldn't create the
 * session" vs. "couldn't generate questions" vs. "couldn't create the
 * invite link") instead of one generic failure message.
 */
export class SessionGenerationError extends Error {
  constructor(
    public readonly stage: 'session' | 'questions' | 'invite',
    message: string,
  ) {
    super(message);
    this.name = 'SessionGenerationError';
  }
}

async function readJsonOrThrow(res: Response, stage: SessionGenerationError['stage'], fallbackMessage: string) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new SessionGenerationError(stage, json?.error || fallbackMessage);
  }
  return json;
}

/**
 * Options for the admin's manual question-bank selection step. When
 * `questionBankIds` is non-empty, the generate stage uses those exact
 * snapshots instead of asking the LLM to invent questions.
 */
export interface SessionSelectionOptions {
  questionCount?: number;
  similarityConfirmed?: boolean;
  questionBankIds?: string[];
}

/**
 * Runs the interview-session pipeline used by the resume/JD extractor page:
 * create the session from the extracted data, generate its interview
 * questions (from the admin's selected question-bank IDs when provided),
 * then generate the candidate invite (link + passcode). Throws a
 * `SessionGenerationError` naming the stage that failed, so the caller can
 * show a precise success/error message.
 */
export async function createInterviewSessionWithInvite(
  extraction: ExtractionResult,
  durationMinutes = 30,
  options: SessionSelectionOptions = {},
): Promise<SessionGenerationResult> {
  const sessionRes = await fetch('/api/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate_name: extraction.candidateProfile.name || '',
      candidate_email: extraction.candidateProfile.email || '',
      candidate_phone: extraction.candidateProfile.phone || '',
      parsed_resume: extraction.candidateProfile,
      parsed_jd: extraction.jdRequirements,
      skill_gap: extraction.analysis,
      question_count: options.questionCount,
      duration_minutes: durationMinutes,
      similarity_confirmed: options.similarityConfirmed,
    }),
  });
  const sessionJson = await readJsonOrThrow(sessionRes, 'session', 'Failed to create the interview session.');
  const session = sessionJson.session as InterviewSession;

  const generateRes = await fetch(`/api/interviews/${session.id}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      duration_minutes: durationMinutes,
      question_bank_ids: options.questionBankIds,
    }),
  });
  const generateJson = await readJsonOrThrow(generateRes, 'questions', 'Failed to generate interview questions.');
  const questions = (generateJson.questions || []) as InterviewQuestion[];

  const inviteRes = await fetch(`/api/interviews/${session.id}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const inviteJson = await readJsonOrThrow(inviteRes, 'invite', 'Failed to create the interview invite link.');
  const invite: InterviewInvite = {
    id: inviteJson.invite_id,
    session_id: session.id,
    token_hash: '',
    status: 'active',
    max_warnings: 3,
    max_alerts: 3,
    allowed_modes: ['interview'],
    expires_at: inviteJson.expires_at,
    invite_url: inviteJson.invite_url,
    passcode: inviteJson.passcode,
  };

  return { extraction, session, questions, invite };
}
