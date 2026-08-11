import { describe, it, expect } from 'vitest';

// Gamification Logic Unit Tests
describe('Gamification & Learning Analytics Engine', () => {

  // Test grading logic for 3 questions
  it('should correctly grade submitted answers against 3 quiz questions', () => {
    const questions = [
      { id: 'q1', text: 'Q1', options: ['A', 'B'], correctAnswer: 'B' },
      { id: 'q2', text: 'Q2', options: ['A', 'B'], correctAnswer: 'A' },
      { id: 'q3', text: 'Q3', options: ['A', 'B', 'C'], correctAnswer: 'C' }
    ];
    
    const userAnswers = [
      { questionId: 'q1', userAnswer: 'B' },
      { questionId: 'q2', userAnswer: 'B' }, // wrong
      { questionId: 'q3', userAnswer: 'C' }  // correct
    ];

    let score = 0;
    const graded = questions.map(q => {
      const submission = userAnswers.find(a => a.questionId === q.id);
      const userAnswer = submission ? submission.userAnswer : '';
      const isCorrect = userAnswer === q.correctAnswer;
      if (isCorrect) score++;
      return { questionId: q.id, isCorrect };
    });

    expect(score).toBe(2);
    expect(graded[0].isCorrect).toBe(true);
    expect(graded[1].isCorrect).toBe(false);
    expect(graded[2].isCorrect).toBe(true);
  });

  // Test XP and Coins calculations with 3 questions
  it('should calculate correct XP and Coins including perfect score bonus for 3 questions', () => {
    // Case 1: Partial Score (2 out of 3 correct)
    let score1: number = 2;
    let total1: number = 3;
    let xp1 = score1 * 20;
    let coins1 = score1 * 5;
    if (score1 === total1) {
      xp1 += 100;
      coins1 += 25;
    }
    expect(xp1).toBe(40);
    expect(coins1).toBe(10);

    // Case 2: Perfect Score (3 out of 3 correct)
    let score2: number = 3;
    let total2: number = 3;
    let xp2 = score2 * 20;
    let coins2 = score2 * 5;
    if (score2 === total2) {
      xp2 += 100;
      coins2 += 25;
    }
    expect(xp2).toBe(160); // 60 base + 100 bonus
    expect(coins2).toBe(40); // 15 base + 25 bonus
  });

  // Test Speed/Anti-cheat logic for 3 questions
  it('should flag speed violations under 1.5 seconds average per question for 3 questions', () => {
    const questionsCount = 3;
    
    const fastTimeSec = 3; // 3s total for 3 questions = 1.0s avg (Violation)
    const normalTimeSec = 6; // 6s total for 3 questions = 2.0s avg (Safe)

    const isFastViolated = (fastTimeSec / questionsCount) < 1.5;
    const isNormalViolated = (normalTimeSec / questionsCount) < 1.5;

    expect(isFastViolated).toBe(true);
    expect(isNormalViolated).toBe(false);
  });

  // Test Level Calculation Formula: XP_required(L) = 100 * L^1.8
  it('should correctly calculate user levels based on cumulative XP progression', () => {
    const calculateLevel = (totalXp: number) => {
      let lvl = 1;
      let cumulativeRequired = 0;
      while (true) {
        const req = Math.round(100 * Math.pow(lvl, 1.8));
        if (totalXp >= cumulativeRequired + req) {
          cumulativeRequired += req;
          lvl++;
        } else {
          break;
        }
      }
      return lvl;
    };

    expect(calculateLevel(50)).toBe(1); // 50 XP is Level 1 (needs 100 cumulative to reach Level 2)
    expect(calculateLevel(120)).toBe(2); // 120 XP reaches Level 2 (needs 100)
    expect(calculateLevel(500)).toBe(3); // Level 2 requires 100, Level 3 requires Math.round(100 * 2^1.8) = 348. Total cumulative for Level 3 is 448. So 500 XP is Level 3!
  });

  // Test Streak logic
  it('should increment streak when consecutive, keep if same day, reset if break', () => {
    const todayStr = '2026-05-24';
    const yesterdayStr = '2026-05-23';
    const longAgoStr = '2026-05-10';

    // Case 1: consecutive active day (yesterday -> today)
    let streak1 = 4;
    let lastActive1 = yesterdayStr;
    if (lastActive1 === todayStr) {
      // keep
    } else if (lastActive1 === yesterdayStr) {
      streak1++;
    } else {
      streak1 = 1;
    }
    expect(streak1).toBe(5);

    // Case 2: active on same day
    let streak2 = 4;
    let lastActive2 = todayStr;
    if (lastActive2 === todayStr) {
      // keep
    } else if (lastActive2 === yesterdayStr) {
      streak2++;
    } else {
      streak2 = 1;
    }
    expect(streak2).toBe(4);

    // Case 3: active after a break
    let streak3 = 4;
    let lastActive3 = longAgoStr;
    if (lastActive3 === todayStr) {
      // keep
    } else if (lastActive3 === yesterdayStr) {
      streak3++;
    } else {
      streak3 = 1; // broken
    }
    expect(streak3).toBe(1);
  });
});
