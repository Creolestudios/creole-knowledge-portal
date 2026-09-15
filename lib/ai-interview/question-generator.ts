import { GoogleGenAI } from '@google/genai';
import {
  CandidateProfile,
  JDRequirements,
  KeywordMatchAnalysis,
  InterviewQuestion,
  QuestionType,
  QuestionDifficulty,
} from './types';

export const DEFAULT_MANDATORY_HR_QUESTIONS: InterviewQuestion[] = [
  {
    question_text:
      'Please introduce yourself and highlight your most relevant professional experience.',
    question_type: 'hr',
    category: 'hr',
    difficulty: 'easy',
    required_skills: ['Communication', 'Self-Awareness'],
    intent: 'Assess candidate introduction, presentation skills, and overview of experience.',
    question_order: 1,
    time_limit_sec: 120,
    is_mandatory_hr: true,
    weight: 5,
  },
  {
    question_text:
      'Why are you interested in this position and what makes you a strong candidate for our team?',
    question_type: 'behavioral',
    category: 'behavioral',
    difficulty: 'easy',
    required_skills: ['Motivation', 'Cultural Fit'],
    intent: 'Evaluate candidate interest, role alignment, and enthusiasm.',
    question_order: 2,
    time_limit_sec: 120,
    is_mandatory_hr: true,
    weight: 5,
  },
  {
    question_text:
      'What is your official notice period, current location, and expected availability to join?',
    question_type: 'hr',
    category: 'hr',
    difficulty: 'easy',
    required_skills: ['Logistics', 'Availability'],
    intent: 'Verify administrative constraints and notice period.',
    question_order: 99,
    time_limit_sec: 60,
    is_mandatory_hr: true,
    weight: 5,
  },
];

/**
 * Local fallback generator when Gemini AI is not configured or fails.
 */
export function generateQuestionsLocalFallback(
  profile?: CandidateProfile,
  jd?: JDRequirements,
  analysis?: KeywordMatchAnalysis
): InterviewQuestion[] {
  const matchedSkills = analysis?.matchedKeywords || profile?.extractedSkills || ['Core Technology'];
  const missingSkills = analysis?.missingKeywords || jd?.mustHaveSkills || ['Required Framework'];

  const generatedTechnical: InterviewQuestion[] = [
    {
      question_text: `Can you walk us through a recent project where you utilized ${matchedSkills[0] || 'your core technical stack'} and explain the key architectural decisions you made?`,
      question_type: 'technical',
      category: matchedSkills[0] || 'core_skill',
      difficulty: 'medium',
      required_skills: matchedSkills.slice(0, 2),
      intent: 'Evaluate technical depth and practical project experience.',
      time_limit_sec: 180,
      is_mandatory_hr: false,
      question_order: 3,
      weight: 15,
    },
    {
      question_text: `The job description requires experience with ${missingSkills[0] || 'new framework'}. How would you approach learning and implementing solutions using this skill gap?`,
      question_type: 'role_specific',
      category: missingSkills[0] || 'skill_gap',
      difficulty: 'medium',
      required_skills: [missingSkills[0] || 'Adaptability'],
      intent: 'Probe identified skill gap and candidate adaptability.',
      time_limit_sec: 180,
      is_mandatory_hr: false,
      question_order: 4,
      weight: 15,
    },
    {
      question_text: `Describe a challenging bug or production incident you encountered with ${matchedSkills[1] || 'software development'}. How did you diagnose and resolve it?`,
      question_type: 'situational',
      category: 'problem_solving',
      difficulty: 'hard',
      required_skills: ['Debugging', 'Problem Solving'],
      intent: 'Test troubleshooting skills and resilience under pressure.',
      time_limit_sec: 180,
      is_mandatory_hr: false,
      question_order: 5,
      weight: 20,
    },
    {
      question_text: `How do you ensure high performance, maintainability, and testing standards in a team environment?`,
      question_type: 'behavioral',
      category: 'best_practices',
      difficulty: 'medium',
      required_skills: ['Code Quality', 'Teamwork'],
      intent: 'Check adherence to engineering standards and teamwork.',
      time_limit_sec: 150,
      is_mandatory_hr: false,
      question_order: 6,
      weight: 10,
    },
  ];

  return assembleQuestionSet(generatedTechnical, DEFAULT_MANDATORY_HR_QUESTIONS);
}

