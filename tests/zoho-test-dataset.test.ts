import { describe, it, expect } from 'vitest';
import { getTestDatasetUsers } from '@/lib/mock/zoho-test-dataset';

describe('Zoho Test Dataset (13 Users, 43 Test Cases)', () => {
  it('creates 13 distinct user profiles with strict AI subscription and seniority boundaries', () => {
    const users = getTestDatasetUsers();
    expect(users).toHaveLength(13);
    expect(users.map((u) => u.email)).toEqual([
      'test.user1@creolestudios.com',
      'test.user2@creolestudios.com',
      'test.user3@creolestudios.com',
      'test.user4@creolestudios.com',
      'test.user5@creolestudios.com',
      'test.user6@creolestudios.com',
      'test.user7@creolestudios.com',
      'test.user8@creolestudios.com',
      'test.user9@creolestudios.com',
      'test.user10@creolestudios.com',
      'test.user11@creolestudios.com',
      'test.user12@creolestudios.com',
      'test.user13@creolestudios.com',
    ]);

    // Test User 1: Junior with ZERO AI subscriptions
    const testUser1 = users.find((u) => u.email === 'test.user1@creolestudios.com')!;
    expect(testUser1.aiSubscriptions).toEqual([]);
    expect(testUser1.name).toBe('Test User 1');
    expect(testUser1.seniorityLevel).toBe('Junior');

    // Test User 2: Mid-Level with ZERO AI subscriptions
    const testUser2 = users.find((u) => u.email === 'test.user2@creolestudios.com')!;
    expect(testUser2.aiSubscriptions).toEqual([]);
    expect(testUser2.seniorityLevel).toBe('Mid');

    // Test User 4: Junior with GitHub Copilot
    const testUser4 = users.find((u) => u.email === 'test.user4@creolestudios.com')!;
    expect(testUser4.aiSubscriptions).toEqual(['GitHub Copilot']);
    expect(testUser4.seniorityLevel).toBe('Junior');

    // Test User 6: Mid-Level with Cursor AI
    const testUser6 = users.find((u) => u.email === 'test.user6@creolestudios.com')!;
    expect(testUser6.aiSubscriptions).toEqual(['Cursor AI']);
    expect(testUser6.seniorityLevel).toBe('Mid');

    // Test User 13: Senior with Claude Pro
    const testUser13 = users.find((u) => u.email === 'test.user13@creolestudios.com')!;
    expect(testUser13.aiSubscriptions).toEqual(['Claude Pro']);
    expect(testUser13.seniorityLevel).toBe('Senior');
  });

  it('aggregates all 43 test cases across the 13 users', () => {
    const users = getTestDatasetUsers();
    const totalTasks = users.reduce(
      (sum, u) => sum + u.dailyEvaluations.reduce((dSum, d) => dSum + d.tasks.length, 0),
      0
    );
    expect(totalTasks).toBe(43);
  });

  it('calculates real evaluation scores and valid badges for every test task', () => {
    const users = getTestDatasetUsers();

    for (const user of users) {
      expect(user.filterSummary!.totalHoursLogged).toBeGreaterThanOrEqual(0);
      expect(user.filterSummary!.weeklyAvgScore).toBeGreaterThanOrEqual(0);

      for (const day of user.dailyEvaluations) {
        expect(day.dayScore).toBeGreaterThanOrEqual(0);
        expect(day.tasks.length).toBeGreaterThan(0);

        for (const task of day.tasks) {
          expect(task.evaluation).toBeDefined();
          expect(task.evaluation!.overallScore).toBeGreaterThanOrEqual(0.0);
          expect(task.evaluation!.overallScore).toBeLessThanOrEqual(10.0);
          expect(task.evaluation!.timeScore).toBeGreaterThanOrEqual(0.0);
          expect(task.evaluation!.timeScore).toBeLessThanOrEqual(10.0);
          expect(task.evaluation!.workMatchScore).toBeGreaterThanOrEqual(0.0);
          expect(task.evaluation!.workMatchScore).toBeLessThanOrEqual(10.0);
        }
      }
    }
  });

  it('verifies Case 05 under Test User 1 (No AI) receives evaluation under Junior profile', () => {
    const users = getTestDatasetUsers();
    const user1 = users.find((u) => u.email === 'test.user1@creolestudios.com')!;
    const allUser1Tasks = user1.dailyEvaluations.flatMap((d) => d.tasks);
    const case05 = allUser1Tasks.find((t) => t.taskName.includes('Responsive Search Filter'))!;

    expect(case05).toBeDefined();
    expect(case05.evaluation?.overallScore).toBeGreaterThanOrEqual(7.0);
    expect(case05.evaluation?.timeScore).toBe(10);
    expect(case05.evaluation?.timeAssessmentLabel).toBe('ON_TIME');
    expect(
      case05.evaluation?.improvementItems?.some((item) => item.includes('Complexity & Velocity Calibration'))
    ).toBe(true);

    const case11 = allUser1Tasks.find((t) => t.taskName.includes('Candidate Roster Search Filter and Query Matching'))!;
    expect(case11).toBeDefined();
    expect(
      case11.evaluation?.improvementItems?.some((item) => item.includes('Status Not Moved to In QA Review'))
    ).toBe(true);
  });

  it('verifies Case 01 under Test User 4 (Junior + Copilot) receives top marks for automated unit tests', () => {
    const users = getTestDatasetUsers();
    const user4 = users.find((u) => u.email === 'test.user4@creolestudios.com')!;
    const allUser4Tasks = user4.dailyEvaluations.flatMap((d) => d.tasks);
    const case01 = allUser4Tasks.find((t) => t.taskName.includes('PostgreSQL Row Level Security'))!;

    expect(case01).toBeDefined();
    expect(case01.evaluation?.overallScore).toBe(9.8);
    expect(case01.evaluation?.timeScore).toBe(10);
    expect(case01.evaluation?.timeAssessmentLabel).toBe('ON_TIME');
  });

  it('verifies Case 43 under Test User 2 (Mid-Level + No AI) achieves zero score (0.0/10) for unlogged worst-case combination', () => {
    const users = getTestDatasetUsers();
    const user2 = users.find((u) => u.email === 'test.user2@creolestudios.com')!;
    const allUser2Tasks = user2.dailyEvaluations.flatMap((d) => d.tasks);
    const case43 = allUser2Tasks.find((t) => t.taskName.includes('System Updates & Maintenance'))!;

    expect(case43).toBeDefined();
    expect(case43.evaluation?.overallScore).toBe(0.0);
    expect(case43.evaluation?.timeScore).toBe(0.0);
    expect(case43.evaluation?.workMatchScore).toBe(0.0);
  });

  it('verifies Case 34 and Case 37 evaluation details under Test User 5', () => {
    const users = getTestDatasetUsers();
    const user5 = users.find((u) => u.email === 'test.user5@creolestudios.com')!;
    const allTasks = user5.dailyEvaluations.flatMap((d) => d.tasks);
    const case34 = allTasks.find((t) => t.taskName.includes('Case 34'))!;
    const case37 = allTasks.find((t) => t.taskName.includes('Case 37'))!;

    expect(case37).toBeDefined();
    expect(case37.evaluation?.workMatchScore).toBe(0.0);
    expect(case37.evaluation?.overallScore).toBe(5.3);
    expect(
      case37.evaluation?.improvementItems?.some((item) =>
        item.includes('Missing Task Description: Task description is completely missing in Zoho Projects. Score was set to 0.0/10.')
      )
    ).toBe(true);

    expect(case34).toBeDefined();
    expect(case34.evaluation?.workMatchScore).toBe(5.5);
    expect(case34.evaluation?.overallScore).toBe(7.8);
    expect(
      case34.evaluation?.improvementItems?.some((item) =>
        item.includes('4.5 points was deducted from the score') &&
        item.includes('Task description was overly brief (5 words)')
      )
    ).toBe(true);
  });

  it('prints all 43 tasks with bracketed case numbers and predictive scores', () => {
    const users = getTestDatasetUsers();
    for (const u of users) {
      console.log(`\n=== ${u.name} (${u.aiSubscriptions.length ? u.aiSubscriptions.join(', ') : 'No AI Subscriptions'}) ===`);
      for (const day of u.dailyEvaluations) {
        for (const t of day.tasks) {
          const ev = t.evaluation;
          const badge = !t.actualMinutes && (!t.comments || t.comments.length === 0)
            ? 'No Comments'
            : (ev?.overallScore || 0) >= 8.0
            ? 'Justified'
            : (ev?.overallScore || 0) >= 6.0
            ? 'Partial'
            : 'Less Accurate';

          console.log(
            `* ${t.taskName} | Planned: ${t.plannedHours}h | Actual: ${t.actualHours}h | Score: ${ev?.overallScore}/10 | WorkMatch: ${ev?.workMatchScore}/10 | Time: ${ev?.timeScore}/10 (${ev?.timeAssessmentLabel}) | Badge: ${badge}`
          );
        }
      }
    }
  });
});
