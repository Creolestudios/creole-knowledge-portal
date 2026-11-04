import { describe, it, expect } from 'vitest';
import { parseDurationToMinutes, parseZohoCommentDate, extractPlannedMinutesFromTask } from './client';
import {
  calculateTimeAdherence,
  evaluateWorkAndCommentMatch,
  detectRepetitiveTask,
  computeCompositeTaskScore,
  generateDynamicPerformanceSummary,
  detectPendingScope,
} from './heuristics';

describe('Zoho Heuristics Engine', () => {
  describe('calculateTimeAdherence (+5m / -15m Buffer)', () => {
    it('awards 10/10 score when task is 4 hours and user logs up to 4 hours 5 minutes (+5m buffer)', () => {
      // 4 hours = 240 mins, 4:05 = 245 mins (+5 mins)
      const result = calculateTimeAdherence(240, 245);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(5);
      expect(result.assessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');
      expect(result.explanation).toContain('Full score (10/10) awarded');
    });

    it('awards 10/10 score when task is 4 hours and user logs down to 3 hours 45 minutes (-15m buffer)', () => {
      // 4 hours = 240 mins, 3:45 = 225 mins (-15 mins)
      const result = calculateTimeAdherence(240, 225);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(-15);
      expect(result.assessmentLabel).toBe('ON_TIME');
      expect(result.explanation).toContain('Full score (10/10) awarded');
    });

    it('awards 10/10 score when task is completed exactly on planned time', () => {
      const result = calculateTimeAdherence(120, 120);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(0);
      expect(result.assessmentLabel).toBe('ON_TIME');
    });

    it('penalizes early completion when gap exceeds 15 minutes (e.g. 4h task done in 3h 30m)', () => {
      // 4 hours = 240 mins, 3:30 = 210 mins (-30 mins variance, 15m beyond buffer)
      const result = calculateTimeAdherence(240, 210);
      expect(result.timeScore).toBeLessThan(10);
      expect(result.timeVarianceMinutes).toBe(-30);
      expect(result.assessmentLabel).toBe('UNEXPECTED_EARLY');
      expect(result.explanation).toContain('beyond the -15m buffer');
    });

    it('penalizes overdue task when overtime exceeds 5-minute buffer (e.g. 4h task took 4h 15m)', () => {
      // 4 hours = 240 mins, 4:15 = 255 mins (+15 mins variance, 10m beyond buffer)
      const result = calculateTimeAdherence(240, 255);
      expect(result.timeScore).toBeLessThan(10);
      expect(result.timeVarianceMinutes).toBe(15);
      expect(result.assessmentLabel).toBe('OVERDUE');
      expect(result.explanation).toContain('beyond the +5m buffer');
    });

    it('returns score 0 and NOT_LOGGED label when user has logged 0 minutes', () => {
      const result = calculateTimeAdherence(480, 0);
      expect(result.timeScore).toBe(0);
      expect(result.assessmentLabel).toBe('NOT_LOGGED');
      expect(result.explanation).toContain('No hours were logged');
    });
  });

  describe('evaluateWorkAndCommentMatch', () => {
    it('awards high score (>= 8.5/10) when comments match description and document completed work', () => {
      const desc = 'Implement Image Upload Validation and Review Server Settings';
      const comments = [
        'Added client-side image size validation and server-side MIME type checks. Configured upload limit to 10MB and tested edge cases. PR submitted.',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeGreaterThanOrEqual(8.5);
      expect(result.alignmentLabel).toBe('STRONG_ALIGNMENT');
      expect(result.explanation).toContain('strongly justify the description');
    });

    it('penalizes score to 0 when task description is provided but zero comments were logged', () => {
      const desc = 'Write unit tests for authentication endpoint';
      const result = evaluateWorkAndCommentMatch(desc, []);
      expect(result.workMatchScore).toBe(0);
      expect(result.alignmentLabel).toBe('NO_COMMENTS');
      expect(result.explanation).toContain('Score is 0');
    });

    it('penalizes score when comment is superficial (e.g. just "done")', () => {
      const desc = 'Refactor database models and add migration scripts';
      const result = evaluateWorkAndCommentMatch(desc, ['done']);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.5);
      expect(result.alignmentLabel).toBe('WEAK_ALIGNMENT');
      expect(result.explanation).toContain('superficial');
    });

    it('penalizes score when comment simply copy-pastes description and appends "- Done" checklist markers', () => {
      const desc = 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.';
      const comments = [
        'Do Server (Ubuntu) Upgrade. - Done Do php upgrade - Done Update 3 plugins on live - 1 is done 2 are pending which are depnedent on key by client. Testing on live. - Done',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.0);
      expect(result.isChecklistComment).toBe(true);
      expect(result.isBriefDescription).toBe(true);
      expect(result.alignmentLabel).toBe('WEAK_ALIGNMENT');
      expect(result.explanation).toContain('mirror the task checklist with status indicators');
    });

    it('strictly penalizes score (<= 5.2/10) when extended duration task leaves deliverables pending with checklist markers (Navratan case)', () => {
      const desc = `Cash Free Integration
Gemstone for Every purpose detail page image change
S3 Bucket integration
check with anant sir about CTA Ai else will do video section changes for the 2-3 sections on the mobile and desktop different videos.`;

      const comments = [
        `Cash Free Integration - Added the plugin and configured , Testing is pending as there is some issue in cart cant go till the payment section. Gemstone for Every purpose detail page image change - Done S3 Bucket integration - Done check with anant sir about CTA Ai else will do video section changes for the 2-3 sections on the mobile and desktop different videos. - Pending (Instead did the mega menu discussed in todays meeting)
Note: 1Hr of meeting is logged in this task itself.`
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments, {
        taskName: 'CTA for the Kundli and Gemstone suggestion (first need to confirm from Anant Sir. ) , Few feed back...',
        plannedMinutes: 480,
        actualMinutes: 479,
        userExperienceYears: 2,
        seniorityLevel: 'Junior',
        aiSubscriptions: [],
      });

      expect(result.workMatchScore).toBeLessThanOrEqual(5.2);
      expect(result.hasPendingScope).toBe(true);
      expect(result.hasMeetingLogged).toBe(true);
      expect(result.isChecklistComment).toBe(true);
      expect(result.isPartialDelivery).toBe(true);
      expect(result.alignmentLabel).toBe('PARTIAL_DELIVERY');
      expect(result.explanation).toContain('left pending or unverified');

      const dynSummary = generateDynamicPerformanceSummary({
        taskDescription: desc,
        comments,
        timeAssessmentLabel: 'ON_TIME',
        workMatchScore: result.workMatchScore,
        seniorityLevel: 'Junior',
        userExperienceYears: 2,
        isQAReview: true,
      });

      expect(dynSummary.whereLacked).toContain('pending or unverified');
      expect(dynSummary.improvementItems.some(i => i.includes('Pending Deliverables') || i.includes('Pending'))).toBe(true);
      expect(dynSummary.improvementItems.some(i => i.includes('Separate Meeting Logs') || i.includes('meeting'))).toBe(true);
    });

    it('does not penalize architectural roadmap notes (e.g. "remain deferred") when current deliverables are fully completed and tested', () => {
      const desc = 'Will continue developing the project-scoped searchable library for Meridian, supporting document uploads, text extraction, full-text search, secure downloads, and item management. Will complete the Supabase storage migration and prepare the backend foundation for UI integration.';
      const comments = [
        '- Worked on MAS-302 to implement a centralized, project-scoped library for uploaded documents and horizon-scan items. - Implemented the database foundation in the hosted development environment, including default project folders, foundational and must-read tagging, and full-text search. - Built backend support for PDF, Word, PowerPoint, and plain-text uploads, including text extraction for searchable content. - Implemented secure download links and library item deletion. - Confirmed that legacy .doc and .ppt files can be stored but are not yet searchable; audio and video support remain deferred. - Completed Phase 2 storage, upload, download, and delete functionality, with local testing and API/extraction tests passing. - Verified that unauthenticated requests are rejected. - Documented the design decision that search results are not automatically saved to projects; analysts must explicitly link relevant items. - Ensured document text is excluded from edit history to avoid permanently duplicating confidential document content.',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments, {
        plannedMinutes: 240,
        actualMinutes: 257,
        userExperienceYears: 2,
        seniorityLevel: 'Mid',
      });

      expect(result.hasPendingScope).toBe(false);
      expect(result.isPartialDelivery).toBe(false);
      expect(result.workMatchScore).toBeGreaterThanOrEqual(9.0);
      expect(result.alignmentLabel).toBe('STRONG_ALIGNMENT');
    });

    it('penalizes score when task description is vague and brief (e.g. "Continue AI chatbot research")', () => {
      const desc = 'Continue AI chatbot research. Make home page section changes';
      const comments = ['Worked on chatbot and updated home page sections'];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.5);
      expect(result.isBriefDescription).toBe(true);
      expect(result.isBriefComment).toBe(true);
    });

    it('strictly penalizes task score (capped at 3.0/10) when description is completely missing but comments exist', () => {
      const desc = '';
      const comments = [
        'Implemented the feature and resolved database query bottlenecks. All unit tests passing cleanly.',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBe(3.0);
      expect(result.alignmentLabel).toBe('MISSING_TASK_DESCRIPTION');
      expect(result.isMissingDescription).toBe(true);
      expect(result.explanation).toContain('Task description is completely missing in Zoho Projects');
    });

    it('dynamically penalizes score when a Senior with Antigravity Pro logs inflated time', () => {
      const desc = 'Add form validation to 3 inputs on profile settings';
      const comments = ['Added regex validation for phone and zip code. Form updates properly.'];

      // Planned 4h (240m), Senior with Antigravity Pro benchmark is ~1.2h (72m), but logged 4.5h (270m)
      const result = evaluateWorkAndCommentMatch(desc, comments, {
        userExperienceYears: 6,
        seniorityLevel: 'Senior',
        aiSubscriptions: ['Antigravity Pro'],
        plannedMinutes: 240,
        actualMinutes: 270,
      });

      expect(result.timeReasonableness).toBeDefined();
      expect(result.timeReasonableness?.velocityLabel).toBe('TIME_INFLATED_FOR_AI_TIER');
      expect(result.timeReasonableness?.penalty).toBeGreaterThan(0);
      expect(result.workMatchScore).toBeLessThan(7.0);
    });

    it('awards velocity bonus when a Junior with Antigravity Pro delivers within benchmark', () => {
      const desc = 'Build responsive user profile card with badge components';
      const comments = [
        'Implemented card layout with Antigravity Pro assistance. Added Tailwind classes and wrote 4 unit tests.',
      ];

      // Planned 4h (240m), Junior with Antigravity Pro benchmark is ~3.5h, logged 3.2h (192m)
      const result = evaluateWorkAndCommentMatch(desc, comments, {
        userExperienceYears: 1,
        seniorityLevel: 'Junior',
        aiSubscriptions: ['Antigravity Pro'],
        plannedMinutes: 240,
        actualMinutes: 192,
      });

      expect(result.timeReasonableness).toBeDefined();
      expect(result.timeReasonableness?.velocityLabel).toBe('OPTIMAL');
      expect(result.timeReasonableness?.bonus).toBeGreaterThan(0);
      expect(result.workMatchScore).toBeGreaterThanOrEqual(9.0);
    });
  });

  describe('detectRepetitiveTask', () => {
    it('detects repetitive task when title and description are almost identical', () => {
      const historical = [
        {
          id: 'task-1',
          name: 'Fix UI alignment on user dashboard header',
          description: 'Adjust css padding and flex alignment for responsive cards',
        },
      ];

      const current = {
        name: 'Fix UI alignment on user dashboard header',
        description: 'Adjust padding and flex alignment on responsive cards',
      };

      const result = detectRepetitiveTask(current.name, current.description, historical);
      expect(result.isRepetitive).toBe(true);
      expect(result.similarityPct).toBeGreaterThanOrEqual(60);
      expect(result.matchedTaskId).toBe('task-1');
      expect(result.repetitionScore).toBeLessThan(10);
    });

    it('passes unique tasks with full score (10/10)', () => {
      const historical = [
        {
          id: 'task-1',
          name: 'Setup PostgreSQL migrations for user roles',
          description: 'Add RLS policies and indexes on auth users',
        },
      ];

      const current = {
        name: 'Implement OAuth callback handler for Zoho API',
        description: 'Store refresh token securely in encrypted vault',
      };

      const result = detectRepetitiveTask(current.name, current.description, historical);
      expect(result.isRepetitive).toBe(false);
      expect(result.repetitionScore).toBe(10);
      expect(result.matchedTaskId).toBeNull();
    });
  });

  describe('computeCompositeTaskScore', () => {
    it('correctly calculates weighted score out of 10 with QA review bonus', () => {
      const score = computeCompositeTaskScore({
        timeScore: 9.0,
        commentQualityScore: 8.5,
        complexityScore: 8.0,
        repetitionScore: 10.0,
        isQAReview: true,
      });

      // 8.5*0.45 + 9.0*0.35 + 8.0*0.10 + 10.0*0.10 = 3.825 + 3.15 + 0.8 + 1.0 = 8.775 + 0.3 (QA bonus) = 9.075 -> 9.1
      // Base score: 8.775 -> 8.8 (points remain as it is when in QA Review)
      expect(score).toBe(8.8);
      expect(score).toBeLessThanOrEqual(10.0);
    });

    it('deducts points from composite score when status is not moved to QA review (e.g. In Progress or Backlog)', () => {
      const scoreWithoutQA = computeCompositeTaskScore({
        timeScore: 9.0,
        commentQualityScore: 8.5,
        complexityScore: 8.0,
        repetitionScore: 10.0,
        isQAReview: false,
      });

      // 8.775 - 1.0 (1.0 point deduction when not in QA review) = 7.775 -> 7.8
      expect(scoreWithoutQA).toBe(7.8);
    });

    it('returns 0.0 when both time and comments are zero (unlogged and no comments)', () => {
      const unloggedScore = computeCompositeTaskScore({
        timeScore: 0,
        commentQualityScore: 0,
        complexityScore: 6.0,
        repetitionScore: 10.0,
        isQAReview: false,
      });
      expect(unloggedScore).toBe(0.0);
    });
  });

  describe('generateDynamicPerformanceSummary', () => {
    it('generates non-repetitive performance summary without repeating numerical hours or variance', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Implement audio chunking logic for interview transcription',
        comments: ['Implemented 30-second audio buffer with fallback to local storage. Unit tests verified.'],
        timeAssessmentLabel: 'OVERDUE',
        workMatchScore: 9.0,
        seniorityLevel: 'Senior',
        userExperienceYears: 5,
        aiSubscriptions: ['GitHub Copilot'],
        isQAReview: true,
      });

      // Does not repeat raw numerical hours or stats
      expect(summary.performanceSummary).not.toContain('mins');
      expect(summary.performanceSummary).toContain('Task implementation was successfully executed');
      expect(summary.performanceSummary.split('\n').length).toBeGreaterThanOrEqual(3);

      // Flags where user lacked based on overdue status
      expect(summary.whereLacked).toContain('Exceeded the scheduled delivery buffer');

      // Provides actionable advice factoring in active AI tools
      expect(summary.whereToImprove).toContain('GitHub Copilot');
      expect(summary.improvementItems.length).toBeGreaterThanOrEqual(2);
    });

    it('flags lack of progress comments when comments array is empty', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Refactor database indexing',
        comments: [],
        timeAssessmentLabel: 'ON_TIME',
        workMatchScore: 0,
        seniorityLevel: 'Junior',
        userExperienceYears: 1,
      });

      expect(summary.whereLacked).toContain('Lacked progress comments');
      expect(summary.whereToImprove).toContain('Always log a brief technical wrap-up in Zoho');
    });

    it('flags checklist comments and vague descriptions with actionable guidance without mentioning word counts', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.',
        comments: [
          'Do Server (Ubuntu) Upgrade. - Done Do php upgrade - Done Update 3 plugins on live - 1 is done 2 are pending which are depnedent on key by client. Testing on live. - Done',
        ],
        timeAssessmentLabel: 'ON_TIME',
        workMatchScore: 4.8,
        seniorityLevel: 'Mid',
        userExperienceYears: 3,
      });

      // Does not mention explicit word count numbers
      expect(summary.performanceSummary).not.toMatch(/\b\d+\s*words\b/i);
      expect(summary.whereLacked).not.toMatch(/\b\d+\s*words\b/i);
      expect(summary.whereToImprove).not.toMatch(/\b\d+\s*words\b/i);

      // Flags checklist and brief description specifically
      expect(summary.whereLacked).toContain('status markers');
      expect(summary.improvementItems.some((i) => i.includes('Explain Work Done Beyond Status Updates'))).toBe(true);
      expect(summary.improvementItems.some((i) => i.includes('Define Comprehensive Task Scope'))).toBe(true);

      // Instructs user on 40-50 words benchmark inside improvementItems only
      expect(summary.improvementItems.some((i) => i.includes('40–50 words') || i.includes('40-50 words'))).toBe(true);
      expect(summary.performanceSummary).not.toContain('40');
      expect(summary.whereLacked).not.toContain('40');
      expect(summary.whereToImprove).not.toContain('40');
    });
  });

  describe('parseDurationToMinutes & Clock Conversion', () => {
    it('accurately parses 8.25 decimal hours to 495 minutes (8h 15m)', () => {
      expect(parseDurationToMinutes(8.25)).toBe(495);
      expect(parseDurationToMinutes('8.25')).toBe(495);
    });

    it('accurately parses colon duration strings like 08:15 and 8:15 to 495 minutes', () => {
      expect(parseDurationToMinutes('08:15')).toBe(495);
      expect(parseDurationToMinutes('8:15')).toBe(495);
    });

    it('preserves H.MM timesheet entries like 3.55 (235m) and 3.18 (198m)', () => {
      expect(parseDurationToMinutes(3.55)).toBe(235);
      expect(parseDurationToMinutes(3.18)).toBe(198);
    });

    it('handles clean integers like 4 to 240 minutes and 0 to 0', () => {
      expect(parseDurationToMinutes(4)).toBe(240);
      expect(parseDurationToMinutes(0)).toBe(0);
      expect(parseDurationToMinutes(null)).toBe(0);
    });
  });

  describe('parseZohoCommentDate', () => {
    it('safely parses Indian/UK format date string "30-10-2026 07:10 PM" without throwing', () => {
      const iso = parseZohoCommentDate('30-10-2026 07:10 PM');
      expect(iso).toBeDefined();
      expect(iso).toContain('2026-10-30');
    });

    it('safely handles millisecond timestamps', () => {
      const timestamp = 1793361000000;
      const iso = parseZohoCommentDate(null, timestamp);
      expect(iso).toBe(new Date(timestamp).toISOString());
    });

    it('gracefully falls back to current time on empty or invalid inputs', () => {
      const iso = parseZohoCommentDate(null);
      expect(iso).toBeDefined();
      expect(new Date(iso).getTime()).toBeGreaterThan(0);
    });
  });

  describe('extractPlannedMinutesFromTask', () => {
    it('extracts planned minutes from explicit duration when present', () => {
      expect(extractPlannedMinutesFromTask('4:00', null, 'Some task')).toBe(240);
      expect(extractPlannedMinutesFromTask(2, null, 'Some task')).toBe(120);
    });

    it('extracts bracketed duration from task name when raw duration is 0 or missing', () => {
      expect(extractPlannedMinutesFromTask(0, null, 'Shelter pets detail page - [4 hours]')).toBe(240);
      expect(extractPlannedMinutesFromTask(null, null, 'Starting on service page - [2 hours ]')).toBe(120);
      expect(extractPlannedMinutesFromTask(0, null, 'Research on user role wise action in sign in and sign up - [2 hours]')).toBe(120);
      expect(extractPlannedMinutesFromTask(null, null, 'Working on the pricing page of a sailor [6.5 hours]')).toBe(390);
    });

    it('extracts suffix hours from task name when raw duration is 0', () => {
      expect(extractPlannedMinutesFromTask(0, null, 'Working on contact form validation  4 hrs')).toBe(240);
      expect(extractPlannedMinutesFromTask(null, null, 'Making a custom theme for sailor template  8hrs')).toBe(480);
    });

    it('defaults to 240 minutes (4 hours) when duration is completely missing', () => {
      expect(extractPlannedMinutesFromTask(null, null, 'Task with no specified duration')).toBe(240);
      expect(extractPlannedMinutesFromTask(0, null, '')).toBe(240);
    });
  });
  describe('detectPendingScope (Context-Aware Pending vs Roadmap)', () => {
    it('does not flag out-of-scope or roadmap deferral notes as pending', () => {
      const comment1 = 'Confirmed that legacy .doc and .ppt files can be stored but are not yet searchable; audio and video support remain deferred.';
      expect(detectPendingScope(comment1).hasPendingScope).toBe(false);

      const comment2 = 'Implemented core auth flow. Social logins are deferred to phase 2.';
      expect(detectPendingScope(comment2).hasPendingScope).toBe(false);

      const comment3 = 'Full search is working. Video indexing is out of scope for this milestone.';
      expect(detectPendingScope(comment3).hasPendingScope).toBe(false);
    });

    it('does not flag completed resolutions of past pending items', () => {
      const comment = 'Resolved all pending code review comments and verified responsive layouts across mobile devices.';
      expect(detectPendingScope(comment).hasPendingScope).toBe(false);

      const comment2 = 'Fixed pending auth bug reported by QA yesterday and completed testing.';
      expect(detectPendingScope(comment2).hasPendingScope).toBe(false);
    });

    it('strictly detects actual unfinished deliverables and checklist pending stamps', () => {
      const comment1 = '- Feature implementation: Done\n- Unit tests: Pending';
      expect(detectPendingScope(comment1).hasPendingScope).toBe(true);

      const comment2 = 'Testing is pending as there is some issue in cart cant go till payment.';
      expect(detectPendingScope(comment2).hasPendingScope).toBe(true);

      const comment3 = 'Could not complete the API integration due to missing staging credentials; will finish tomorrow.';
      expect(detectPendingScope(comment3).hasPendingScope).toBe(true);
    });
  });

});
