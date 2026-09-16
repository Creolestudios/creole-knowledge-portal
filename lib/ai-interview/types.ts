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
