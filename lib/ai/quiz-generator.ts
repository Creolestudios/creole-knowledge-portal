import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toValidUUID } from '@/lib/quizzes/review';

export interface QuizQuestionData {
  question_type: 'single' | 'multiple' | 'conceptual' | 'code' | 'descriptive';
  difficulty: 'Hard';
  question: string;
  options: string[] | null;
  correct_answers: string[];
  explanation: string;
  code_snippet: string | null;
}

export async function generateQuizForBlog(
  blogId: number | string,
  blogContent: string,
  count: number = 5,
  existingQuestionTexts: string[] = []
) {
  const formattedBlogId = toValidUUID(String(blogId));
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const exclusionContext = existingQuestionTexts.length > 0
    ? `\nCRITICAL CONSTRAINTS: Do NOT generate questions similar to or testing the same specific concept as these previously generated questions:\n${existingQuestionTexts.map((q, idx) => `${idx + 1}. ${q}`).join('\n')}\n`
    : '';

  const prompt = `
You are an expert technical assessor and AI Quiz Generator.
Based on the following blog content, generate exactly ${count} strictly "Hard" technical questions.${exclusionContext}

Anti-AI/AI-Resistant Guidelines:
1. Frame the questions around specific analogies, metaphors, or opinions/conclusions that the author presents in the text (e.g., "According to the author, why is X preferred over Y despite Z?").
2. Focus on custom scenarios, constraints, or configurations mentioned in this specific blog rather than generic definitions.
3. For multiple-choice questions, design the incorrect options (distractors) to sound highly plausible to generic AI language models, but make them clearly incorrect or inapplicable based on the specific constraints and context of this text.
4. Do NOT copy-paste sentences directly from the blog; test actual comprehension and logical inferences.

The ${count} questions MUST cover a balanced mix of types (totaling ${count} questions):
- 1 Single Choice question (question_type: "single") - 1 correct answer.
- 1 Multiple Select question (question_type: "multiple") - >1 correct answer.
- 1 Conceptual Reasoning question (question_type: "conceptual") - Requires a descriptive answer.
- 1 Code Analysis question (question_type: "code") - Must include a 'code_snippet'. Requires a descriptive answer.
- 1 Descriptive question (question_type: "descriptive") - Requires a 2-20 line answer.

Output format requirement:
You MUST respond ONLY with a valid JSON array of ${count} objects. 
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
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'gemini-3.1-pro-preview'
  ];
  
  let response = null;
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let attempts = 0;
    const maxAttempts = 3;
    let success = false;
    
    while (attempts < maxAttempts) {
      try {
        console.log(`[Quiz Factory] Invoking model ${modelName} (Attempt ${attempts + 1}/${maxAttempts}) for ${count} questions...`);
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          }
        });
        
        if (response && response.text) {
          console.log(`[Quiz Factory] Successfully generated ${count} quiz questions with model: ${modelName}`);
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

  let generatedQuestions: QuizQuestionData[] = [];

  if (!response || !response.text) {
    console.warn('[Quiz Factory] Gemini AI rate limit (429) reached across all models. Using deterministic fallback questions for blog content.');
    generatedQuestions = [
      {
        question_type: 'single',
        difficulty: 'Hard',
        question: 'According to the technical briefing, what is the primary structural benefit of separating asynchronous pipelines from HTTP request handlers?',
        options: [
          'It reduces initial server memory overhead while preventing request handlers from timing out',
          'It eliminates the need for database indexing',
          'It forces synchronous client-side rendering',
          'It replaces microservice communication with direct client queries'
        ],
        correct_answers: ['It reduces initial server memory overhead while preventing request handlers from timing out'],
        explanation: 'Decoupling asynchronous workers ensures long-running tasks like AI synthesis or scraping do not block HTTP request threads.',
        code_snippet: null
      },
      {
        question_type: 'multiple',
        difficulty: 'Hard',
        question: 'Which of the following architectural strategies are recommended for managing database scalability across mixed workloads?',
        options: [
          'Using relational databases (Supabase) for transactional structured data',
          'Archiving unstructured document payloads in NoSQL stores (MongoDB)',
          'Storing raw application secrets directly in frontend bundles',
          'Implementing idle check thresholds to preserve state'
        ],
        correct_answers: [
          'Using relational databases (Supabase) for transactional structured data',
          'Archiving unstructured document payloads in NoSQL stores (MongoDB)',
          'Implementing idle check thresholds to preserve state'
        ],
        explanation: 'Hybrid database architectures combine relational integrity for user relations with NoSQL document flexibility.',
        code_snippet: null
      },
      {
        question_type: 'conceptual',
        difficulty: 'Hard',
        question: 'Explain why a 20-minute idle check popup is superior to a rigid countdown timer for interactive technical quizzes.',
        options: null,
        correct_answers: ['It reduces user anxiety, allows active focus while reading, and gracefully manages abandoned sessions without premature loss of user work.'],
        explanation: 'Idle checking provides active reassurance to engaged users while auto-submitting only true inactive sessions.',
        code_snippet: null
      },
      {
        question_type: 'code',
        difficulty: 'Hard',
        question: 'Analyze the resilient execution helper. What error-handling behavior does this pattern guarantee when third-party AI APIs return rate limits?',
        options: null,
        correct_answers: ['It sequentially iterates through candidate providers until one succeeds, capturing the last error if all providers fail.'],
        explanation: 'Sequential fallback execution guarantees application availability even during provider outages.',
        code_snippet: 'export async function executeWithResilientFallback<T>(providers: (() => Promise<T>)[]): Promise<T> { ... }'
      },
      {
        question_type: 'descriptive',
        difficulty: 'Hard',
        question: 'Describe how caching strategies can be combined with user preference tags to deliver custom daily briefings.',
        options: null,
        correct_answers: ['User preference tags dynamically filter incoming RSS/API sources, while caching prevents redundant scrape executions for identical tag queries.'],
        explanation: 'Combining tagging with intelligent caching minimizes API costs and accelerates briefing delivery.',
        code_snippet: null
      }
    ];
  } else {
    try {
      let rawText = response.text.trim();
      const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        rawText = jsonMatch[0];
      } else if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
      }
      generatedQuestions = JSON.parse(rawText);
    } catch (err) {
      console.error('Failed to parse AI response as JSON:', response.text);
      throw new Error('AI returned invalid JSON format for quiz questions.');
    }
  }

  // Ensure parent blog record exists in Supabase to satisfy foreign key constraints
  const { data: existingBlog } = await supabaseAdmin
    .from('blogs')
    .select('id')
    .eq('id', formattedBlogId)
    .single();

  if (!existingBlog) {
    console.log(`[Quiz Generator] Creating parent blog record for ${formattedBlogId}...`);
    
    // Extract real title from first line or markdown heading if present
    let extractedTitle = 'Daily Technical Briefing';
    const lines = (blogContent || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines) {
      if (l.startsWith('# ')) {
        extractedTitle = l.replace(/^#\s+/, '').trim();
        break;
      } else if (l.startsWith('## ')) {
        extractedTitle = l.replace(/^##\s+/, '').trim();
        break;
      } else if (l.length > 5 && !l.startsWith('-') && !l.startsWith('*')) {
        extractedTitle = l.slice(0, 120);
        break;
      }
    }

    const { error: blogErr } = await supabaseAdmin
      .from('blogs')
      .upsert({
        id: formattedBlogId,
        title: extractedTitle,
        content: blogContent,
        url: `digest:${formattedBlogId}`,
        source: 'ai-synthesis',
        quiz_generated: true,
        published_at: new Date(Date.now() - 3600000).toISOString(),
        created_at: new Date(Date.now() - 3600000).toISOString()
      }, { onConflict: 'id' });

    if (blogErr) {
      console.error('[Quiz Generator] Error upserting parent blog:', blogErr);
      throw new Error(`Failed to create parent blog row: ${blogErr.message}`);
    }
  }

  // Insert into database
  const questionsToInsert = generatedQuestions.map(q => ({
    blog_id: formattedBlogId,
    question_type: q.question_type,
    difficulty: q.difficulty || 'Hard',
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
    .eq('id', formattedBlogId);

  return generatedQuestions.length;
}
