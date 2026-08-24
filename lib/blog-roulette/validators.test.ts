import { describe, it, expect } from 'vitest';
import { runCheckpoints, createBlogSchema, updateBlogSchema, seoSuggestSchema, quizSubmitSchema } from './validators';
import { BLOG_RULES } from './types';

describe('Blog Roulette Validators', () => {
  describe('Zod Schemas', () => {
    it('validates createBlogSchema', () => {
      expect(createBlogSchema.safeParse({ title: 'Short' }).success).toBe(false);
      expect(createBlogSchema.safeParse({ title: 'A valid title that is long enough' }).success).toBe(true);
    });

    it('validates updateBlogSchema', () => {
      expect(updateBlogSchema.safeParse({ word_count: -5 }).success).toBe(false);
      expect(updateBlogSchema.safeParse({ word_count: 1000 }).success).toBe(true);
      expect(updateBlogSchema.safeParse({ ai_score: 150 }).success).toBe(false);
      expect(updateBlogSchema.safeParse({ cover_image_url: 'not-a-url' }).success).toBe(false);
    });

    it('validates seoSuggestSchema', () => {
      expect(seoSuggestSchema.safeParse({ title: 'No' }).success).toBe(false);
      expect(seoSuggestSchema.safeParse({ title: 'Valid Title' }).success).toBe(true);
    });

    it('validates quizSubmitSchema', () => {
      expect(quizSubmitSchema.safeParse({ answers: ['a', 'b'] }).success).toBe(false);
      expect(quizSubmitSchema.safeParse({ answers: ['a', 'b', 'c'] }).success).toBe(true);
      expect(quizSubmitSchema.safeParse({ answers: ['a', 'b', ''] }).success).toBe(false); // empty string fails min(1)
    });
  });

  describe('runCheckpoints', () => {
    it('passes with perfect data', () => {
      const res = runCheckpoints({
        body_html: '<pre>code</pre>',
        word_count: BLOG_RULES.WORD_MIN,
        seo_title: 'A Good SEO Title',
        meta_description: 'A good meta description',
        tldr: 'Just a short summary',
        ai_score: 50,
        tags: ['react', 'nextjs', 'typescript'],
        diagram_count: 1,
      });
      expect(res.passed).toBe(true);
      expect(res.checks.every(c => c.pass)).toBe(true);
    });

    it('fails when all inputs are missing/undefined (tests fallback values)', () => {
      const res = runCheckpoints({});
      expect(res.passed).toBe(false);
      
      const fails = res.checks.filter(c => !c.pass).map(c => c.name);
      expect(fails).toContain('word_count');
      expect(fails).toContain('code_blocks');
      expect(fails).toContain('diagrams');
      expect(fails).toContain('tldr');
      expect(fails).toContain('tags');
      expect(fails).toContain('seo_title');
    });

    it('validates word count boundaries', () => {
      const base = {
        body_html: '<pre>code</pre>',
        seo_title: 'Title',
        tldr: 'TLDR',
        tags: ['a', 'b', 'c'],
        diagram_count: 1,
      };
      
      expect(runCheckpoints({ ...base, word_count: BLOG_RULES.WORD_MIN - 1 }).passed).toBe(false);
      expect(runCheckpoints({ ...base, word_count: BLOG_RULES.WORD_MAX + 1 }).passed).toBe(false);
      expect(runCheckpoints({ ...base, word_count: BLOG_RULES.WORD_MIN }).passed).toBe(true);
      expect(runCheckpoints({ ...base, word_count: BLOG_RULES.WORD_MAX }).passed).toBe(true);
    });

    it('computes code blocks from HTML if code_block_count is missing', () => {
      const base = {
        word_count: BLOG_RULES.WORD_MIN,
        seo_title: 'Title',
        tldr: 'TLDR',
        tags: ['a', 'b', 'c'],
        diagram_count: 1,
      };
      expect(runCheckpoints({ ...base, body_html: '<div>no code here</div>' }).passed).toBe(false);
      expect(runCheckpoints({ ...base, body_html: '<pre><code>print(1)</code></pre>' }).passed).toBe(true);
      // Provided code_block_count overrides HTML
      expect(runCheckpoints({ ...base, body_html: '<div>none</div>', code_block_count: 1 }).passed).toBe(true);
    });

    it('validates TLDR word count boundaries', () => {
      const base = {
        body_html: '<pre>code</pre>',
        word_count: BLOG_RULES.WORD_MIN,
        seo_title: 'Title',
        tags: ['a', 'b', 'c'],
        diagram_count: 1,
      };
      
      const tooLongTLDR = Array(BLOG_RULES.TLDR_MAX_WORDS + 1).fill('word').join(' ');
      const exactlyMaxTLDR = Array(BLOG_RULES.TLDR_MAX_WORDS).fill('word').join(' ');
      
      expect(runCheckpoints({ ...base, tldr: '' }).passed).toBe(false); // empty TLDR
      expect(runCheckpoints({ ...base, tldr: '   ' }).passed).toBe(false); // whitespace TLDR
      expect(runCheckpoints({ ...base, tldr: tooLongTLDR }).passed).toBe(false);
      expect(runCheckpoints({ ...base, tldr: exactlyMaxTLDR }).passed).toBe(true);
    });

    it('validates SEO title and meta description length', () => {
      const base = {
        body_html: '<pre>code</pre>',
        word_count: BLOG_RULES.WORD_MIN,
        tldr: 'TLDR',
        tags: ['a', 'b', 'c'],
        diagram_count: 1,
      };
      
      const tooLongTitle = 'a'.repeat(BLOG_RULES.SEO_TITLE_MAX + 1);
      expect(runCheckpoints({ ...base, seo_title: tooLongTitle }).passed).toBe(false);
      
      const tooLongMeta = 'a'.repeat(BLOG_RULES.META_DESC_MAX + 1);
      expect(runCheckpoints({ ...base, seo_title: 'Valid', meta_description: tooLongMeta }).passed).toBe(false);
    });

    it('validates AI score limit', () => {
      const base = {
        body_html: '<pre>code</pre>',
        word_count: BLOG_RULES.WORD_MIN,
        seo_title: 'Title',
        tldr: 'TLDR',
        tags: ['a', 'b', 'c'],
        diagram_count: 1,
      };
      
      expect(runCheckpoints({ ...base, ai_score: BLOG_RULES.AI_SCORE_REJECT }).passed).toBe(false);
      expect(runCheckpoints({ ...base, ai_score: BLOG_RULES.AI_SCORE_REJECT - 1 }).passed).toBe(true);
    });
  });
});
