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

export type QuestionType =
  | 'technical'
  | 'role_specific'
  | 'behavioral'
  | 'situational'
  | 'hr'
  | 'system_design';

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

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
  weight?: number;
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
}

export interface GenerateQuestionsResponse {
  session_id: string;
  questions: InterviewQuestion[];
  total_count: number;
  generated_at: string;
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
  access_code: string;
  status: InterviewStatus;
  expires_at: string;
  created_at: string;
}

export interface ICreatedInterview {
  interviewId: string;
  link: string;
  accessCode: string;
}
