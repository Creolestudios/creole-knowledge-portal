import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface QuizQuestionData {
  question_type: 'single' | 'multiple' | 'conceptual' | 'code' | 'descriptive';
  difficulty: 'Hard';
  question: string;
  options: string[] | null;
  correct_answers: string[];
  explanation: string;
  code_snippet: string | null;
}

export async function generateQuizForBlog(blogId: number | string, blogContent: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const prompt = `
You are an expert technical assessor and AI Quiz Generator.
Based on the following blog content, generate exactly 5 strictly "Hard" technical questions.
Do NOT copy-paste sentences from the blog; instead, create scenario-based, behavioral, and deep-conceptual questions that test true understanding of the material.

The 5 questions MUST strictly cover one of each of the following types:
- 1 Single Choice question (question_type: "single") - 1 correct answer.
- 1 Multiple Select question (question_type: "multiple") - >1 correct answer.
- 1 Conceptual Reasoning question (question_type: "conceptual") - Requires a descriptive answer.
- 1 Code Analysis question (question_type: "code") - Must include a 'code_snippet'. Requires a descriptive answer.
- 1 Descriptive question (question_type: "descriptive") - Requires a 2-20 line answer.

Output format requirement:
You MUST respond ONLY with a valid JSON array of 5 objects. 
Each object must match this structure exactly:
{
  "question_type": "single" | "multiple" | "conceptual" | "code" | "descriptive",
  "difficulty": "Hard",
  "question": "string",
  "options": ["string", "string", "string", "string"] | null, // null for conceptual/code/descriptive
  "correct_answers": ["string", ...], // EXACT matching string(s) from options for single/multiple, or the expected core concepts for the descriptive types
  "explanation": "string", // Detailed explanation of why the answer is correct
  "code_snippet": "string" | null // Required for 'code' type, otherwise null
}

Ensure the JSON is perfectly formatted and does not contain markdown codeblocks (like \`\`\`json) outside of the array. Output ONLY the JSON array.

Blog Content:
${blogContent}
  `.trim();

  const modelsToTry = [
    'gemini-3.1-pro',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];
  
  let response = null;
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let attempts = 0;
    const maxAttempts = 3;
    let success = false;
    
    while (attempts < maxAttempts) {
      try {
        console.log(`[Quiz Factory] Invoking model ${modelName} (Attempt ${attempts + 1}/${maxAttempts})...`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          }
        });
        
        if (response && response.text) {
          console.log(`[Quiz Factory] Successfully generated quiz with model: ${modelName}`);
          success = true;
          break;
        }
      } catch (err: any) {
        attempts++;
        lastError = err;
        const errMsg = String(err.message || err);
        const isTransient = errMsg.includes('503') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('demand');
        
        if (isTransient && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, attempts * 2000));
        } else {
          break;
        }
      }
    }
    if (success && response && response.text) {
      break;
    }
  }

  if (!response || !response.text) {
    throw new Error(`Failed to generate quiz: ${lastError?.message || 'High demand on Gemini services'}`);
  }

  let generatedQuestions: QuizQuestionData[] = [];
  try {
    let rawText = response.text.trim();
    if (rawText.startsWith('\`\`\`json')) {
      rawText = rawText.replace(/^\`\`\`json\n/, '').replace(/\n\`\`\`$/, '');
    }
    generatedQuestions = JSON.parse(rawText);
  } catch (err) {
    console.error('Failed to parse AI response as JSON:', response.text);
    throw new Error('AI returned invalid JSON format for quiz questions.');
  }

  // Insert into database
  const questionsToInsert = generatedQuestions.map(q => ({
    blog_id: blogId,
    question_type: q.question_type,
    difficulty: q.difficulty,
    question: q.question,
    options: q.options,
    correct_answers: q.correct_answers,
    explanation: q.explanation,
    code_snippet: q.code_snippet
  }));

  const { error } = await supabaseAdmin
    .from('quiz_questions')
    .insert(questionsToInsert);

  if (error) {
    console.error('Error inserting quiz questions:', error);
    throw error;
  }
  
  // Mark blog as having a quiz
  await supabaseAdmin
    .from('blogs')
    .update({ quiz_generated: true })
    .eq('id', blogId);

  return generatedQuestions.length;
}
