export interface EducationRecord {
  level: 'school' | 'college' | 'postgraduate' | 'other';
  institution?: string;
  qualification?: string;
  fieldOfStudy?: string;
  percentage?: number;
  cgpa?: number;
  grade?: string;
  passingYear?: number;
}

export interface CandidateProfile {
  name?: string;
  email?: string;
  phone?: string;
  yearsOfExperience?: number;
  summary?: string;
  extractedSkills: string[];
  domains: string[];
  education?: EducationRecord[];
  noticePeriod?: string;
  currentLocation?: string;
  availability?: string;
  workAuthorization?: string;
  projectHighlights?: string[];
}

export interface JDRequirements {
  jobTitle?: string;
  seniorityLevel?: string;
  requiredExperienceYears?: number;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  keyResponsibilities: string[];
}

export interface KeywordMatchAnalysis {
  matchPercentage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  resumeOnlyKeywords: string[];
  skillGapSummary: string;
  keyStrengths: string[];
  improvementAreas: string[];
}

export interface ExtractionResult {
  candidateProfile: CandidateProfile;
  jdRequirements: JDRequirements;
  analysis: KeywordMatchAnalysis;
  extractedAt: string;
}

/**
 * Everything produced by the single "Generate Interview Link" action:
 * resume/JD extraction, the created session, its generated (and stored)
 * questions, and the resulting invite link + passcode.
 */
export interface SessionGenerationResult {
  extraction: ExtractionResult;
  session: InterviewSession;
  questions: InterviewQuestion[];
  invite: InterviewInvite;
}

export interface ExtractKeywordsInput {
  resumeText?: string;
  resumeFileName?: string;
  resumeFileBase64?: string;
  resumeMimeType?: string;
  jdText?: string;
  jdFileName?: string;
  jdFileBase64?: string;
  jdMimeType?: string;
}

export const VALID_QUESTION_TYPES = [
  'technical',
  'role_specific',
  'behavioral',
  'situational',
  'hr',
  'system_design',
] as const;

export type QuestionType = typeof VALID_QUESTION_TYPES[number];

export const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type QuestionDifficulty = typeof VALID_DIFFICULTIES[number];

export function normalizeQuestionType(type: unknown, category?: string): QuestionType {
  const raw = typeof type === 'string' ? type.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if ((VALID_QUESTION_TYPES as readonly string[]).includes(raw)) {
    return raw as QuestionType;
  }
  if (raw.includes('tech') || raw.includes('code') || raw.includes('coding') || raw.includes('program')) {
    return 'technical';
  }
  if (raw.includes('system') || raw.includes('design') || raw.includes('architecture')) {
    return 'system_design';
  }
  if (raw.includes('behav') || raw.includes('culture') || raw.includes('conflict') || raw.includes('team')) {
    return 'behavioral';
  }
  if (raw.includes('sit') || raw.includes('scenario') || raw.includes('priorit')) {
    return 'situational';
  }
  if (raw.includes('role') || raw.includes('specific') || raw.includes('domain') || raw.includes('adapt') || raw.includes('project')) {
    return 'role_specific';
  }
  if (category) {
    const cat = category.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if ((VALID_QUESTION_TYPES as readonly string[]).includes(cat)) {
      return cat as QuestionType;
    }
    if (cat.includes('tech')) return 'technical';
    if (cat.includes('behav') || cat.includes('culture') || cat.includes('conflict') || cat.includes('team')) return 'behavioral';
    if (cat.includes('role') || cat.includes('adapt') || cat.includes('project')) return 'role_specific';
    if (cat.includes('sit')) return 'situational';
  }
  return 'hr';
}

export function normalizeDifficulty(diff: unknown): QuestionDifficulty {
  const raw = typeof diff === 'string' ? diff.trim().toLowerCase() : '';
  if ((VALID_DIFFICULTIES as readonly string[]).includes(raw)) {
    return raw as QuestionDifficulty;
  }
  if (raw === 'beginner' || raw === 'basic' || raw === 'simple') return 'easy';
  if (raw === 'intermediate' || raw === 'moderate') return 'medium';
  if (raw === 'advanced' || raw === 'expert' || raw === 'complex') return 'hard';
  return 'medium';
}

