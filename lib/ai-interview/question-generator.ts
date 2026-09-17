import { GoogleGenAI } from '@google/genai';
import {
  CandidateProfile,
  JDRequirements,
  KeywordMatchAnalysis,
  InterviewQuestion,
  QuestionType,
  QuestionDifficulty,
  QuestionGeneratorOptions,
} from './types';

export const MIN_INTERVIEW_QUESTIONS = 10;
export const DEFAULT_MINUTES_PER_QUESTION = 2.5;

/**
 * Calculates the total number of interview questions based on meeting minutes/duration or target options.
 * Enforces a hard minimum of 10 questions regardless of duration.
 */
export function calculateQuestionCount(options?: QuestionGeneratorOptions): number {
  const minFloor = options?.minQuestions || MIN_INTERVIEW_QUESTIONS;

  if (options?.targetQuestions && options.targetQuestions > 0) {
    return Math.max(minFloor, options.targetQuestions);
  }

  if (options?.durationMinutes && options.durationMinutes > 0) {
    const calculatedFromTime = Math.round(options.durationMinutes / DEFAULT_MINUTES_PER_QUESTION);
    return Math.max(minFloor, calculatedFromTime);
  }

  return minFloor;
}

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
 * Guarantees a minimum of 10 questions (or scaled count) based on options.
 */
