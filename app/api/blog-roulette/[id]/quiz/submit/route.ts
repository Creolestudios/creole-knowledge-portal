import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { quizSubmitSchema } from '@/lib/blog-roulette/validators';
import { runPublishPipeline } from '@/lib/blog-roulette/publisher';
import {
  geminiGenerate,
  fallbackGradeAnswers,
} from '@/lib/blog-roulette/gemini-client';
import { BLOG_RULES, type RouletteQuizQuestion } from '@/lib/blog-roulette/types';

export const runtime = 'nodejs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function scoreAnswers(
  questions: RouletteQuizQuestion[],
  answers: string[],
): Promise<{ correct: number; per: boolean[] }> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');

  const prompt = `You grade quiz answers for technical blog vetting.

For EACH of the 3 question/answer pairs below, decide if the answer demonstrates genuine understanding aligned with the expected topic.
- Be strict but fair. Semantic match is OK; verbatim not required.
- An empty, irrelevant, hand-wavy, or copy-pasted-looking answer = INCORRECT.
- A specific, on-topic answer that addresses the question = CORRECT.

Return ONLY a JSON array of 3 booleans, e.g. [true, false, true].

PAIRS:
${questions
  .map(
    (q, i) =>
      `Q${i + 1}: ${q.q}\nEXPECTED: ${q.expected_topic}\nANSWER: ${answers[i]}\n`,
  )
  .join('\n')}`;

  const raw = await geminiGenerate(prompt, { maxRetries: 1 });
  const match = raw.match(/\[[^\]]*\]/);
  if (!match) throw new Error('Grader returned non-JSON');
  const arr = JSON.parse(match[0]) as boolean[];
  if (!Array.isArray(arr) || arr.length !== 3) {
    throw new Error('Grader returned wrong shape');
  }
  return { per: arr, correct: arr.filter(Boolean).length };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = quizSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid answers' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: blog } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', id)
    .eq('author_id', user.id)
    .single();
  if (!blog) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (blog.status !== 'QUIZ_IN_PROGRESS') {
    return NextResponse.json(
      { error: `Cannot submit in status ${blog.status}` },
      { status: 409 },
    );
  }

  // Latest attempt
  const { data: attempt } = await supabase
    .from('roulette_quiz_attempts')
    .select('*')
    .eq('blog_id', id)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .single();
  if (!attempt) {
    return NextResponse.json({ error: 'No active attempt' }, { status: 409 });
  }

  const questions = attempt.questions as RouletteQuizQuestion[];
  let scored: { correct: number; per: boolean[] };
  if (!GEMINI_KEY || process.env.MOCK_AI_PIPELINE === 'true') {
    console.warn('[quiz/submit] Using rule-based fallback grader (mock or missing API key)');
    scored = fallbackGradeAnswers(questions, parsed.data.answers);
  } else {
    try {
      scored = await scoreAnswers(questions, parsed.data.answers);
    } catch (err: any) {
      console.warn('[quiz/submit] Gemini API failed, falling back to rule-based grader:', err.message || err);
      scored = fallbackGradeAnswers(questions, parsed.data.answers);
    }
  }

  const passed = scored.correct >= BLOG_RULES.QUIZ_PASS_THRESHOLD;
  const isLastAttempt = attempt.attempt_number > BLOG_RULES.QUIZ_RETRY_LIMIT;
  const result = passed ? 'PASS' : isLastAttempt ? 'REJECT' : 'SOFT_FAIL';

  await supabase
    .from('roulette_quiz_attempts')
    .update({
      answers: parsed.data.answers,
      score: scored.correct,
      result,
      completed_at: new Date().toISOString(),
    })
    .eq('id', attempt.id);

  let nextStatus = blog.status;
  if (passed) nextStatus = 'PASSED';
  else if (result === 'REJECT') nextStatus = 'REJECTED';
  else nextStatus = 'SUBMITTED'; // soft fail — can retry

  await supabase
    .from('roulette_blogs')
    .update({ status: nextStatus })
    .eq('id', id);

  if (passed) {
    // Run publishing pipeline in background to avoid blocking response
    runPublishPipeline(id, supabase, user.email || '')
      .catch((err) => {
        console.error('[quiz/submit] Background publishing failed:', err);
      });
  }

  return NextResponse.json({
    passed,
    correct: scored.correct,
    per_question: scored.per,
    result,
    next_status: nextStatus,
    can_retry: result === 'SOFT_FAIL',
  });
}
