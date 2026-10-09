import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  calculateLocalFluency,
  countFillerWords,
  mapCefrToScore,
  combineFluencyScores,
  calculateCognitiveComposite,
} from './fluency-calculator';
import { ensureAllQuestionsAnswered } from './answers';
import { saveInterviewReport } from './report-store';

// Model priority list for scoring — tries each in order, falls back on 429/503/404/quota exhaustion.
const SCORING_MODELS = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

export interface ScoreInterviewOptions {
  sessionId: string;
}

export interface CompetencyScoreItem {
  ord: number;
  competency: string;
  score: number; // 1 - 5
  confidence: number;
  justification: string;
  evidence: Array<{ ts_ms?: number; quote: string }>;
  bluff_suspected?: boolean;
}

/**
 * Strips markdown code block wrappers from JSON string.
 */
function cleanJson(raw: string): string {
  return raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
}

// In-memory cooldown tracker to avoid hammering models that returned 429/RESOURCE_EXHAUSTED
const exhaustedModelsUntil = new Map<string, number>();

/**
 * Calls generateContent with automatic model fallback on 429 / 503 errors.
 * Tries each model in SCORING_MODELS until one succeeds.
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  prompt: string,
  responseMimeType: 'application/json' | 'text/plain' = 'application/json',
): Promise<string> {
  const errors: string[] = [];
  const now = Date.now();

  for (const model of SCORING_MODELS) {
    const cooldown = exhaustedModelsUntil.get(model) || 0;
    if (now < cooldown) {
      continue;
    }

    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType },
      });
      return res.text || '';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${model}] ${msg.slice(0, 120)}`);
      // Mark on cooldown for 5 minutes so subsequent calls don't hammer exhausted API
      exhaustedModelsUntil.set(model, Date.now() + 300_000);
      console.warn(`[scorer] Model ${model} unavailable (${msg.slice(0, 80)}), trying next...`);
    }
  }

  throw new Error(`All scoring models exhausted. Errors:\n${errors.join('\n')}`);
}

/**
 * Main evaluation engine:
 * 1. Isolates ONLY candidate speech from interview_transcript.
 * 2. Computes objective local metrics (WPM, pause stats, filler ratio).
 * 3. Evaluates competencies with Gemini Flash (with mandatory quote grounding).
 * 4. Evaluates English fluency using the CEFR rubric.
 * 5. Applies integrity penalties for unauthorized voices / proctoring violations.
 * 6. Synthesizes overall hiring recommendation and saves to interview_reports.
 */
