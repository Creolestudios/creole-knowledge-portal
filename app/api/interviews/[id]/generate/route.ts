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
  QuestionDifficulty,
  QuestionType,
  normalizeQuestionType,
  normalizeDifficulty,
  normalizeInteger,
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
        question_type: normalizeQuestionType(row.category === 'behavioral' ? 'behavioral' : 'hr', row.category),
        category: row.category,
        difficulty: normalizeDifficulty(row.difficulty),
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
    const rawQuestionBankIds: string[] = Array.isArray(reqBody.question_bank_ids)
      ? reqBody.question_bank_ids.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    const questionBankIds = rawQuestionBankIds;
    const customQuestions: string[] = Array.isArray(reqBody.custom_questions)
      ? reqBody.custom_questions
          .filter((v: unknown): v is string => typeof v === 'string')
          .map((v: string) => v.trim())
          .filter((v: string) => v.length > 0)
      : [];

    const dynamicQuestionsInput: any[] = Array.isArray(reqBody.dynamic_questions)
      ? reqBody.dynamic_questions
      : Array.isArray(reqBody.dynamicQuestions)
      ? reqBody.dynamicQuestions
      : [];

    let questions: InterviewQuestion[];

    if (questionBankIds.length > 0 || customQuestions.length > 0 || dynamicQuestionsInput.length > 0) {
      // Admin selected bank questions, dynamic tech questions, and/or wrote candidate-specific questions.
      const dbBankIds = questionBankIds.filter((bid) => !bid.startsWith('dynamic-tech-') && !bid.startsWith('dyn-tech-'));
      const dynamicTechIds = questionBankIds.filter((bid) => bid.startsWith('dynamic-tech-') || bid.startsWith('dyn-tech-'));

      let selectedRows: any[] | null = [];
      if (dbBankIds.length > 0) {
        const bankQuery = await supabaseAdmin
          .from('hr_question_bank')
          .select('*')
          .in('id', dbBankIds)
          .eq('is_active', true);

        if (bankQuery.error) {
          return NextResponse.json({ error: bankQuery.error.message }, { status: 500 });
        }
        selectedRows = bankQuery.data;
      }

      const rowsById = new Map((selectedRows || []).map((row) => [row.id, row]));
      const totalSelected = dbBankIds.length + Math.max(dynamicQuestionsInput.length, dynamicTechIds.length) + customQuestions.length;
      const perQuestionSeconds = durationMinutes
        ? Math.max(60, Math.round((durationMinutes * 60) / Math.max(1, totalSelected)))
        : 120;

      const bankQuestions = dbBankIds
        .map((bankId, idx) => {
          const row = rowsById.get(bankId);
          if (!row) return null;
          return {
            question_bank_id: row.id,
            question_text: row.question_text,
            question_type: normalizeQuestionType(row.category === 'behavioral' ? 'behavioral' : 'hr', row.category),
            category: row.category,
            difficulty: normalizeDifficulty(row.difficulty),
            required_skills: row.required_skills || [],
            intent: row.intent || row.title,
            question_order: idx + 1,
            time_limit_sec: perQuestionSeconds,
            is_mandatory_hr: !!row.is_mandatory,
            is_custom: false,
            weight: row.is_mandatory ? 5 : 10,
          } as InterviewQuestion & { question_bank_id: string };
        })
        .filter((q): q is InterviewQuestion & { question_bank_id: string } => q !== null);

      let dynamicTechQuestions: InterviewQuestion[] = [];
      if (dynamicQuestionsInput.length > 0) {
        dynamicTechQuestions = dynamicQuestionsInput.map((dq, idx) => ({
          question_text: dq.question_text || dq.text,
          question_type: 'technical' as QuestionType,
          category: 'technical',
          difficulty: normalizeDifficulty(dq.difficulty || 'medium'),
          required_skills: Array.isArray(dq.required_skills) ? dq.required_skills : (analysis.matchedKeywords?.slice(0, 3) || []),
          intent: dq.intent || dq.title || 'Technical Competency',
          question_order: bankQuestions.length + idx + 1,
          time_limit_sec: perQuestionSeconds,
          is_mandatory_hr: false,
          is_custom: false,
          weight: 10,
        }));
      } else if (dynamicTechIds.length > 0) {
        const generatedTech = await generateInterviewQuestions(
          profile,
          jd,
          analysis,
          [],
          {
            targetQuestions: dynamicTechIds.length,
            categoryCounts: { technical: dynamicTechIds.length },
            includeMandatoryHr: false,
          }
        );
        dynamicTechQuestions = generatedTech.map((item, idx) => ({
          ...item,
          question_type: 'technical' as QuestionType,
          category: 'technical',
          difficulty: normalizeDifficulty(item.difficulty),
          question_order: bankQuestions.length + idx + 1,
          time_limit_sec: perQuestionSeconds,
          is_mandatory_hr: false,
          is_custom: false,
          weight: 10,
        }));
      }

      const authoredQuestions: InterviewQuestion[] = customQuestions.map((questionText, idx) => ({
        question_text: questionText,
        question_type: 'hr' as QuestionType,
        category: 'custom',
        difficulty: 'medium' as QuestionDifficulty,
        required_skills: [],
        intent: 'Admin-authored question for this candidate.',
        question_order: bankQuestions.length + dynamicTechQuestions.length + idx + 1,
        time_limit_sec: perQuestionSeconds,
        is_mandatory_hr: false,
        is_custom: true,
        weight: 10,
      }));

      questions = [...bankQuestions, ...dynamicTechQuestions, ...authoredQuestions];

      if (questions.length === 0) {
        return NextResponse.json(
          { error: 'None of the selected question-bank IDs are active or found.' },
          { status: 400 }
        );
      }

      // If no technical questions were selected or generated yet, append dynamic technical questions
      if (dynamicTechQuestions.length === 0 && !questions.some((q) => q.category === 'technical')) {
        const technicalQuestions = await generateInterviewQuestions(
          profile,
          jd,
          analysis,
          [],
          {
            targetQuestions: 4,
            categoryCounts: { technical: 4 },
            includeMandatoryHr: false,
          }
        );

        technicalQuestions.forEach((tq, i) => {
          tq.question_type = normalizeQuestionType(tq.question_type, 'technical');
          tq.difficulty = normalizeDifficulty(tq.difficulty);
          tq.question_order = questions.length + i + 1;
        });

        questions = [...questions, ...technicalQuestions];
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

    // Insert newly generated questions into DB with strictly normalized values
    const insertPayload = questions.map((q, index) => ({
      session_id: id,
      question_bank_id: (q as InterviewQuestion & { question_bank_id?: string }).question_bank_id || null,
      question_text: q.question_text,
      question_type: normalizeQuestionType(q.question_type, q.category),
      category: q.category || 'hr',
      difficulty: normalizeDifficulty(q.difficulty),
      required_skills: Array.isArray(q.required_skills) ? q.required_skills : [],
      intent: q.intent || null,
      evaluation_rubric: {
        ...(typeof q.evaluation_rubric === 'object' && q.evaluation_rubric !== null ? q.evaluation_rubric : {}),
        is_custom: q.is_custom === true,
      },
      question_order: normalizeInteger(index + 1, index + 1, 1),
      time_limit_sec: normalizeInteger(q.time_limit_sec, 150, 30),
      is_mandatory_hr: q.is_mandatory_hr === true,
      is_custom: q.is_custom === true,
      weight: normalizeInteger(q.weight, 10, 1),
    }));

    let { data: createdQuestions, error: insertErr } = await supabaseAdmin
      .from('interview_questions')
      .insert(insertPayload)
      .select();

    if (insertErr && (insertErr.code === 'PGRST204' || insertErr.message?.includes('is_custom'))) {
      const fallbackPayload = insertPayload.map(({ is_custom: _discard, ...rest }) => rest);
      const fallbackInsert = await supabaseAdmin
        .from('interview_questions')
        .insert(fallbackPayload)
        .select();
      createdQuestions = fallbackInsert.data;
      insertErr = fallbackInsert.error;
    }

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
      is_fallback: questions.some((q) => q.is_fallback),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
