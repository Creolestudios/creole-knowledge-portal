import { NextRequest, NextResponse } from 'next/server';
import {
  generateInterviewQuestions,
  DEFAULT_MANDATORY_HR_QUESTIONS,
} from '@/lib/ai-interview/question-generator';
import {
  CandidateProfile,
  JDRequirements,
  KeywordMatchAnalysis,
} from '@/lib/ai-interview/types';
import { requireAdminUser } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdminUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { candidateProfile, jdRequirements, analysis, durationMinutes } = body;

    const profile: CandidateProfile = candidateProfile || {
      extractedSkills: [],
      domains: [],
    };
    const jd: JDRequirements = jdRequirements || {
      mustHaveSkills: [],
      niceToHaveSkills: [],
      keyResponsibilities: [],
    };
    const matchAnalysis: KeywordMatchAnalysis = analysis || {
      matchPercentage: 0,
      matchedKeywords: [],
      missingKeywords: [],
      resumeOnlyKeywords: [],
      skillGapSummary: '',
      keyStrengths: [],
      improvementAreas: [],
    };

    const duration = typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : 30;

    const questions = await generateInterviewQuestions(
      profile,
      jd,
      matchAnalysis,
      DEFAULT_MANDATORY_HR_QUESTIONS,
      { durationMinutes: duration }
    );

    return NextResponse.json(
      {
        questions,
        totalCount: questions.length,
        durationMinutes: duration,
        generatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[API /api/ai-interview/generate-questions] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate HR interview questions.' },
      { status: 500 }
    );
  }
}
