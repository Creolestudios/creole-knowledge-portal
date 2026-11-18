import { describe, it, expect } from 'vitest';
import {
  countWords,
  extractKeywords,
  validateTaskQuality,
  MIN_DESCRIPTION_WORDS,
} from './task-quality-validator';

describe('Task Quality Validator', () => {
  describe('countWords', () => {
    it('returns 0 for empty or whitespace text', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   \n\t  ')).toBe(0);
    });

    it('accurately counts space-separated words', () => {
      expect(countWords('hello world foo bar')).toBe(4);
      expect(countWords('one   two   three')).toBe(3);
    });
  });

  describe('extractKeywords', () => {
    it('filters out common stopwords and short words', () => {
      const keywords = extractKeywords('The user and the profile with an API');
      expect(keywords).toContain('user');
      expect(keywords).toContain('profile');
      expect(keywords).toContain('api');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('and');
      expect(keywords).not.toContain('with');
      expect(keywords).not.toContain('an');
    });
  });

  describe('validateTaskQuality', () => {
    const validTitle = 'Implement user profile picture upload & API tests';
    const validDescription =
      'Build the profile picture upload endpoint using AWS S3 presigned URLs. Validate file types to accept only JPEG, PNG, and WebP up to 5MB. Implement client-side crop preview modal in React. Write unit tests for avatar validation logic and API route integration tests covering error boundaries and unauthorized attempts.';

    it('passes for comprehensive title and 40+ word relevant description', () => {
      const result = validateTaskQuality(validTitle, validDescription);
      expect(result.isValid).toBe(true);
      expect(result.wordCount).toBeGreaterThanOrEqual(MIN_DESCRIPTION_WORDS);
      expect(result.titleError).toBeUndefined();
      expect(result.descriptionError).toBeUndefined();
      expect(result.relevanceError).toBeUndefined();
    });

    it('rejects vague titles', () => {
      const vagueTitles = ['work', 'bug fix', 'testing', 'changes', 'development', 'todo'];
      for (const title of vagueTitles) {
        const result = validateTaskQuality(title, validDescription);
        expect(result.isValid).toBe(false);
        expect(result.titleError).toBeDefined();
        expect(result.titleError).toContain('too vague');
      }
    });

    it('rejects description with fewer than 40 words and provides word count in error', () => {
      const shortDesc = 'Fix avatar upload on the profile page and add tests.'; // 10 words
      const result = validateTaskQuality(validTitle, shortDesc);
      expect(result.isValid).toBe(false);
      expect(result.wordCount).toBe(10);
      expect(result.descriptionError).toContain('At least 40 words are required');
      expect(result.descriptionError).toContain('10 words');
    });

    it('rejects repetitive filler text even if word count is 40+', () => {
      const fillerDesc = Array(50).fill('upload').join(' '); // 50 words of "upload"
      const result = validateTaskQuality(validTitle, fillerDesc);
      expect(result.isValid).toBe(false);
      expect(result.descriptionError).toContain('repetitive words or filler text');
    });

    it('rejects when title and description are completely irrelevant to each other', () => {
      const irrelevantDesc =
        'Refactor checkout billing calculations and apply coupon discount percentages on Stripe invoices. Ensure tax computation handles European Union VAT rules correctly across digital products. Update unit tests for currency rounding to prevent fractional cent calculation errors during customer subscription renewals.';
      const result = validateTaskQuality(validTitle, irrelevantDesc);
      expect(result.isValid).toBe(false);
      expect(result.relevanceError).toBeDefined();
      expect(result.relevanceError).toContain('does not appear relevant');
    });
  });
});

