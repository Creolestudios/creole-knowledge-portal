import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  generateInterviewQuestions,
  DEFAULT_MANDATORY_HR_QUESTIONS,
} from '@/lib/ai-interview/question-generator';
import {
  CandidateProfile,
  JDRequirements,
  KeywordMatchAnalysis,
  InterviewQuestion,
} from '@/lib/ai-interview/types';
import { getSessionOrError } from '@/lib/ai-interview/session-utils';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { session, errorResponse } = await getSessionOrError(id);
    if (errorResponse || !session) return errorResponse;

    // Fetch mandatory HR questions from db if available
    const { data: hrRows } = await supabaseAdmin
      .from('hr_question_bank')
      .select('*')
      .eq('is_active', true)
      .eq('is_mandatory', true)
      .order('default_order', { ascending: true });

    let hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS;

    if (hrRows && hrRows.length > 0) {
      hrQuestions = hrRows.map((row) => ({
        question_text: row.question_text,
        question_type: (row.category === 'behavioral' ? 'behavioral' : 'hr') as any,
        category: row.category,
        difficulty: row.difficulty as any,
        required_skills: ['HR', 'Communication'],
        intent: row.title,
        question_order: row.default_order,
        time_limit_sec: 120,
        is_mandatory_hr: true,
        weight: 5,
      }));
    }

    const profile: CandidateProfile = session.parsed_resume || {
      extractedSkills: [],
      domains: [],
    };
    const jd: JDRequirements = session.parsed_jd || {
      mustHaveSkills: [],
      niceToHaveSkills: [],
      keyResponsibilities: [],
    };
    const analysis: KeywordMatchAnalysis = session.skill_gap || {
      matchPercentage: 0,
      matchedKeywords: [],
      missingKeywords: [],
      resumeOnlyKeywords: [],
      skillGapSummary: '',
      keyStrengths: [],
      improvementAreas: [],
    };

    let reqBody: any = {};
    try {
      reqBody = await req.json();
    } catch {
      // Body may be empty on standard POST
    }

    const durationMinutes = reqBody.duration_minutes || reqBody.durationMinutes || session.duration_minutes;
    const targetQuestions = reqBody.total_questions || reqBody.totalQuestions;
    const questionBankIds: string[] = Array.isArray(reqBody.question_bank_ids)
      ? reqBody.question_bank_ids.filter((v: unknown): v is string => typeof v === 'string')
      : [];

    let questions: InterviewQuestion[];

    if (questionBankIds.length > 0) {
      // Admin explicitly selected exact questions from the reusable bank —
      // use those snapshots as-is instead of asking the LLM to generate.
      const { data: selectedRows, error: bankErr } = await supabaseAdmin
        .from('hr_question_bank')
        .select('*')
        .in('id', questionBankIds)
        .eq('is_active', true);

      if (bankErr) {
        return NextResponse.json({ error: bankErr.message }, { status: 500 });
      }

      const rowsById = new Map((selectedRows || []).map((row) => [row.id, row]));
      const perQuestionSeconds = durationMinutes
        ? Math.max(60, Math.round((durationMinutes * 60) / questionBankIds.length))
        : 120;

      questions = questionBankIds
        .map((bankId, idx) => {
          const row = rowsById.get(bankId);
          if (!row) return null;
          return {
            question_bank_id: row.id,
            question_text: row.question_text,
            question_type: (row.category === 'behavioral' ? 'behavioral' : 'hr') as any,
            category: row.category,
            difficulty: row.difficulty as any,
            required_skills: row.required_skills || [],
            intent: row.intent || row.title,
            question_order: idx + 1,
            time_limit_sec: perQuestionSeconds,
            is_mandatory_hr: !!row.is_mandatory,
            weight: row.is_mandatory ? 5 : 10,
          } as InterviewQuestion & { question_bank_id: string };
        })
        .filter((q): q is InterviewQuestion & { question_bank_id: string } => q !== null);

      if (questions.length === 0) {
        return NextResponse.json(
          { error: 'None of the selected question-bank IDs are active or found.' },
          { status: 400 }
        );
      }
    } else {
      questions = await generateInterviewQuestions(
        profile,
        jd,
        analysis,
        hrQuestions,
        {
          durationMinutes: typeof durationMinutes === 'number' ? durationMinutes : undefined,
          targetQuestions: typeof targetQuestions === 'number' ? targetQuestions : undefined,
        }
      );
    }


    // Remove any previously generated questions for this session
    await supabaseAdmin
      .from('interview_questions')
      .delete()
      .eq('session_id', id);

    // Insert newly generated questions into DB
    const insertPayload = questions.map((q) => ({
      session_id: id,
      question_bank_id: (q as InterviewQuestion & { question_bank_id?: string }).question_bank_id || null,
      question_text: q.question_text,
      question_type: q.question_type,
      category: q.category,
      difficulty: q.difficulty,
      required_skills: q.required_skills,
      intent: q.intent,
      evaluation_rubric: q.evaluation_rubric || {},
      question_order: q.question_order,
      time_limit_sec: q.time_limit_sec,
      is_mandatory_hr: q.is_mandatory_hr,
      weight: q.weight || 10,
    }));

    const { data: createdQuestions, error: insertErr } = await supabaseAdmin
      .from('interview_questions')
      .insert(insertPayload)
      .select();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('interview_sessions')
      .update({
        status: 'questions_generated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      session_id: id,
      questions: createdQuestions || [],
      total_count: (createdQuestions || []).length,
      generated_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
