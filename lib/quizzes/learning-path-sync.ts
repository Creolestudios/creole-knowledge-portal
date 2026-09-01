/**
 * Build Mongo learning-path payload from Supabase quiz attempts/answers.
 * Topic vocabulary comes from what the user filled (stack / interests / role),
 * not a fixed global list.
 */

export type QuizAnswerRow = {
  question_id?: string;
  is_correct?: boolean | null;
  points_awarded?: number | null;
};

export type QuizQuestionRow = {
  id: string;
  question?: string | null;
  question_type?: string | null;
};

export type QuizAttemptRow = {
  id: string;
  status?: string | null;
  score?: number | null;
  percentage?: number | null;
  passed?: boolean | null;
  attempt_number?: number | null;
  blog_id?: string | null;
  quiz_answers?: QuizAnswerRow[] | null;
};

export type LearningPathQuizPayload = {
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  attempt_number: number;
  blog_id: string;
  weak_topics: string[];
  next_step_topics: string[];
};

function uniqueTopics(topics: string[]): string[] {
  return [...new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

const QUESTION_STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'have', 'does',
  'the', 'and', 'for', 'are', 'was', 'were', 'how', 'why', 'can', 'you', 'your',
  'into', 'about', 'explain', 'describe', 'following', 'based', 'using', 'used',
  'use', 'a', 'an', 'is', 'in', 'of', 'to', 'on', 'or', 'as', 'be', 'by', 'it',
  'its', 'not', 'if', 'than', 'then', 'them', 'they', 'their', 'will', 'would',
  'should', 'could', 'must', 'most', 'more', 'such', 'only', 'also', 'into',
  'between', 'under', 'over', 'after', 'before', 'while', 'during', 'each',
  'both', 'some', 'any', 'all', 'code', 'snippet', 'question', 'answer', 'true',
  'false', 'option', 'options', 'correct', 'incorrect', 'best', 'following',
]);

/**
 * When profile stack is empty, still derive scrape-able topic words from
 * the missed question text so failed quizzes always produce weak_topics.
 */
export function keywordPhrasesFromQuestion(text: string, limit = 4): string[] {
  const words = String(text || '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !QUESTION_STOPWORDS.has(w));
  return uniqueTopics(words).slice(0, limit);
}

/** Normalize user-entered stack/interest terms into matchable tokens. */
export function buildTopicVocabulary(profileTerms: string[] = []): string[] {
  const expanded: string[] = [];
  for (const raw of profileTerms) {
    const term = String(raw || '').trim().toLowerCase();
    if (!term) continue;
    expanded.push(term);
    const compact = term.replaceAll(/[^a-z0-9+#.]/g, '');
    if (compact && compact !== term) expanded.push(compact);
    // "next.js" <-> "nextjs"
    if (term.includes('.')) expanded.push(term.replaceAll('.', ''));
  }
  return uniqueTopics(expanded);
}

/**
 * Find which of the user's topics appear in question text.
 * Longer terms match first so "next.js" wins over "next".
 */
export function topicTokensFromText(text: string, vocabulary: string[] = []): string[] {
  const haystack = String(text || '').toLowerCase();
  if (!haystack.trim() || vocabulary.length === 0) return [];
  const sorted = [...vocabulary].sort((a, b) => b.length - a.length);
  return sorted.filter((topic) => haystack.includes(topic));
}

/**
 * Aggregate every completed attempt for a blog into the Mongo quiz sync body.
 * `profileTerms` should be the user's tech stack / interests / role from Supabase.
 */
export function buildLearningPathQuizPayload(
  blogId: string,
  attempts: QuizAttemptRow[],
  questions: QuizQuestionRow[],
  fallbackScore: number,
  fallbackTotal: number,
  fallbackPassed: boolean,
  profileTerms: string[] = [],
): LearningPathQuizPayload {
  const vocabulary = buildTopicVocabulary(profileTerms);
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const completed = (attempts || []).filter((a) => a.status === 'completed');

  const weak: string[] = [];
  const next: string[] = [];
  const wrongQuestionTexts: string[] = [];
  const correctQuestionTexts: string[] = [];
  let hadWrong = false;
  let hadCorrect = false;

  for (const attempt of completed) {
    for (const ans of attempt.quiz_answers || []) {
      const q = ans.question_id ? qMap.get(ans.question_id) : undefined;
      const questionText = q?.question || '';
      if (ans.is_correct) {
        hadCorrect = true;
        if (questionText) correctQuestionTexts.push(questionText);
      } else {
        hadWrong = true;
        if (questionText) wrongQuestionTexts.push(questionText);
      }
      const tokens = topicTokensFromText(questionText, vocabulary);
      if (!tokens.length) continue;
      if (ans.is_correct) {
        next.push(...tokens);
      } else {
        weak.push(...tokens);
      }
    }
  }

  // Prefer profile stack; if empty / no overlap, mine keywords from missed questions
  const profileTopics = uniqueTopics(vocabulary);
  let weakTopics = uniqueTopics(weak);
  let nextTopics = uniqueTopics(next);

  if (hadWrong && weakTopics.length === 0) {
    weakTopics = profileTopics;
  }
  if (hadWrong && weakTopics.length === 0) {
    weakTopics = uniqueTopics(
      wrongQuestionTexts.flatMap((text) => keywordPhrasesFromQuestion(text)),
    );
  }
  if (hadCorrect && nextTopics.length === 0) {
    nextTopics = profileTopics;
  }
  if (hadCorrect && nextTopics.length === 0) {
    nextTopics = uniqueTopics(
      correctQuestionTexts.flatMap((text) => keywordPhrasesFromQuestion(text)),
    );
  }
  if (!fallbackPassed && weakTopics.length === 0) {
    weakTopics =
      profileTopics.length > 0
        ? profileTopics
        : uniqueTopics(wrongQuestionTexts.flatMap((text) => keywordPhrasesFromQuestion(text)));
  }
  if (fallbackPassed && nextTopics.length === 0) {
    nextTopics =
      profileTopics.length > 0
        ? profileTopics
        : uniqueTopics(correctQuestionTexts.flatMap((text) => keywordPhrasesFromQuestion(text)));
  }

  const latest = completed[completed.length - 1];
  const bestPct = completed.reduce((max, a) => {
    const pct = Number(a.percentage);
    return Number.isFinite(pct) ? Math.max(max, pct) : max;
  }, 0);
  const anyPassed = completed.some((a) => Boolean(a.passed)) || fallbackPassed;
  const attemptNumber = Math.min(
    3,
    Math.max(1, Number(latest?.attempt_number) || completed.length || 1),
  );

  const score = Number(latest?.score);
  const percentage =
    bestPct > 0
      ? bestPct
      : Number.isFinite(Number(latest?.percentage))
        ? Number(latest?.percentage)
        : fallbackTotal > 0
          ? Math.round((fallbackScore / fallbackTotal) * 100)
          : 0;

  return {
    score: Number.isFinite(score) ? score : fallbackScore,
    total: Math.max(1, fallbackTotal),
    percentage,
    passed: anyPassed,
    attempt_number: attemptNumber,
    blog_id: blogId,
    weak_topics: weakTopics,
    next_step_topics: nextTopics,
  };
}