/**
 * Combines AI-generated questions with mandatory HR questions and sets proper sequential order.
 */
export function assembleQuestionSet(
  aiQuestions: InterviewQuestion[],
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS
): InterviewQuestion[] {
  const introHr = hrQuestions.filter((q) => q.question_order < 50);
  const closingHr = hrQuestions.filter((q) => q.question_order >= 50);

  const orderedList: InterviewQuestion[] = [];
  let currentIndex = 1;

  introHr.forEach((q) => {
    orderedList.push({ ...q, question_order: currentIndex++ });
  });

  aiQuestions.forEach((q) => {
    orderedList.push({ ...q, question_order: currentIndex++ });
  });

  closingHr.forEach((q) => {
    orderedList.push({ ...q, question_order: currentIndex++ });
  });

  return orderedList;
}

/**
 * Generates structured interview questions using Gemini AI based on candidate resume and JD.
 */
export async function generateInterviewQuestions(
  profile: CandidateProfile,
  jd: JDRequirements,
  analysis: KeywordMatchAnalysis,
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS
): Promise<InterviewQuestion[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return generateQuestionsLocalFallback(profile, jd, analysis);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are a senior technical interviewer and recruiter. Generate a structured interview question set for a candidate based on their resume analysis and Job Description requirements.

Candidate Profile:
- Experience: ${profile.yearsOfExperience || 0} years
- Matched Skills: ${analysis.matchedKeywords.join(', ')}
- Skill Gaps / Missing Keywords: ${analysis.missingKeywords.join(', ')}

Job Description Requirements:
- Title / Role: ${jd.jobTitle || 'Software Engineer'}
- Must-Have Skills: ${jd.mustHaveSkills.join(', ')}

Generate 4 to 6 specific technical, role-specific, situational, and behavioral interview questions tailored to verify candidate strengths and probe missing skill gaps.

Return ONLY a JSON array with this exact structure:
[
  {
    "question_text": "string",
    "question_type": "technical" | "role_specific" | "behavioral" | "situational" | "system_design",
    "category": "string (e.g. skill gap, core skill, problem solving)",
    "difficulty": "easy" | "medium" | "hard",
    "required_skills": ["string"],
    "intent": "string",
    "time_limit_sec": 180,
    "weight": 15
  }
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const text = response.text || '';
    const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();

    if (!cleanedText) {
      return generateQuestionsLocalFallback(profile, jd, analysis);
    }

    const rawParsed = JSON.parse(cleanedText);
    if (!Array.isArray(rawParsed)) {
      return generateQuestionsLocalFallback(profile, jd, analysis);
    }

    const aiQuestions: InterviewQuestion[] = rawParsed.map((item, idx) => ({
      question_text: item.question_text || `Explain your experience with ${jd.mustHaveSkills[0] || 'core technologies'}.`,
      question_type: (item.question_type as QuestionType) || 'technical',
      category: item.category || 'core_skill',
      difficulty: (item.difficulty as QuestionDifficulty) || 'medium',
      required_skills: Array.isArray(item.required_skills) ? item.required_skills : [],
      intent: item.intent || 'Assess technical competence.',
      question_order: idx + 3,
      time_limit_sec: typeof item.time_limit_sec === 'number' ? item.time_limit_sec : 180,
      is_mandatory_hr: false,
      weight: typeof item.weight === 'number' ? item.weight : 10,
    }));

    return assembleQuestionSet(aiQuestions, hrQuestions);
  } catch (error) {
    console.error('Error calling Gemini for question generation:', error);
    return generateQuestionsLocalFallback(profile, jd, analysis);
  }
}