export function generateQuestionsLocalFallback(
  profile?: CandidateProfile,
  jd?: JDRequirements,
  analysis?: KeywordMatchAnalysis,
  options?: QuestionGeneratorOptions,
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS
): InterviewQuestion[] {
  const targetTotal = calculateQuestionCount(options);
  const hrCount = hrQuestions.length;
  const neededTechnicalCount = Math.max(7, targetTotal - hrCount);

  const matchedSkills = analysis?.matchedKeywords || profile?.extractedSkills || ['Core Technology'];
  const missingSkills = analysis?.missingKeywords || jd?.mustHaveSkills || ['Required Framework'];

  const candidateTitle = jd?.jobTitle || 'Software Engineer';

  const baseHrTemplates: Array<{
    text: string;
    type: QuestionType;
    category: string;
    difficulty: QuestionDifficulty;
    skills: string[];
    intent: string;
  }> = [
    {
      text: `Can you walk us through your professional journey so far and how your background aligns with the requirements of this ${candidateTitle} position?`,
      type: 'hr',
      category: 'experience_overview',
      difficulty: 'easy',
      skills: ['Communication', 'Career Overview'],
      intent: 'Assess candidate presentation skills and relevant career progression.',
    },
    {
      text: `The job description emphasizes skills like ${matchedSkills[0] || 'core competencies'}. How have you demonstrated these strengths in your previous team environments?`,
      type: 'behavioral',
      category: 'role_alignment',
      difficulty: 'easy',
      skills: ['Role Alignment', matchedSkills[0] || 'Teamwork'],
      intent: 'Evaluate practical application of key candidate strengths in a workplace setting.',
    },
    {
      text: `This role requires working with ${missingSkills[0] || 'new methodologies'}. How do you typically adapt when tasked with learning new tools or domain requirements on the job?`,
      type: 'role_specific',
      category: 'adaptability',
      difficulty: 'medium',
      skills: ['Adaptability', 'Growth Mindset'],
      intent: 'Probe candidate learning agility and willingness to bridge skill gaps.',
    },
    {
      text: `Describe a situation where you had a disagreement with a team member or stakeholder regarding project deadlines or priorities. How did you handle it?`,
      type: 'behavioral',
      category: 'conflict_resolution',
      difficulty: 'medium',
      skills: ['Conflict Resolution', 'Empathy'],
      intent: 'Assess interpersonal skills, emotional intelligence, and collaboration.',
    },
    {
      text: `What type of work environment and management style enables you to perform at your best, and how do you handle high-pressure deadlines?`,
      type: 'hr',
      category: 'work_style',
      difficulty: 'easy',
      skills: ['Self-Management', 'Stress Handling'],
      intent: 'Understand candidate work preferences and resilience under pressure.',
    },
    {
      text: `Can you share an example of a project or milestone you are most proud of? What was your specific contribution to the team's success?`,
      type: 'behavioral',
      category: 'achievements',
      difficulty: 'medium',
      skills: ['Ownership', 'Project Impact'],
      intent: 'Measure accountability, personal impact, and pride in work quality.',
    },
    {
      text: `How do you prioritize your daily tasks when managing multiple competing requests or unexpected urgent priorities?`,
      type: 'situational',
      category: 'time_management',
      difficulty: 'medium',
      skills: ['Time Management', 'Prioritization'],
      intent: 'Evaluate organizational skills and task prioritization methodology.',
    },
    {
      text: `Where do you see your career evolving over the next 2 to 3 years, and how does this role fit into your long-term goals?`,
      type: 'hr',
      category: 'career_goals',
      difficulty: 'easy',
      skills: ['Career Vision', 'Long-term Commitment'],
      intent: 'Determine candidate career trajectory and long-term organizational fit.',
    },
    {
      text: `How do you approach receiving constructive feedback or performance critiques from managers or peers?`,
      type: 'behavioral',
      category: 'feedback_reception',
      difficulty: 'easy',
      skills: ['Receptivity', 'Professional Growth'],
      intent: 'Assess openness to feedback and continuous self-improvement.',
    },
    {
      text: `What core values do you believe are most important in a team culture, and how do you contribute to maintaining a positive workplace?`,
      type: 'hr',
      category: 'culture_fit',
      difficulty: 'easy',
      skills: ['Culture Fit', 'Team Building'],
      intent: 'Evaluate alignment with organizational culture and team dynamics.',
    },
  ];

  const generatedHrQuestions: InterviewQuestion[] = [];

  for (let i = 0; i < neededTechnicalCount; i++) {
    const templateIndex = i % baseHrTemplates.length;
    const template = baseHrTemplates[templateIndex];
    const cycleSuffix = i >= baseHrTemplates.length ? ` (Aspect ${Math.floor(i / baseHrTemplates.length) + 1})` : '';

    generatedHrQuestions.push({
      question_text: `${template.text}${cycleSuffix}`,
      question_type: template.type,
      category: template.category,
      difficulty: template.difficulty,
      required_skills: template.skills,
      intent: template.intent,
      time_limit_sec: 150,
      is_mandatory_hr: false,
      question_order: i + 3,
      weight: 10,
    });
  }

  return assembleQuestionSet(generatedHrQuestions, hrQuestions);
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
 * Generates structured HR and behavioral interview questions using Gemini AI based on candidate resume, JD, and meeting duration.
 * Enforces a mandatory minimum of 10 total questions (or scaled quantity for longer durations).
 */
export async function generateInterviewQuestions(
  profile: CandidateProfile,
  jd: JDRequirements,
  analysis: KeywordMatchAnalysis,
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS,
  options?: QuestionGeneratorOptions
): Promise<InterviewQuestion[]> {
  const targetTotalCount = calculateQuestionCount(options);
  const hrCount = hrQuestions.length;
  const requiredAiCount = Math.max(7, targetTotalCount - hrCount);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return generateQuestionsLocalFallback(profile, jd, analysis, options, hrQuestions);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an experienced HR recruiter and hiring manager conducting an HR interview. Generate a structured HR and behavioral interview question set for a candidate based on their resume analysis and Job Description requirements.

Candidate Profile:
- Experience: ${profile.yearsOfExperience || 0} years
- Matched Skills: ${analysis.matchedKeywords.join(', ')}
- Skill Gaps / Missing Keywords: ${analysis.missingKeywords.join(', ')}

Job Description Requirements:
- Title / Role: ${jd.jobTitle || 'Software Engineer'}
- Must-Have Skills: ${jd.mustHaveSkills.join(', ')}
- Duration / Meeting Minutes: ${options?.durationMinutes || 30} minutes

Generate EXACTLY ${requiredAiCount} specific HR, screening, behavioral, situational, and role-alignment interview questions. Focus strictly on HR topics: background overview, role alignment, teamwork, adaptability, conflict resolution, work preferences, career vision, and culture fit. Do NOT generate deep technical coding, system design, or low-level technical architecture questions.

Return ONLY a JSON array with this exact structure:
[
  {
    "question_text": "string",
    "question_type": "hr" | "behavioral" | "role_specific" | "situational",
    "category": "string (e.g. experience_overview, role_alignment, teamwork, culture_fit, adaptability)",
    "difficulty": "easy" | "medium",
    "required_skills": ["string"],
    "intent": "string",
    "time_limit_sec": 150,
    "weight": 10
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
      return generateQuestionsLocalFallback(profile, jd, analysis, options, hrQuestions);
    }

    const rawParsed = JSON.parse(cleanedText);
    if (!Array.isArray(rawParsed) || rawParsed.length === 0) {
      return generateQuestionsLocalFallback(profile, jd, analysis, options, hrQuestions);
    }

    const aiQuestions: InterviewQuestion[] = rawParsed.map((item, idx) => ({
      question_text: item.question_text || `Walk us through your background and interest in the ${jd.jobTitle || 'role'}.`,
      question_type: (item.question_type as QuestionType) || 'hr',
      category: item.category || 'experience_overview',
      difficulty: (item.difficulty as QuestionDifficulty) || 'easy',
      required_skills: Array.isArray(item.required_skills) ? item.required_skills : ['Communication'],
      intent: item.intent || 'Evaluate candidate HR background and role alignment.',
      question_order: idx + 3,
      time_limit_sec: typeof item.time_limit_sec === 'number' ? item.time_limit_sec : 150,
      is_mandatory_hr: false,
      weight: typeof item.weight === 'number' ? item.weight : 10,
    }));

    const assembled = assembleQuestionSet(aiQuestions, hrQuestions);

    // If Gemini returned fewer questions than required (or total < 10), pad using local fallback
    if (assembled.length < targetTotalCount) {
      return generateQuestionsLocalFallback(profile, jd, analysis, options, hrQuestions);
    }

    return assembled;
  } catch (error) {
    console.error('Error calling Gemini for question generation:', error);
    return generateQuestionsLocalFallback(profile, jd, analysis, options, hrQuestions);
  }
}


