import { z } from 'zod';
import { BLOG_RULES } from './types';

export const createBlogSchema = z.object({
  title: z.string().min(10).max(150),
});

export const updateBlogSchema = z.object({
  title: z.string().min(10).max(150).optional(),
  body_html: z.string().optional(),
  body_md: z.string().optional(),
  seo_title: z.string().max(BLOG_RULES.SEO_TITLE_MAX).optional(),
  meta_description: z.string().max(BLOG_RULES.META_DESC_MAX).optional(),
  tldr: z.string().optional(),
  cover_image_url: z.string().url().optional(),
  word_count: z.number().int().nonnegative().optional(),
  reading_time: z.number().int().nonnegative().optional(),
  ai_score: z.number().min(0).max(100).optional(),
});

export const seoSuggestSchema = z.object({
  title: z.string().min(5),
});

export const quizSubmitSchema = z.object({
  answers: z.array(z.string().min(1)).length(3),
});

export type CheckpointResult = {
  passed: boolean;
  checks: {
    name: string;
    label: string;
    pass: boolean;
    detail?: string;
  }[];
};

export function runCheckpoints(blog: {
  body_html?: string | null;
  body_md?: string | null;
  word_count?: number;
  seo_title?: string | null;
  meta_description?: string | null;
  tldr?: string | null;
  cover_image_url?: string | null;
  ai_score?: number | null;
  tags?: string[];
  code_block_count?: number;
  diagram_count?: number;
}): CheckpointResult {
  const html = blog.body_html ?? '';
  const wc = blog.word_count ?? 0;
  const tldrWords = (blog.tldr ?? '').trim().split(/\s+/).filter(Boolean).length;
  const codeBlocks = blog.code_block_count ?? (html.match(/<pre/g) ?? []).length;
  const diagrams = blog.diagram_count ?? 0;
  const tagsCount = blog.tags?.length ?? 0;
  const aiScore = blog.ai_score ?? 0;

  const checks = [
    {
      name: 'word_count',
      label: `Word count: ${BLOG_RULES.WORD_MIN}–${BLOG_RULES.WORD_MAX}`,
      pass: wc >= BLOG_RULES.WORD_MIN && wc <= BLOG_RULES.WORD_MAX,
      detail: `Current: ${wc}`,
    },
    {
      name: 'code_blocks',
      label: `Code blocks: ≥${BLOG_RULES.MIN_CODE_BLOCKS}`,
      pass: codeBlocks >= BLOG_RULES.MIN_CODE_BLOCKS,
      detail: `Found: ${codeBlocks}`,
    },
    {
      name: 'diagrams',
      label: `Diagram OR citation: ≥${BLOG_RULES.MIN_DIAGRAMS_OR_CITATIONS}`,
      pass: diagrams >= BLOG_RULES.MIN_DIAGRAMS_OR_CITATIONS,
      detail: `Found: ${diagrams}`,
    },
    {
      name: 'tldr',
      label: `TL;DR: ≤${BLOG_RULES.TLDR_MAX_WORDS} words`,
      pass: tldrWords > 0 && tldrWords <= BLOG_RULES.TLDR_MAX_WORDS,
      detail: `Words: ${tldrWords}`,
    },
    {
      name: 'tags',
      label: `Tags: ≥${BLOG_RULES.MIN_TAGS}`,
      pass: tagsCount >= BLOG_RULES.MIN_TAGS,
      detail: `Count: ${tagsCount}`,
    },
    {
      name: 'seo_title',
      label: `SEO title (≤${BLOG_RULES.SEO_TITLE_MAX} chars)`,
      pass: !!blog.seo_title && blog.seo_title.length <= BLOG_RULES.SEO_TITLE_MAX,
    },
    {
      name: 'meta_description',
      label: `Meta description (optional, ≤${BLOG_RULES.META_DESC_MAX} chars)`,
      pass:
        !blog.meta_description ||
        blog.meta_description.length <= BLOG_RULES.META_DESC_MAX,
    },
    {
      name: 'cover_image',
      label: 'Cover image (optional)',
      pass: true,
    },
    {
      name: 'ai_score',
      label: `AI detection (<${BLOG_RULES.AI_SCORE_REJECT}%)`,
      pass: aiScore < BLOG_RULES.AI_SCORE_REJECT,
      detail: `Score: ${aiScore.toFixed(1)}%`,
    },
  ];

  return {
    passed: checks.every((c) => c.pass),
    checks,
  };
}
