import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import {
  geminiGenerate,
  fallbackQuizQuestions,
} from '@/lib/blog-roulette/gemini-client';
import type { RouletteQuizQuestion } from '@/lib/blog-roulette/types';

export const runtime = 'nodejs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
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
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
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

  let questions: RouletteQuizQuestion[];
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

  // Determine attempt_number
  const { count } = await supabase
    .from('roulette_quiz_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('blog_id', id);

  const { data: attempt } = await supabase
    .from('roulette_quiz_attempts')
    .insert({
      blog_id: id,
      attempt_number: (count ?? 0) + 1,
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

  return NextResponse.json({
    attempt_id: attempt!.id,
    questions: safeQuestions,
    used_fallback: !GEMINI_KEY,
  });
}