export function normalizeInteger(val: unknown, fallback = 10, min = 1): number {
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val > 0 && val < 1) {
      return Math.max(min, Math.round(val * 100));
    }
    return Math.max(min, Math.round(val));
  }
  if (typeof val === 'string') {
    const parsed = Number.parseFloat(val);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      if (parsed > 0 && parsed < 1) {
        return Math.max(min, Math.round(parsed * 100));
      }
      return Math.max(min, Math.round(parsed));
    }
  }
  return Math.max(min, Math.round(fallback));
}

export interface HRQuestionBank {
  id: string;
  title: string;
  question_text: string;
  category: 'hr' | 'behavioral' | 'culture_fit' | 'screening';
  difficulty: QuestionDifficulty;
  is_mandatory: boolean;
  default_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface InterviewQuestion {
  id?: string;
  session_id?: string;
  question_text: string;
  question_type: QuestionType;
  category: string;
  difficulty: QuestionDifficulty;
  required_skills: string[];
  intent?: string;
  evaluation_rubric?: Record<string, unknown>;
  question_order: number;
  time_limit_sec: number;
  is_mandatory_hr: boolean;
  is_custom?: boolean;
  question_bank_id?: string | null;
  weight?: number;
  is_fallback?: boolean;
  created_at?: string;
}

export interface InterviewSession {
  id: string;
  candidate_name?: string;
  candidate_email?: string;
  candidate_phone?: string;
  resume_storage_path?: string;
  jd_storage_path?: string;
  parsed_resume?: CandidateProfile;
  parsed_jd?: JDRequirements;
  skill_gap?: KeywordMatchAnalysis;
  experience_level?: string;
  status: 'draft' | 'parsed' | 'questions_generated' | 'invite_issued' | 'in_progress' | 'completed' | 'cancelled';
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  questions?: InterviewQuestion[];
  invite?: InterviewInvite;
}

/**
 * All proctoring event categories stored in interview_events.category.
 *
 * Face-tracking categories (existing):
 *   gaze_away | reading_suspected | no_face | multi_face | none
 *
 * Object detection categories (new):
 *   object_detected — meta: { object: string, confidence: number, boundingBox: number[] }
 *
 * Background voice categories (new):
 *   background_voice — meta: { duration_ms: number, rms_level: number }
 */
export type ProctoringEventCategory =
  | 'gaze_away'
  | 'reading_suspected'
  | 'no_face'
  | 'multi_face'
  | 'object_detected'
  | 'background_voice'
  | 'expression_metrics'
  | 'identity_mismatch'
  | 'none';


export interface InterviewInvite {
  id: string;
  session_id: string;
  token_hash: string;
  passcode_hash?: string;
  passcode_salt?: string;
  status: 'active' | 'in_progress' | 'completed' | 'expired' | 'revoked';
  max_warnings: number;
  max_alerts: number;
  allowed_modes: string[];
  expires_at?: string;
  consumed_at?: string;
  completed_at?: string;
  bound_session_id?: string;
  invite_url?: string;
  passcode?: string;
  created_at?: string;
}

export interface GenerateQuestionsInput {
  session_id: string;
  total_questions?: number;
  duration_minutes?: number;
  include_hr_questions?: boolean;
}

export interface QuestionGeneratorOptions {
  durationMinutes?: number;
  targetQuestions?: number;
  minQuestions?: number;
  categoryCounts?: Record<string, number>;
  includeMandatoryHr?: boolean;
  selectedQuestionIds?: string[];
  customQuestions?: string[];
}

export interface GenerateQuestionsResponse {
  session_id: string;
  questions: InterviewQuestion[];
  total_count: number;
  generated_at: string;
  is_fallback?: boolean;
}

export interface CreateInviteInput {
  session_id: string;
  passcode?: string;
  expires_in_hours?: number;
  max_alerts?: number;
}

export type InterviewStatus = 'pending' | 'in_progress' | 'completed' | 'expired';

export interface IInterviewSummary {
  id: string;
  candidate_name: string | null;
  candidate_email: string | null;
  job_title: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
}

export interface ICreatedInterview {
  interviewId: string;
  link: string;
  accessCode: string;
}
