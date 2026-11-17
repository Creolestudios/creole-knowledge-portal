/**
 * Task Quality & Deliverable Validation Utility
 *
 * Enforces quality standards for next-day planned tasks:
 * 1. Task Title cannot be vague or generic (e.g. "bug fix", "work", "testing").
 * 2. Task Description must have at least 40 words detailing scope and criteria.
 * 3. Title and Description must be semantically relevant to each other.
 * 4. Repetitive filler text or keyboard mash is detected and blocked.
 */

const VAGUE_TITLES = new Set([
  'work',
  'working',
  'task',
  'tasks',
  'testing',
  'test',
  'bug fix',
  'bugfix',
  'bug fixes',
  'fixes',
  'fixing bugs',
  'changes',
  'change',
  'update',
  'updates',
  'code',
  'coding',
  'dev',
  'development',
  'meeting',
  'client call',
  'call',
  'discussion',
  'misc',
  'miscellaneous',
  'general',
  'general work',
  'todo',
  'review',
  'frontend',
  'backend',
  'working on tickets',
  'tickets',
  'client tasks',
  'pending items',
]);

const COMMON_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'some',
  'will',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'been',
  'being',
  'not',
  'but',
  'can',
  'could',
  'should',
  'would',
  'all',
  'any',
  'each',
  'both',
  'few',
  'more',
  'most',
  'other',
  'over',
  'such',
  'only',
  'own',
  'same',
  'then',
  'too',
  'very',
  'via',
  'per',
]);

export const GENERIC_ACTION_WORDS = new Set([
  'test',
  'tests',
  'testing',
  'implement',
  'implementation',
  'build',
  'create',
  'add',
  'added',
  'adding',
  'update',
  'updates',
  'updated',
  'updating',
  'refactor',
  'refactoring',
  'fix',
  'fixes',
  'fixing',
  'fixed',
  'write',
  'writing',
  'make',
  'making',
  'code',
  'coding',
  'work',
  'working',
  'done',
]);

export interface TaskQualityResult {
  isValid: boolean;
  wordCount: number;
  minWordCount: number;
  titleError?: string;
  descriptionError?: string;
  relevanceError?: string;
}

export const MIN_DESCRIPTION_WORDS = 40;

/**
 * Counts words by splitting on whitespace sequences, ignoring standalone bullet markers (•, -, *)
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
}

/**
 * Extracts meaningful keyword tokens from text (lowercase, alphanumeric, >2 chars, non-stopwords)
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];
  // Clean punctuation
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((w) => w.length > 2 && !COMMON_STOP_WORDS.has(w));
  return Array.from(new Set(tokens));
}

/**
 * Validates planned task title and description quality
 */
export function validateTaskQuality(
  title: string,
  description: string,
  minWords = MIN_DESCRIPTION_WORDS
): TaskQualityResult {
  const cleanTitle = (title || '').trim();
  const cleanDesc = (description || '').trim();
  const wordCount = countWords(cleanDesc);

  const result: TaskQualityResult = {
    isValid: true,
    wordCount,
    minWordCount: minWords,
  };

  // 1. Task Title Validation
  if (!cleanTitle) {
    result.isValid = false;
    result.titleError = 'Task Title is compulsory.';
    return result;
  }

  const lowerTitle = cleanTitle.toLowerCase();
  if (VAGUE_TITLES.has(lowerTitle) || cleanTitle.length < 8) {
    result.isValid = false;
    result.titleError =
      'Task Title is too vague. Please specify the concrete feature, component, or bug being worked on.';
    return result;
  }

  const titleTokens = extractKeywords(cleanTitle);
  if (titleTokens.length < 2) {
    result.isValid = false;
    result.titleError =
      'Task Title must describe specific technical deliverables (e.g. "Implement user profile picture upload & API tests").';
    return result;
  }

  // 2. Task Description Word Count Validation
  if (!cleanDesc) {
    result.isValid = false;
    result.descriptionError = `Task Description is compulsory and must contain at least ${minWords} words.`;
    return result;
  }

  if (wordCount < minWords) {
    result.isValid = false;
    result.descriptionError = `Task description has ${wordCount} words. At least ${minWords} words are required detailing technical deliverables, acceptance criteria, or endpoints.`;
    return result;
  }

  // 3. Repetition / Filler Detection
  const descTokens = cleanDesc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const uniqueTokens = new Set(descTokens);
  const uniqueRatio = descTokens.length > 0 ? uniqueTokens.size / descTokens.length : 0;

  if (uniqueRatio < 0.35) {
    result.isValid = false;
    result.descriptionError =
      'Task Description contains excessive repetitive words or filler text. Please provide genuine technical details.';
    return result;
  }

  // 4. Relevance & Semantic Match between Title and Description
  // Domain tokens: title tokens that are NOT generic action words (like "test", "implement", "update", "fix")
  const domainTokens = titleTokens.filter((tok) => !GENERIC_ACTION_WORDS.has(tok));
  const tokensToCheck = domainTokens.length > 0 ? domainTokens : titleTokens;

  const hasDomainOverlap = tokensToCheck.some((tok) => {
    // Exact word or meaningful stem match (min 4 chars to prevent short preposition collisions)
    return descTokens.some((dTok) => {
      if (dTok === tok) return true;
      if (tok.length >= 4 && dTok.length >= 4) {
        const prefixLen = Math.min(4, Math.min(tok.length, dTok.length));
        return tok.slice(0, prefixLen) === dTok.slice(0, prefixLen);
      }
      return false;
    });
  });

  if (!hasDomainOverlap) {
    result.isValid = false;
    result.relevanceError =
      'Task Description does not appear relevant to the Task Title. Please ensure your technical scope directly elaborates on the planned title.';
    return result;
  }

  return result;
}
