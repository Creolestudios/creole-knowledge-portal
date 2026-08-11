import { GoogleGenAI } from '@google/genai';

export interface EvaluationResult {
  isCorrect: boolean;
  points: number;
  reason: string;
}

export async function evaluateDescriptiveAnswer(
  questionType: string,
  question: string,
  expectedConcepts: string[],
  userAnswer: string
): Promise<EvaluationResult> {
  const maxPoints = (questionType === 'code' || questionType === 'descriptive') ? 2 : 1;

  if (!userAnswer || userAnswer.trim().length === 0) {
    return {
      isCorrect: false,
      points: 0,
      reason: 'No answer provided.',
    };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const prompt = `
You are an expert technical assessor grading a developer's quiz answer.
You need to evaluate if the user's answer demonstrates a correct understanding of the concepts.

Question: "${question}"
Question Type: "${questionType}"
Expected Core Concepts / Correct Answer Basis: 
${expectedConcepts.map(c => `- ${c}`).join('\n')}

User's Answer:
"${userAnswer}"

Analyze the user's answer strictly but fairly. If they capture the essence of the expected concepts, mark it as correct. If it is fundamentally flawed, vague, or incorrect, mark it as incorrect.

You MUST respond ONLY with a valid JSON object strictly matching this format:
{
  "isCorrect": boolean,
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

    let rawText = response.text.trim();
    if (rawText.startsWith('\`\`\`json')) {
      rawText = rawText.replace(/^\`\`\`json\n/, '').replace(/\n\`\`\`$/, '');
    }
    
    const result = JSON.parse(rawText);
    
    return {
      isCorrect: result.isCorrect,
      points: result.isCorrect ? maxPoints : 0,
      reason: result.reason,
    };
  } catch (error) {
    console.error('[Quiz Evaluator] Error evaluating answer:', error);
    // Fallback if AI fails: mark incorrect with a note
    return {
      isCorrect: false,
      points: 0,
      reason: 'Evaluation failed due to high demand. Please try again or contact support.',
    };
  }
}
