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
export const INTERVIEW_CATEGORIES = [
  'hr',
  'behavioral',
  'experience_overview',
  'role_alignment',
  'project_experience',
  'teamwork',
  'adaptability',
  'conflict_resolution',
  'work_preferences',
  'career_vision',
  'culture_fit',
  'technical',
] as const;

export interface QuestionBankItem {
  id: string;
  category: string;
  question_text: string;
  question_type: QuestionType;
  difficulty: QuestionDifficulty;
  required_skills: string[];
  intent: string;
}

export const QUESTION_BANK: QuestionBankItem[] = [
  { id: 'hr-1', category: 'hr', question_text: 'Please introduce yourself and highlight the experiences most relevant to this role.', question_type: 'hr', difficulty: 'easy', required_skills: ['Communication', 'Self-Awareness'], intent: 'Understand the candidate background and communication style.' },
  { id: 'hr-2', category: 'hr', question_text: 'What are the most important factors you consider when evaluating a new opportunity?', question_type: 'hr', difficulty: 'easy', required_skills: ['Motivation', 'Priorities'], intent: 'Understand candidate motivations and expectations.' },
  { id: 'hr-3', category: 'hr', question_text: 'What type of support helps you perform well when starting a new role?', question_type: 'hr', difficulty: 'easy', required_skills: ['Self-Awareness', 'Communication'], intent: 'Assess onboarding expectations and self-awareness.' },
  { id: 'hr-4', category: 'hr', question_text: 'What is your notice period and when would you be available to start?', question_type: 'hr', difficulty: 'easy', required_skills: ['Availability', 'Planning'], intent: 'Confirm practical hiring requirements.' },
  { id: 'behavioral-1', category: 'behavioral', question_text: 'Tell us about a challenging professional situation and what you learned from handling it.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Reflection', 'Judgment'], intent: 'Assess behavior, ownership, and learning.' },
  { id: 'behavioral-2', category: 'behavioral', question_text: 'Describe a time you received difficult feedback and how you responded.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Receptiveness', 'Growth Mindset'], intent: 'Assess response to feedback.' },
  { id: 'behavioral-3', category: 'behavioral', question_text: 'Tell us about a decision you made with incomplete information.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Decision-Making', 'Accountability'], intent: 'Evaluate judgment under uncertainty.' },
  { id: 'behavioral-4', category: 'behavioral', question_text: 'Describe a professional mistake and the steps you took afterward.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Accountability', 'Learning'], intent: 'Assess ownership and improvement.' },
  { id: 'experience_overview-1', category: 'experience_overview', question_text: 'Walk us through your career journey and the choices that shaped it.', question_type: 'hr', difficulty: 'easy', required_skills: ['Communication', 'Career Overview'], intent: 'Understand career progression.' },
  { id: 'experience_overview-2', category: 'experience_overview', question_text: 'Which previous responsibility best prepared you for this position?', question_type: 'hr', difficulty: 'easy', required_skills: ['Experience', 'Relevance'], intent: 'Connect past experience to the role.' },
  { id: 'experience_overview-3', category: 'experience_overview', question_text: 'What achievement from your previous work best represents your capabilities?', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Impact', 'Communication'], intent: 'Identify meaningful professional impact.' },
  { id: 'experience_overview-4', category: 'experience_overview', question_text: 'Which part of your background would you like us to understand better?', question_type: 'hr', difficulty: 'easy', required_skills: ['Self-Awareness', 'Communication'], intent: 'Give the candidate space to add context.' },
  { id: 'role_alignment-1', category: 'role_alignment', question_text: 'What interests you most about this role and its responsibilities?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Motivation', 'Role Alignment'], intent: 'Assess interest in the position.' },
  { id: 'role_alignment-2', category: 'role_alignment', question_text: 'Which requirement of this role matches your strongest experience?', question_type: 'role_specific', difficulty: 'easy', required_skills: ['Role Alignment', 'Communication'], intent: 'Assess requirement alignment.' },
  { id: 'role_alignment-3', category: 'role_alignment', question_text: 'Which aspect of this role would require the most preparation from you?', question_type: 'role_specific', difficulty: 'medium', required_skills: ['Self-Awareness', 'Planning'], intent: 'Identify preparation needs honestly.' },
  { id: 'role_alignment-4', category: 'role_alignment', question_text: 'How would you define success in this role during your first few months?', question_type: 'situational', difficulty: 'medium', required_skills: ['Planning', 'Results Orientation'], intent: 'Assess expectations and role understanding.' },
  { id: 'project_experience-1', category: 'project_experience', question_text: 'Tell us about a project you are proud of and your specific contribution.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Ownership', 'Project Impact'], intent: 'Measure personal contribution.' },
  { id: 'project_experience-2', category: 'project_experience', question_text: 'What was the biggest challenge in a recent project, and how did you address it?', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Problem Solving', 'Resilience'], intent: 'Assess project problem-solving.' },
  { id: 'project_experience-3', category: 'project_experience', question_text: 'How did you decide what to prioritize during a project?', question_type: 'situational', difficulty: 'medium', required_skills: ['Prioritization', 'Planning'], intent: 'Evaluate project organization.' },
  { id: 'project_experience-4', category: 'project_experience', question_text: 'What would you do differently if you repeated one of your previous projects?', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Reflection', 'Continuous Improvement'], intent: 'Assess learning from project experience.' },
  { id: 'teamwork-1', category: 'teamwork', question_text: 'Describe a time you worked with people who had different working styles.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Collaboration', 'Adaptability'], intent: 'Assess collaboration across differences.' },
  { id: 'teamwork-2', category: 'teamwork', question_text: 'How do you keep teammates informed when your work affects theirs?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Communication', 'Collaboration'], intent: 'Evaluate team communication.' },
  { id: 'teamwork-3', category: 'teamwork', question_text: 'What role do you naturally take when working in a team?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Self-Awareness', 'Teamwork'], intent: 'Understand team contribution style.' },
  { id: 'teamwork-4', category: 'teamwork', question_text: 'Tell us about a time your team achieved a result together.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Collaboration', 'Results'], intent: 'Assess shared ownership.' },
  { id: 'adaptability-1', category: 'adaptability', question_text: 'How do you approach learning an unfamiliar tool, process, or domain?', question_type: 'role_specific', difficulty: 'easy', required_skills: ['Adaptability', 'Learning'], intent: 'Assess learning agility.' },
  { id: 'adaptability-2', category: 'adaptability', question_text: 'Tell us about a time priorities changed unexpectedly.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Adaptability', 'Prioritization'], intent: 'Evaluate response to change.' },
  { id: 'adaptability-3', category: 'adaptability', question_text: 'How do you maintain quality when you must change direction quickly?', question_type: 'situational', difficulty: 'medium', required_skills: ['Quality', 'Resilience'], intent: 'Assess flexibility under pressure.' },
  { id: 'adaptability-4', category: 'adaptability', question_text: 'What is an example of a process or habit you changed after learning something new?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Growth Mindset', 'Improvement'], intent: 'Assess continuous improvement.' },
  { id: 'conflict_resolution-1', category: 'conflict_resolution', question_text: 'Tell us about a disagreement with a teammate and how you resolved it.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Conflict Resolution', 'Empathy'], intent: 'Assess interpersonal judgment.' },
  { id: 'conflict_resolution-2', category: 'conflict_resolution', question_text: 'How would you respond if you disagreed with an important decision?', question_type: 'situational', difficulty: 'medium', required_skills: ['Communication', 'Professionalism'], intent: 'Evaluate respectful challenge.' },
  { id: 'conflict_resolution-3', category: 'conflict_resolution', question_text: 'Describe a time you helped two people reach an agreement.', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Mediation', 'Communication'], intent: 'Assess conflict mediation.' },
  { id: 'conflict_resolution-4', category: 'conflict_resolution', question_text: 'What do you do when a disagreement starts affecting team progress?', question_type: 'situational', difficulty: 'medium', required_skills: ['Leadership', 'Problem Solving'], intent: 'Assess constructive escalation.' },
  { id: 'work_preferences-1', category: 'work_preferences', question_text: 'What type of work environment helps you perform at your best?', question_type: 'hr', difficulty: 'easy', required_skills: ['Self-Awareness', 'Communication'], intent: 'Understand workplace preferences.' },
  { id: 'work_preferences-2', category: 'work_preferences', question_text: 'How do you organize your work when several tasks are competing for attention?', question_type: 'situational', difficulty: 'medium', required_skills: ['Organization', 'Prioritization'], intent: 'Evaluate work organization.' },
  { id: 'work_preferences-3', category: 'work_preferences', question_text: 'How do you prefer to receive direction and feedback from a manager?', question_type: 'hr', difficulty: 'easy', required_skills: ['Communication', 'Self-Awareness'], intent: 'Assess management communication fit.' },
  { id: 'work_preferences-4', category: 'work_preferences', question_text: 'How do you maintain focus during repetitive or routine work?', question_type: 'situational', difficulty: 'easy', required_skills: ['Discipline', 'Consistency'], intent: 'Assess reliability and focus.' },
  { id: 'career_vision-1', category: 'career_vision', question_text: 'What professional skills would you like to develop over the next few years?', question_type: 'hr', difficulty: 'easy', required_skills: ['Growth Mindset', 'Career Planning'], intent: 'Understand development goals.' },
  { id: 'career_vision-2', category: 'career_vision', question_text: 'How does this role fit into your longer-term career direction?', question_type: 'hr', difficulty: 'easy', required_skills: ['Motivation', 'Career Vision'], intent: 'Assess long-term alignment.' },
  { id: 'career_vision-3', category: 'career_vision', question_text: 'What kind of responsibility would you like to take on next?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Ambition', 'Self-Awareness'], intent: 'Understand career aspirations.' },
  { id: 'career_vision-4', category: 'career_vision', question_text: 'What would make your next career step successful?', question_type: 'hr', difficulty: 'easy', required_skills: ['Planning', 'Results Orientation'], intent: 'Clarify success criteria.' },
  { id: 'culture_fit-1', category: 'culture_fit', question_text: 'What team values are most important to you?', question_type: 'hr', difficulty: 'easy', required_skills: ['Values', 'Self-Awareness'], intent: 'Understand cultural preferences.' },
  { id: 'culture_fit-2', category: 'culture_fit', question_text: 'How do you contribute to a respectful and positive team environment?', question_type: 'behavioral', difficulty: 'easy', required_skills: ['Respect', 'Teamwork'], intent: 'Assess contribution to team culture.' },
  { id: 'culture_fit-3', category: 'culture_fit', question_text: 'How do you work effectively with people whose perspectives differ from yours?', question_type: 'behavioral', difficulty: 'medium', required_skills: ['Inclusion', 'Empathy'], intent: 'Assess inclusive collaboration.' },
  { id: 'culture_fit-4', category: 'culture_fit', question_text: 'What does professional integrity mean in everyday work?', question_type: 'hr', difficulty: 'easy', required_skills: ['Integrity', 'Judgment'], intent: 'Understand professional values.' },
  { id: 'technical-1', category: 'technical', question_text: 'Describe a significant project where you used your core technical skills. What was your role and the outcome?', question_type: 'role_specific', difficulty: 'medium', required_skills: ['Technical Experience', 'Communication'], intent: 'Gauge depth of past technical work.' },
  { id: 'technical-2', category: 'technical', question_text: 'Based on your experience, how do you ensure the quality and maintainability of the technical work you deliver?', question_type: 'role_specific', difficulty: 'medium', required_skills: ['Quality Assurance', 'Best Practices'], intent: 'Understand approach to technical quality.' },
  { id: 'technical-3', category: 'technical', question_text: 'Can you discuss a time when you had to quickly learn a new technology or framework to complete a project?', question_type: 'role_specific', difficulty: 'medium', required_skills: ['Learning Agility', 'Technical Depth'], intent: 'Assess technical adaptability.' },
  { id: 'technical-4', category: 'technical', question_text: 'What is the most complex technical problem you have solved in your recent roles, and how did you approach it?', question_type: 'role_specific', difficulty: 'medium', required_skills: ['Problem Solving', 'Technical Depth'], intent: 'Evaluate complex technical problem solving.' },
];

