import { GoogleGenAI } from '@google/genai';

export interface EvaluationResult {
  isCorrect: boolean;
  points: number;
  reason: string;
  matchPercentage: number;
}

export async function evaluateDescriptiveAnswer(
  questionType: string,
  question: string,
  expectedConcepts: string[],
  userAnswer: string
): Promise<EvaluationResult> {
  const maxPoints = (questionType === 'code' || questionType === 'descriptive') ? 2 : 1;
  const PASSING_THRESHOLD = 70;

  if (!userAnswer || userAnswer.trim().length === 0) {
    return {
      isCorrect: false,
      points: 0,
      reason: 'No answer provided.',
      matchPercentage: 0,
    };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const prompt = `
You are an expert technical assessor grading a developer's quiz answer.
You need to evaluate the semantic similarity between the user's answer and the expected core concepts.

Question: "${question}"
Question Type: "${questionType}"
Expected Core Concepts / Correct Answer Basis: 
${expectedConcepts.map(c => `- ${c}`).join('\n')}

User's Answer:
"${userAnswer}"

Analyze the user's answer strictly but fairly based on semantic meaning, not just exact words. 
Assign a "matchPercentage" from 0 to 100 representing how closely the user's answer aligns with the expected concepts.
- 90-100: Excellent. Captures all core concepts perfectly, even if phrased differently.
- 70-89: Good. Core concept is correct, but minor details might be missing or vague.
- 50-69: Partial. Shows partial understanding but misses significant pieces or has inaccuracies.
- 1-49: Poor. Fundamentally incorrect but uses some related keywords in context.
- 0: Completely wrong or irrelevant.

You MUST respond ONLY with a valid JSON object strictly matching this format:
{
  "matchPercentage": number,
  "reason": "string (A short 1-2 sentence explanation of your grading decision)"
}
  `.trim();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    let rawText = (response.text ?? '').trim();
    if (rawText.startsWith('```json')) {
      rawText = rawText.replace(/^```json\n/, '').replace(/\n```$/, '');
    }
    
    const result = JSON.parse(rawText);
    const matchPercentage = typeof result.matchPercentage === 'number' ? result.matchPercentage : 0;
    
    const isCorrect = matchPercentage >= PASSING_THRESHOLD;
    
    // Partial points logic
    let points = 0;
    if (maxPoints === 2) {
      if (matchPercentage >= 85) points = 2;
      else if (matchPercentage >= 50) points = 1;
    } else {
      if (matchPercentage >= 70) points = 1;
    }
    
    return {
      isCorrect,
      points,
      reason: result.reason || (isCorrect ? 'Correct.' : 'Incorrect.'),
      matchPercentage
    };
  } catch (error) {
    console.error('[Quiz Evaluator] Error evaluating answer with AI, falling back to heuristic evaluation:', error);
    
    // Heuristic fallback: percentage based on matched concepts
    const userTextLower = userAnswer.toLowerCase();
    const validConcepts = (expectedConcepts || []).filter(c => c.trim().length > 2);
    
    if (validConcepts.length === 0) {
      return { isCorrect: false, points: 0, reason: 'Evaluation failed and no valid concepts found.', matchPercentage: 0 };
    }

    let matchCount = 0;
    for (const c of validConcepts) {
      if (userTextLower.includes(c.toLowerCase().trim())) {
        matchCount++;
      }
    }

    const matchPercentage = Math.round((matchCount / validConcepts.length) * 100);
    const isCorrect = matchPercentage >= PASSING_THRESHOLD;
    
    let points = 0;
    if (maxPoints === 2) {
      if (matchPercentage >= 85) points = 2;
      else if (matchPercentage >= 50) points = 1;
    } else {
      if (matchPercentage >= 70) points = 1;
    }

    return {
      isCorrect,
      points,
      reason: isCorrect
        ? 'Answer aligns with expected concepts based on heuristic check.'
        : 'Answer did not align closely with expected concepts.',
      matchPercentage
    };
  }
}