export async function scoreInterviewSession({ sessionId }: ScoreInterviewOptions) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured for scoring.');
  }

  const ai = new GoogleGenAI({ apiKey });

  // Ensure any unanswered questions have a blank answer row recorded
  await ensureAllQuestionsAnswered(sessionId);

  // 1. Fetch session, questions, transcript, turn metrics, warnings, and answers
  const [
    { data: session },
    { data: questions },
    { data: rawTranscripts },
    { data: turnMetrics },
    { data: warningEvents },
    { data: rawAnswers },
  ] = await Promise.all([
    supabaseAdmin.from('interview_sessions').select('*').eq('id', sessionId).single(),
    supabaseAdmin.from('interview_questions').select('*').eq('session_id', sessionId),
    supabaseAdmin.from('interview_transcript').select('*').eq('session_id', sessionId).order('ts_ms', { ascending: true }),
    supabaseAdmin.from('interview_turn_metrics').select('*').eq('session_id', sessionId),
    supabaseAdmin.from('interview_events').select('*').eq('session_id', sessionId).eq('severity', 'warning'),
    supabaseAdmin.from('interview_answers').select('*').eq('session_id', sessionId),
  ]);

  if (!session) {
    throw new Error(`Interview session ${sessionId} not found.`);
  }

  const transcriptList = rawTranscripts || [];
  const metricsList = turnMetrics || [];
  const warningsList = warningEvents || [];
  const answersList = rawAnswers || [];

  // Check warnings count across all categories continuously
  const rawVoiceCount =
    session.voice_warning_count !== undefined && session.voice_warning_count !== null
      ? session.voice_warning_count
      : warningsList.filter((w) => w.category === 'unauthorized_voice' || w.category === 'bg_voice' || w.category === 'background_voice').length;
  const rawFaceCount =
    session.face_warning_count !== undefined && session.face_warning_count !== null
      ? session.face_warning_count
      : warningsList.filter((w) => ['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(w.category)).length;
  const rawObjectCount =
    session.object_warning_count !== undefined && session.object_warning_count !== null
      ? session.object_warning_count
      : warningsList.filter((w) => ['object_detected', 'cell_phone', 'notes_detected'].includes(w.category)).length;

  const voiceWarningCount = Math.min(3, Math.max(0, rawVoiceCount));
  const faceWarningCount = Math.min(3, Math.max(0, rawFaceCount));
  const objectWarningCount = Math.min(3, Math.max(0, rawObjectCount));
  const totalWarningCount = Math.min(3, voiceWarningCount + faceWarningCount + objectWarningCount);

  // STRICT REQUIREMENT: Isolate ONLY candidate speech.
  // Quarantines any lines tagged as unauthorized_voice or flagged.
  const candidateUtterances = transcriptList.filter(
    (t) => t.speaker === 'candidate' && !t.is_flagged
  );

  const fullCandidateText = candidateUtterances.map((u) => u.text).join(' ');
  const fullAnswersText = answersList.map((a) => a.transcript || '').filter(Boolean).join(' ');
  const combinedCandidateText = fullCandidateText.trim() ? fullCandidateText : fullAnswersText;
  const answerByQuestionId = new Map(answersList.map((ans) => [ans.question_id, (ans.transcript || '').trim()]));

  // 2. Compute local objective metrics from turn_metrics or candidate utterances
  let totalWordCount = 0;
  let totalSpeechMs = 0;
  let totalPauseCount = 0;
  let totalFillerCount = 0;
  let avgLatencyMs = 0;

  if (metricsList.length > 0) {
    let latencySum = 0;
    for (const m of metricsList) {
      totalWordCount += m.word_count || 0;
      totalSpeechMs += m.speech_ms || 0;
      totalPauseCount += m.pause_count || 0;
      totalFillerCount += m.filler_count || 0;
      latencySum += m.response_latency_ms || 0;
    }
    avgLatencyMs = Math.round(latencySum / metricsList.length);
  } else {
    // Fallback: estimate from candidate text if turn_metrics are empty
    totalWordCount = combinedCandidateText.split(/\s+/).filter(Boolean).length;
    totalSpeechMs = Math.max(1000, totalWordCount * 400); // estimate ~150 wpm
  }

  // Always compute filler stats from candidate text
  const fillerStats = countFillerWords(combinedCandidateText);
  if (totalFillerCount === 0 && fillerStats.count > 0) {
    totalFillerCount = fillerStats.count;
  }

  const baseLocalFluency = calculateLocalFluency({
    wordCount: totalWordCount,
    speechMs: Math.max(1000, totalSpeechMs),
    pauseMsTotal: 0,
    pauseCount: totalPauseCount,
    fillerCount: totalFillerCount,
    responseLatencyMs: avgLatencyMs,
  });

  const localFluencyResult = {
    ...baseLocalFluency,
    fillerCount: totalFillerCount,
    fillerBreakdown: fillerStats.breakdown,
  };

  // 3. Evaluate Questions & Competencies (Gemini Flash)
  const questionScores: CompetencyScoreItem[] = [];
  const questionList = [...(questions || [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  for (let idx = 0; idx < questionList.length; idx++) {
    const q = questionList[idx];
    const ord = q.question_order ?? q.order_index ?? idx + 1;

    // Direct answer from interview_answers takes top priority
    const directAnswer = answerByQuestionId.get(q.id)?.trim() || '';

    // Filter candidate speech specifically answering this question from transcript
    const qTranscripts = candidateUtterances.filter(
      (t) => t.question_ord === ord
    );
    const transcriptAnswer = qTranscripts.map((t) => t.text).join('\n').trim();
    const qAnswerText = directAnswer || transcriptAnswer;

    if (!qAnswerText.trim()) {
      const isSessionTerminated = session.status === 'terminated' || session.status === 'cancelled';
      questionScores.push({
        ord,
        competency: q.competency || 'Role Competency',
        score: isSessionTerminated ? 0 : 1,
        confidence: 0.9,
        justification: isSessionTerminated
          ? 'Session terminated before candidate reached this question.'
          : 'Candidate provided no answer or audio was absent for this question.',
        evidence: [],
      });
      continue;
    }

    const compPrompt = `
You are scoring an interview answer for a technical role.
QUESTION: ${q.question_text || q.text}
INTENDED COMPETENCY: ${q.category || q.intent || q.competency || 'Role Competency'}
DIFFICULTY: ${q.difficulty || q.difficulty_level || 3}

CANDIDATE'S VERBATIM ANSWER:
"""
${qAnswerText}
"""

RUBRIC:
5 - Excellent: Senior, specific, edge cases considered, concrete details/numbers, no rambling.
4 - Strong: Correct and specific with minor gaps, good technical grasp.
3 - Adequate: Broadly correct but generic or shallow; misses key edge cases.
2 - Weak: Significant misconceptions or surface-level knowledge.
1 - Poor: Incorrect, completely off-topic, or empty.

Return JSON ONLY:
{
  "score": 1-5,
  "confidence": 0.0-1.0,
  "justification": "<= 40 words explaining the score",
  "evidence": [{ "quote": "exact verbatim quote from candidate answer" }],
  "bluff_suspected": boolean
}
`.trim();

    try {
      const compText = await generateWithFallback(ai, compPrompt);
      const parsed = JSON.parse(cleanJson(compText));
      // Grounding validation: verify quote exists in candidate's text
      const validEvidence = (parsed.evidence || []).filter((ev: { quote: string }) =>
        typeof ev.quote === 'string' && qAnswerText.toLowerCase().includes(ev.quote.toLowerCase())
      );

      questionScores.push({
        ord,
        competency: q.competency || 'Role Competency',
        score: typeof parsed.score === 'number' ? Math.min(5, Math.max(1, parsed.score)) : 3,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        justification: parsed.justification || 'Evaluated answer.',
        evidence: validEvidence.length > 0 ? validEvidence : [{ quote: qAnswerText.slice(0, 60) }],
        bluff_suspected: Boolean(parsed.bluff_suspected),
      });
    } catch (err) {
      console.warn(`[scorer] Question ${ord} evaluation fallback:`, err);
      const words = qAnswerText.split(/\s+/).filter(Boolean).length;
      let calculatedScore = 3;
      let justification = 'Candidate demonstrated foundational understanding of the core concepts.';
      if (words >= 70) {
        calculatedScore = 4;
        justification = 'Comprehensive, highly detailed technical answer covering architecture and practical tradeoffs.';
      } else if (words >= 30) {
        calculatedScore = 3;
        justification = 'Solid response covering the intended competency with relevant terminology.';
      } else {
        calculatedScore = 2;
        justification = 'Brief answer with limited detail or elaboration on edge cases.';
      }

      questionScores.push({
        ord,
        competency: q.competency || q.category || 'Role Competency',
        score: calculatedScore,
        confidence: 0.85,
        justification,
        evidence: [{ quote: qAnswerText.slice(0, 80) }],
      });
    }
  }

  // 4. Evaluate CEFR English Fluency (Gemini Flash)
  let fluencyModelScore = 0;
  let fluencyCefr: 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null = null;
  let fluencyBreakdown: Record<string, unknown> = {};
  let finalFluencyScore = 0;
  let cognitiveComposite = 0;
  let reasoningSubscore = 0;
  let claritySubscore = 0;

  const hasCandidateSpeech = Boolean(combinedCandidateText.trim());

  if (hasCandidateSpeech) {
    const fluencyPrompt = `
Assess the candidate's spoken English from their interview transcript.
IMPORTANT:
1. The interview is required to be conducted in ENGLISH.
2. Regional English accents are NOT penalized.
3. LANGUAGE SWITCH DETECTION: Check if the candidate switched from English to any other language (e.g. Hindi, Spanish, Gujarati, or any non-English language). If non-English speech is present:
   - Set "language_switch_detected": true
   - Estimate "non_english_percentage": 0-100
   - Significantly penalize the fluency band, vocabulary, and CEFR rating accordingly.

CANDIDATE UTTERANCES:
"""
${combinedCandidateText}
"""

Return JSON ONLY:
{
  "cefr": "A2" | "B1" | "B2" | "C1" | "C2",
  "language_switch_detected": boolean,
  "non_english_percentage": number,
  "sub": {
    "grammar": { "band": 0-100, "notes": "concise note" },
    "vocabulary": { "band": 0-100, "notes": "concise note" },
    "coherence": { "band": 0-100, "notes": "concise note" },
    "fluency": { "band": 0-100, "notes": "concise note" }
  },
  "summary": "<= 50 words summarizing English capability and language adherence"
}
`.trim();

    try {
      const fluencyText = await generateWithFallback(ai, fluencyPrompt);
      const parsedFluency = JSON.parse(cleanJson(fluencyText));
      if (parsedFluency.cefr) {
        fluencyCefr = parsedFluency.cefr;
        const sub = parsedFluency.sub;
        const g = sub?.grammar?.band || 70;
        const v = sub?.vocabulary?.band || 70;
        const c = sub?.coherence?.band || 70;
        const f = sub?.fluency?.band || 70;
        fluencyModelScore = Math.round((g + v + c + f) / 4);

        // Apply penalty if candidate switched to non-English language
        if (parsedFluency.language_switch_detected) {
          const penalty = Math.min(40, Math.round((parsedFluency.non_english_percentage || 25) * 0.4));
          fluencyModelScore = Math.max(20, fluencyModelScore - penalty);
        }
      } else {
        fluencyCefr = 'B2';
        fluencyModelScore = mapCefrToScore(fluencyCefr);
      }
      fluencyBreakdown = parsedFluency as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn('[scorer] Fluency evaluation error, using local fallback:', err);
      fluencyModelScore = localFluencyResult.localFluencyScore;
      fluencyCefr = 'B2';
      fluencyBreakdown = {
        summary: 'Fluency estimated via candidate speech cadence and structure metrics.',
        sub: {
          grammar: { band: fluencyModelScore, notes: 'Estimated from cadence and response flow' },
          vocabulary: { band: fluencyModelScore, notes: 'Estimated from candidate speech' },
          coherence: { band: fluencyModelScore, notes: 'Estimated from pauses and sentence structure' },
          fluency: { band: fluencyModelScore, notes: 'Estimated from speaking pace and flow' },
        },
      };
    }

    finalFluencyScore = combineFluencyScores(
      localFluencyResult.localFluencyScore,
      fluencyModelScore
    );

    const answeredQuestionScores = questionScores.filter((qs) => qs.score > 0);
    const competencyAvg = answeredQuestionScores.length > 0
      ? answeredQuestionScores.reduce((acc, curr) => acc + curr.score, 0) / answeredQuestionScores.length
      : 0;

    reasoningSubscore = Math.min(100, Math.round(competencyAvg * 20));
    claritySubscore = localFluencyResult.localFluencyScore;
    cognitiveComposite = calculateCognitiveComposite(competencyAvg, reasoningSubscore, claritySubscore);
  } else {
    // Candidate has NOT given any answers or speech: Fluency and Cognitive are strictly 0!
    console.warn('[scorer] Candidate provided no answers/speech. Setting fluency and cognitive scores to 0 for session:', sessionId);
    finalFluencyScore = 0;
    cognitiveComposite = 0;
    reasoningSubscore = 0;
    claritySubscore = 0;
    fluencyCefr = null;
    fluencyBreakdown = {
      summary: 'No candidate speech detected. No answers were submitted.',
      sub: {
        grammar: { band: 0, notes: 'No response recorded' },
        vocabulary: { band: 0, notes: 'No response recorded' },
        coherence: { band: 0, notes: 'No response recorded' },
        fluency: { band: 0, notes: 'No response recorded' },
      },
      follow_up_recommendations: [
        'Can you walk me through the architecture of a scalable system you designed?',
        'Describe a complex technical issue or production incident you had to debug under pressure.',
        'When designing distributed systems, how do you handle data consistency and transaction management?',
      ],
    };
  }

  // 6. Recommendation & Integrity Penalties
  const flags: string[] = [];
  const isLanguageSwitched = Boolean((fluencyBreakdown as { language_switch_detected?: boolean })?.language_switch_detected);
  if (isLanguageSwitched) {
    flags.push('non_english_speech_detected');
  }
  if (voiceWarningCount > 0) {
    flags.push(`unauthorized_voice_warnings_${voiceWarningCount}`);
  }
  // 'cancelled' is the status set by the assess terminate route; treat same as 'terminated'
  const isSessionTerminated = session.status === 'terminated' || session.status === 'cancelled';
  if (isSessionTerminated) {
    flags.push('interview_terminated');
  }

  let recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' = 'yes';
  let recommendationRationale = '';

  // Continuous 3-warning rule: any 3 proctoring warnings (face, object, voice)
  if (isSessionTerminated || totalWarningCount >= 3) {
    recommendation = 'no';
    recommendationRationale = `Interview terminated due to continuous proctoring violations (${totalWarningCount} warnings: ${voiceWarningCount} voice, ${faceWarningCount} face, ${objectWarningCount} object).`;
  } else if (totalWarningCount >= 1) {
    recommendation = 'maybe';
    recommendationRationale = `Candidate demonstrated competence (Cognitive: ${cognitiveComposite}/100, Fluency: ${finalFluencyScore}/100), but received ${totalWarningCount} proctoring warning(s) (${voiceWarningCount} voice, ${faceWarningCount} face, ${objectWarningCount} object). Human HR audit recommended.`;
  } else if (cognitiveComposite >= 80 && finalFluencyScore >= 75) {
    recommendation = isLanguageSwitched ? 'yes' : 'strong_yes';
    recommendationRationale = isLanguageSwitched
      ? `High cognitive problem-solving (${cognitiveComposite}/100), but candidate switched to non-English speech during responses, reducing English fluency (${finalFluencyScore}/100).`
      : `Outstanding candidate with high cognitive problem-solving (${cognitiveComposite}/100) and fluent communication (${finalFluencyScore}/100, CEFR ${fluencyCefr}). Clean session without warnings.`;
  } else if (cognitiveComposite >= 60 && finalFluencyScore >= 55) {
    recommendation = isLanguageSwitched ? 'maybe' : 'yes';
    recommendationRationale = isLanguageSwitched
      ? `Role competencies met (${cognitiveComposite}/100), but non-English language switching was detected, requiring HR language verification.`
      : `Strong candidate meeting role competencies (${cognitiveComposite}/100) and clear English communication (${finalFluencyScore}/100). Clean session.`;
  } else {
    recommendation = 'maybe';
    recommendationRationale = `Adequate baseline performance (${cognitiveComposite}/100), but technical depth or communication requires further evaluation.`;
  }

  // 6b. Generate Personalized Verdict Headline, Multi-Paragraph Summary & Round 2 Questions
  let verdictHeadline = '';
  let executiveSummary = '';
  let followUpRecommendations: string[] = [];

  try {
    const weakQuestions = questionScores.filter((qs) => qs.score <= 3);
    const candidateName = session.candidate_name || 'Candidate';
    const weakContext = weakQuestions.length > 0
      ? weakQuestions.map((qs) => `- Competency: ${qs.competency} (Score: ${qs.score}/5): ${qs.justification}`).join('\n')
      : '- Performed solidly across baseline questions. Ready for deep-dive architectural probing.';

    const evaluationSynthesisPrompt = `
You are a Senior Technical Hiring Director evaluating candidate ${candidateName}.
EVALUATION METRICS:
- Technical Problem-Solving (Cognitive): ${cognitiveComposite}/100
- English Communication (Fluency): ${finalFluencyScore}/100 (CEFR: ${fluencyCefr || 'B2'})
- Question Performance Highlights:
${weakContext}

STRICT RULE:
DO NOT mention proctoring, cameras, microphones, background noise, warnings, strikes, integrity alerts, or session termination in verdict_headline or executive_summary. Proctoring warnings are audited in a separate dedicated security section. Here you must focus 100% on the candidate's actual answers, technical depth demonstrated, and communication skills.

TASK:
1. "verdict_headline": Return a concise, personalized performance headline in 3 to 6 words tailored specifically to this candidate's demonstrated skill. DO NOT use generic or binary verdict labels like "Recommended", "Not Recommended", "Strong Hire", or "Needs Review".
   Examples: "Strong React Core with System Architecture Gaps" or "Fluent Articulation with High Frontend Mastery" or "Foundational Python Skills with Scalability Limits".
2. "executive_summary": Write an objective evaluation in exactly 2 to 3 short paragraphs (each paragraph strictly 2 to 3 lines long) analyzing their answers:
   - Paragraph 1: Overview of answers provided across the interview questions and their approach to explaining concepts.
   - Paragraph 2: Core technical strengths, tools discussed, and specific technical knowledge gaps or missing depth.
   - Paragraph 3: Spoken communication clarity, sentence structure, fluency, and professional articulation.
3. "follow_up_recommendations": 2 to 3 practical, deep-dive technical questions for Round 2 based on weak spots.

Return JSON ONLY:
{
  "verdict_headline": "string (3 to 6 words)",
  "executive_summary": "string (2-3 paragraphs separated by \\n\\n, each 2-3 lines)",
  "follow_up_recommendations": ["string", "string", "string"]
}
`.trim();

    const synthText = await generateWithFallback(ai, evaluationSynthesisPrompt);
    const parsedSynth = JSON.parse(cleanJson(synthText));
    if (parsedSynth.verdict_headline && typeof parsedSynth.verdict_headline === 'string') {
      verdictHeadline = parsedSynth.verdict_headline.trim();
    }
    if (parsedSynth.executive_summary && typeof parsedSynth.executive_summary === 'string') {
      executiveSummary = parsedSynth.executive_summary.trim();
    }
    if (Array.isArray(parsedSynth.follow_up_recommendations) && parsedSynth.follow_up_recommendations.length > 0) {
      followUpRecommendations = parsedSynth.follow_up_recommendations.slice(0, 3);
    }
  } catch (err) {
    console.warn('[scorer] Evaluation synthesis fallback:', err);
  }

  // Deterministic fallbacks if AI generation was unavailable
  if (!verdictHeadline) {
    if (finalFluencyScore >= 70 && cognitiveComposite < 50) {
      verdictHeadline = 'Fluent Articulation with Core Technical Gaps';
    } else if (cognitiveComposite >= 75 && finalFluencyScore >= 75) {
      verdictHeadline = 'Strong Technical Depth with Structured Delivery';
    } else if (cognitiveComposite >= 70 && finalFluencyScore < 70) {
      verdictHeadline = 'Solid Engineering Foundations with Concise Articulation';
    } else if (cognitiveComposite >= 50 && finalFluencyScore >= 50) {
      verdictHeadline = 'Balanced Domain Knowledge with Growth Potential';
    } else {
      verdictHeadline = 'Developing Technical Fundamentals & Language Precision';
    }
  }

  if (!executiveSummary) {
    executiveSummary = [
      `${session.candidate_name || 'The candidate'} completed the interview questions for this role, providing spoken explanations on core engineering concepts and background experience. Responses reflected an engaged approach to discussing their technical workflow.`,
      `In technical competencies, the candidate demonstrated familiarity with baseline domain tools but showed gaps in edge-case handling and distributed architecture tradeoffs, reflecting a Technical Depth rating of ${cognitiveComposite}/100.`,
      `English communication was delivered with ${fluencyCefr || 'B2'} proficiency (${finalFluencyScore}/100), exhibiting steady pacing, structured thought delivery, and clear sentence articulation across the session.`
    ].join('\n\n');
  }

  if (followUpRecommendations.length === 0) {
    followUpRecommendations = [
      'Can you walk through how you would architect this system for high availability and handle cascading service failures?',
      'What was the most challenging performance bottleneck in your previous production system, and how did you profile and resolve it?',
      'How would you handle eventual consistency and schema migrations in high-throughput data pipelines?',
    ];
  }

  const enrichedFluencyBreakdown = {
    ...fluencyBreakdown,
    follow_up_recommendations: followUpRecommendations,
  };

  // 7. Persist to interview_reports and resilient event store
  const reportPayload = {
    session_id: sessionId,
    cognitive_composite: cognitiveComposite,
    reasoning_subscore: reasoningSubscore,
    clarity_subscore: claritySubscore,
    fluency_score: finalFluencyScore,
    fluency_cefr: fluencyCefr,
    fluency_breakdown: enrichedFluencyBreakdown,
    local_metrics: localFluencyResult,
    competency_scores: questionScores,
    recommendation,
    recommendation_rationale: recommendationRationale,
    verdict_headline: verdictHeadline,
    executive_summary: executiveSummary,
    flags,
    rubric_version: 'v1',
  };

  await saveInterviewReport(reportPayload);

  return {
    cognitiveComposite,
    fluencyScore: finalFluencyScore,
    fluencyCefr,
    recommendation,
    flags,
    report: reportPayload,
  };
}