/**
 * Calculates the total number of interview questions from administrator input.
 */
export function calculateQuestionCount(options?: QuestionGeneratorOptions): number {
  if (options?.targetQuestions && options.targetQuestions > 0) {
    return options.targetQuestions;
  }

  if (options?.durationMinutes && options.durationMinutes > 0) {
    const calculatedFromTime = Math.round(options.durationMinutes / DEFAULT_MINUTES_PER_QUESTION);
    return calculatedFromTime;
  }

  return 0;
}

export function getSelectedQuestionBankItems(questionIds: string[]): QuestionBankItem[] {
  const selected = new Set(questionIds);
  return QUESTION_BANK.filter((question) => selected.has(question.id));
}

function buildQuestionsFromBank(questionIds: string[]): InterviewQuestion[] {
  return getSelectedQuestionBankItems(questionIds).map((question, index) => ({
    ...question,
    question_order: index + 1,
    time_limit_sec: 150,
    is_mandatory_hr: false,
    weight: 10,
  }));
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
 */
export function generateQuestionsLocalFallback(
  profile?: CandidateProfile,
  jd?: JDRequirements,
  analysis?: KeywordMatchAnalysis,
  options?: QuestionGeneratorOptions,
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS
): InterviewQuestion[] {
  if (options?.selectedQuestionIds?.length) {
    return buildQuestionsFromBank(options.selectedQuestionIds);
  }

  const targetTotal = calculateQuestionCount(options);
  const selectedHrQuestions = options?.includeMandatoryHr === false ? [] : hrQuestions;
  const requestedCategories = Object.entries(options?.categoryCounts || {}).flatMap(
    ([category, count]) => Array.from({ length: Math.max(0, count) }, () => category)
  );
  const fallbackCategories = requestedCategories.length > 0
    ? requestedCategories
    : Array.from(
        { length: Math.max(0, targetTotal - selectedHrQuestions.length) },
        (_, index) => INTERVIEW_CATEGORIES[index % INTERVIEW_CATEGORIES.length]
      );
  const requiredGeneratedCount = Math.max(0, targetTotal - selectedHrQuestions.length);

  const matchedSkills = analysis?.matchedKeywords || profile?.extractedSkills || ['Core Technology'];
  const missingSkills = analysis?.missingKeywords || jd?.mustHaveSkills || ['Required Framework'];

  const candidateTitle = jd?.jobTitle || 'Software Engineer';

  type HrTemplate = {
    text: string;
    type: QuestionType;
    category: string;
    difficulty: QuestionDifficulty;
    skills: string[];
    intent: string;
  };

  // [text, type, category, difficulty, skills, intent] — tuple form keeps this
  // template bank from reading as 12 near-identical object-literal blocks.
  const hrTemplateRows: [string, QuestionType, string, QuestionDifficulty, string[], string][] = [
    [
      `Please introduce yourself and highlight the experiences that best prepare you for this ${candidateTitle} role.`,
      'hr', 'hr', 'easy', ['Communication', 'Self-Awareness'],
      'Understand the candidate background and communication style.',
    ],
    [
      'Tell us about a challenging professional situation and what you learned from handling it.',
      'behavioral', 'behavioral', 'medium', ['Reflection', 'Judgment'],
      'Assess behavior, ownership, and learning from experience.',
    ],
    [
      `Can you walk us through your professional journey so far and how your background aligns with the requirements of this ${candidateTitle} position?`,
      'hr', 'experience_overview', 'easy', ['Communication', 'Career Overview'],
      'Assess candidate presentation skills and relevant career progression.',
    ],
    [
      `The job description emphasizes skills like ${matchedSkills[0] || 'core competencies'}. How have you demonstrated these strengths in your previous team environments?`,
      'behavioral', 'role_alignment', 'easy', ['Role Alignment', matchedSkills[0] || 'Teamwork'],
      'Evaluate practical application of key candidate strengths in a workplace setting.',
    ],
    [
      `This role requires working with ${missingSkills[0] || 'new methodologies'}. How do you typically adapt when tasked with learning new tools or domain requirements on the job?`,
      'role_specific', 'adaptability', 'medium', ['Adaptability', 'Growth Mindset'],
      'Probe candidate learning agility and willingness to bridge skill gaps.',
    ],
    [
      `Describe a situation where you had a disagreement with a team member or stakeholder regarding project deadlines or priorities. How did you handle it?`,
      'behavioral', 'conflict_resolution', 'medium', ['Conflict Resolution', 'Empathy'],
      'Assess interpersonal skills, emotional intelligence, and collaboration.',
    ],
    [
      `What type of work environment and management style enables you to perform at your best, and how do you handle high-pressure deadlines?`,
      'hr', 'work_preferences', 'easy', ['Self-Management', 'Stress Handling'],
      'Understand candidate work preferences and resilience under pressure.',
    ],
    [
      `Can you share an example of a project or milestone you are most proud of? What was your specific contribution to the team's success?`,
      'behavioral', 'project_experience', 'medium', ['Ownership', 'Project Impact'],
      'Measure accountability, personal impact, and pride in work quality.',
    ],
    [
      `How do you prioritize your daily tasks when managing multiple competing requests or unexpected urgent priorities?`,
      'situational', 'teamwork', 'medium', ['Time Management', 'Prioritization'],
      'Evaluate organizational skills and task prioritization methodology.',
    ],
    [
      `Where do you see your career evolving over the next 2 to 3 years, and how does this role fit into your long-term goals?`,
      'hr', 'career_vision', 'easy', ['Career Vision', 'Long-term Commitment'],
      'Determine candidate career trajectory and long-term organizational fit.',
    ],
    [
      `How do you approach receiving constructive feedback or performance critiques from managers or peers?`,
      'behavioral', 'feedback_reception', 'easy', ['Receptivity', 'Professional Growth'],
      'Assess openness to feedback and continuous self-improvement.',
    ],
    [
      `What core values do you believe are most important in a team culture, and how do you contribute to maintaining a positive workplace?`,
      'hr', 'culture_fit', 'easy', ['Culture Fit', 'Team Building'],
      'Evaluate alignment with organizational culture and team dynamics.',
    ],
    [
      `Based on your resume, you have experience with ${matchedSkills[0] || 'various technologies'}. Could you elaborate on a complex project where you utilized these skills, and describe the specific technical challenges you overcame?`,
      'role_specific', 'technical', 'medium', ['Technical Depth', 'Experience'],
      'Gauge depth of technical knowledge and practical application based on past work.',
    ],
  ];

  const baseHrTemplates: HrTemplate[] = hrTemplateRows.map(
    ([text, type, category, difficulty, skills, intent]) => ({ text, type, category, difficulty, skills, intent })
  );

  const generatedHrQuestions: InterviewQuestion[] = [];

  for (let i = 0; i < requiredGeneratedCount; i++) {
    const requestedCategory = fallbackCategories[i] || INTERVIEW_CATEGORIES[i % INTERVIEW_CATEGORIES.length];
    const template = baseHrTemplates.find((item) => item.category === requestedCategory)
      || baseHrTemplates[i % baseHrTemplates.length];
    const cycleSuffix = i >= baseHrTemplates.length ? ` (Perspective ${Math.floor(i / baseHrTemplates.length) + 1})` : '';

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
      is_fallback: true,
    });
  }

  return assembleQuestionSet(generatedHrQuestions, selectedHrQuestions).slice(0, targetTotal || undefined);
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
 * Generates questions using the administrator's requested count, duration, and categories.
 */
