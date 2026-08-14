import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import {
  geminiGenerate,
  fallbackQuizQuestions,
} from '@/lib/blog-roulette/gemini-client';
import { BLOG_RULES, type RouletteQuizQuestion } from '@/lib/blog-roulette/types';
import { requireUserAndBlog } from '@/lib/blog-roulette/route-helpers';

export const runtime = 'nodejs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]{1,10000}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function generateWithGemini(text: string): Promise<RouletteQuizQuestion[]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');

  const prompt = `You are an interrogator validating that an author truly wrote and understands this blog post.

Generate exactly 3 DEEP, SPECIFIC questions about the content below. Each question must:
- Reference a specific concept, code snippet, decision, or claim from the text.
- Require understanding to answer — not just a keyword lookup.
- Be answerable in 2-4 sentences by someone who genuinely wrote it.

Return ONLY a JSON array of 3 objects in this shape:
[{"q": "question text", "expected_topic": "1-line summary of correct answer"}]

BLOG CONTENT:
${text.slice(0, 12000)}`;

  const raw = await geminiGenerate(prompt, { maxRetries: 2 });
  const jsonMatch = raw.match(/\[[\s\S]{0,50000}\]/);
  if (!jsonMatch) throw new Error('Gemini returned non-JSON');
  const parsed = JSON.parse(jsonMatch[0]) as RouletteQuizQuestion[];
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error('Expected 3 questions');
  }
  return parsed;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const auth = await requireUserAndBlog(supabase, id, { restrictToAuthor: true });
  if ('error' in auth) return auth.error;
  const { blog } = auth;

  if (blog.status !== 'SUBMITTED' && blog.status !== 'QUIZ_IN_PROGRESS') {
    return NextResponse.json(
      { error: `Cannot start quiz in status ${blog.status}` },
      { status: 409 },
    );
  }

  const text = stripHtml(blog.body_html ?? '');
  if (text.length < 200) {
    return NextResponse.json(
      { error: 'Body too short for quiz generation' },
      { status: 400 },
    );
  }

  // Determine attempt_number
  const { count } = await supabase
    .from('roulette_quiz_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('blog_id', id);

  const attemptNumber = (count ?? 0) + 1;

  // Find previous attempt if this is a retry
  let prevAttempt: any = null;
  if (attemptNumber === 2) {
    const { data: prev } = await supabase
      .from('roulette_quiz_attempts')
      .select('*')
      .eq('blog_id', id)
      .eq('attempt_number', 1)
      .maybeSingle();
    prevAttempt = prev;
  }

  let questions: RouletteQuizQuestion[];
  if (attemptNumber === 2 && prevAttempt) {
    // Reuse questions from attempt 1
    questions = (prevAttempt.questions as any[]).map(q => ({
      q: q.q,
      expected_topic: q.expected_topic
    }));
  } else {
    if (!GEMINI_KEY || process.env.MOCK_AI_PIPELINE === 'true') {
      console.warn('[quiz/generate] Using rule-based fallback generator (mock or missing API key)');
      questions = fallbackQuizQuestions(text);
    } else {
      try {
        questions = await generateWithGemini(text);
      } catch (err: any) {
        console.warn('[quiz/generate] Gemini API failed, falling back to rule-based generator:', err.message || err);
        questions = fallbackQuizQuestions(text);
      }
    }
  }

  // Find any active incomplete attempts
  const { data: incompleteAttempts } = await supabase
    .from('roulette_quiz_attempts')
    .select('*')
    .eq('blog_id', id)
    .is('completed_at', null);

  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  if (incompleteAttempts && incompleteAttempts.length > 0) {
    for (const attemptItem of incompleteAttempts) {
      const timePassed = Date.now() - new Date(attemptItem.created_at).getTime();

      if (timePassed < FIVE_MINUTES_MS) {
        // Active attempt within time limit: REUSE IT
        const safeQuestions = (attemptItem.questions as RouletteQuizQuestion[]).map(
          (q) => ({ q: q.q }),
        );
        
        // Find which indices were incorrect in the previous attempt (attempt 1)
        let incompleteIncorrectIndices: number[] = [];
        let incompletePrevAnswers: string[] | null = null;
        if (attemptItem.attempt_number === 2 && prevAttempt) {
          incompleteIncorrectIndices = (prevAttempt.questions as any[]).map((q, idx) => q.correct === false ? idx : -1).filter(idx => idx !== -1);
          incompletePrevAnswers = prevAttempt.answers;
        }

        return NextResponse.json({
          attempt_id: attemptItem.id,
          questions: safeQuestions,
          created_at: attemptItem.created_at,
          used_fallback: !GEMINI_KEY,
          prev_answers: incompletePrevAnswers,
          incorrect_indices: incompleteIncorrectIndices,
        });
      } else {
        // Expired attempt: mark it as completed with score 0
        const isLastAttempt = attemptItem.attempt_number > BLOG_RULES.QUIZ_RETRY_LIMIT;
        const result = isLastAttempt ? 'REJECT' : 'SOFT_FAIL';

        await supabase
          .from('roulette_quiz_attempts')
          .update({
            answers: ['(expired - time limit reached)', '(expired - time limit reached)', '(expired - time limit reached)'],
            score: 0,
            result,
            completed_at: new Date().toISOString(),
          })
          .eq('id', attemptItem.id);

        if (result === 'REJECT') {
          await supabase
            .from('roulette_blogs')
            .update({ status: 'REJECTED' })
            .eq('id', id);
          return NextResponse.json(
            { error: 'Previous quiz attempt expired. Post is now locked.' },
            { status: 409 },
          );
        } else {
          await supabase
            .from('roulette_blogs')
            .update({ status: 'SUBMITTED' })
            .eq('id', id);
          // Allow them to start a new quiz by continuing the loop
        }
      }
    }
  }

  const { data: attempt } = await supabase
    .from('roulette_quiz_attempts')
    .insert({
      blog_id: id,
      attempt_number: attemptNumber,
      questions,
    })
    .select('*')
    .single();

  await supabase
    .from('roulette_blogs')
    .update({ status: 'QUIZ_IN_PROGRESS' })
    .eq('id', id);

  // Strip expected_topic before returning to client (server-side secret)
  const safeQuestions = (attempt!.questions as RouletteQuizQuestion[]).map(
    (q) => ({ q: q.q }),
  );

  const incorrectIndices = prevAttempt
    ? (prevAttempt.questions as any[]).map((q, idx) => q.correct === false ? idx : -1).filter(idx => idx !== -1)
    : [];

  return NextResponse.json({
    attempt_id: attempt!.id,
    questions: safeQuestions,
    created_at: attempt!.created_at,
    used_fallback: !GEMINI_KEY,
    prev_answers: prevAttempt ? prevAttempt.answers : null,
    incorrect_indices: incorrectIndices,
  });
}