export async function generateInterviewQuestions(
  profile: CandidateProfile,
  jd: JDRequirements,
  analysis: KeywordMatchAnalysis,
  hrQuestions: InterviewQuestion[] = DEFAULT_MANDATORY_HR_QUESTIONS,
  options?: QuestionGeneratorOptions
): Promise<InterviewQuestion[]> {
  if (options?.selectedQuestionIds?.length) {
    return buildQuestionsFromBank(options.selectedQuestionIds);
  }

  const targetTotalCount = calculateQuestionCount(options);
  const selectedHrQuestions = options?.includeMandatoryHr === false ? [] : hrQuestions;
  const requiredAiCount = Math.max(0, targetTotalCount - selectedHrQuestions.length);
  
  // Guarantee exactly 4 technical questions
  const categoryCounts: Record<string, number> = { ...(options?.categoryCounts || {}) };
  categoryCounts['technical'] = 4;
  
  // Distribute remaining question count among other categories if not explicitly provided
  let currentSum = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  if (currentSum < requiredAiCount) {
    let remaining = requiredAiCount - currentSum;
    let i = 0;
    while (remaining > 0) {
      const cat = INTERVIEW_CATEGORIES[i % INTERVIEW_CATEGORIES.length];
      if (cat !== 'technical' && cat !== 'hr') {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        remaining--;
      }
      i++;
    }
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

  if (!apiKey) {
    return generateQuestionsLocalFallback(profile, jd, analysis, { ...options, categoryCounts }, selectedHrQuestions);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an experienced HR recruiter and hiring manager.

Candidate profile:
- Experience: ${profile.yearsOfExperience || 0} years
- Matched skills: ${analysis.matchedKeywords.join(', ')}
- Skill gaps: ${analysis.missingKeywords.join(', ')}

Job description:
- Role: ${jd.jobTitle || 'the position'}
- Must-have skills: ${jd.mustHaveSkills.join(', ')}
- Interview duration: ${options?.durationMinutes || 'administrator-defined'} minutes

Generate EXACTLY ${requiredAiCount} generalized questions for these categories: ${Object.keys(categoryCounts).join(', ')}.
Honor these exact category counts: ${JSON.stringify(categoryCounts)}.
Focus on HR, behavioral, experience overview, role alignment, project experience, teamwork, adaptability, conflict resolution, work preferences, career vision, culture fit, and technical experience.
For the 'technical' category questions (you must generate exactly 4), focus on gauging their past work, language proficiency, and depth of knowledge based on their resume and projects. Do NOT ask deep coding (like writing code algorithms), system design, or low-level architecture questions. DO ask about their practical experience with the skills they claim (${analysis.matchedKeywords.join(', ')}).

Return only a JSON array. Each item must contain question_text, question_type, category, difficulty, required_skills, intent, time_limit_sec, and weight.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    console.log('TRACE: response:', response);

    const cleanedText = (response.text || '').replace(/```json\n?|\n?```/g, '').trim();
    console.log('TRACE: cleanedText:', cleanedText);
    if (!cleanedText) {
      console.log('TRACE: falling back due to empty cleanedText');
      return generateQuestionsLocalFallback(profile, jd, analysis, options, selectedHrQuestions);
    }

    const rawParsed = JSON.parse(cleanedText);
    if (!Array.isArray(rawParsed) || rawParsed.length < requiredAiCount) {
      console.log('TRACE: falling back due to invalid rawParsed');
      return generateQuestionsLocalFallback(profile, jd, analysis, options, selectedHrQuestions);
    }

    const aiQuestions: InterviewQuestion[] = rawParsed.slice(0, requiredAiCount).map((item, idx) => ({
      question_text: item.question_text || `Tell us about your experience relevant to the ${jd.jobTitle || 'role'}.`,
      question_type: (item.question_type as QuestionType) || 'hr',
      category: item.category || 'experience_overview',
      difficulty: (item.difficulty as QuestionDifficulty) || 'easy',
      required_skills: Array.isArray(item.required_skills) ? item.required_skills : ['Communication'],
      intent: item.intent || 'Evaluate candidate experience and alignment.',
      question_order: idx + 1,
      time_limit_sec: typeof item.time_limit_sec === 'number' ? item.time_limit_sec : 150,
      is_mandatory_hr: false,
      weight: typeof item.weight === 'number' ? item.weight : 10,
    }));

    const requestedCategoryEntries = Object.entries(categoryCounts).filter(([, count]) => count > 0);
    const selectedAiQuestions = requestedCategoryEntries.length > 0
      ? requestedCategoryEntries.flatMap(([category, count]) => {
          const matchingQuestions = aiQuestions.filter(
            (question) => question.category.toLowerCase() === category.toLowerCase()
          );
          return matchingQuestions.slice(0, count);
        })
      : aiQuestions;

    if (selectedAiQuestions.length !== requiredAiCount) {
      console.log('FALLBACK TRIGGERED IN IF CONDITION! requested:', requiredAiCount, 'got:', selectedAiQuestions.length);
      return generateQuestionsLocalFallback(profile, jd, analysis, { ...options, categoryCounts }, selectedHrQuestions);
    }

    const assembled = assembleQuestionSet(selectedAiQuestions, selectedHrQuestions).slice(0, targetTotalCount || undefined);
    console.log('RETURNING ASSEMBLED:', JSON.stringify(assembled));
    return assembled;
  } catch (error) {
    console.log('CRITICAL ERROR IN GEMINI PATH:', error);
    return generateQuestionsLocalFallback(profile, jd, analysis, { ...options, categoryCounts }, selectedHrQuestions);
  }
}


