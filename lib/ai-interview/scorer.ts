import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  calculateLocalFluency,
  mapCefrToScore,
  combineFluencyScores,
  calculateCognitiveComposite,
} from './fluency-calculator';

const SCORING_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export interface ScoreInterviewOptions {
  sessionId: string;
}

interface CompetencyScoreItem {
  ord: number;
  competency: string;
  score: number; // 1 - 5
  confidence: number;
  justification: string;
  evidence: Array<{ ts_ms?: number; quote: string }>;
  bluff_suspected?: boolean;
}

interface FluencyEvaluationResult {
  cefr: 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  sub: {
    grammar: { band: number; notes: string };
    vocabulary: { band: number; notes: string };
    coherence: { band: number; notes: string };
    fluency: { band: number; notes: string };
  };
  evidenceQuotes: string[];
  summary: string;
}

/**
 * Strips markdown code block wrappers from JSON string.
 */
function cleanJson(raw: string): string {
  return raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
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
  const voiceWarningCount = (session.voice_warning_count || 0) +
    warningsList.filter((w) => w.category === 'unauthorized_voice' || w.category === 'bg_voice' || w.category === 'background_voice').length;
  const faceWarningCount = warningsList.filter((w) =>
    ['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(w.category)
  ).length;
  const objectWarningCount = warningsList.filter((w) =>
    ['object_detected', 'cell_phone', 'notes_detected'].includes(w.category)
  ).length;
  const totalWarningCount = warningsList.length;

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

  const localFluencyResult = calculateLocalFluency({
    wordCount: totalWordCount,
    speechMs: Math.max(1000, totalSpeechMs),
    pauseMsTotal: 0,
    pauseCount: totalPauseCount,
    fillerCount: totalFillerCount,
    responseLatencyMs: avgLatencyMs,
  });

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
      questionScores.push({
        ord,
        competency: q.competency || 'General Competency',
        score: 1,
        confidence: 0.9,
        justification: 'Candidate provided no answer or audio was absent for this question.',
        evidence: [],
      });
      continue;
    }

    const compPrompt = `
You are scoring an interview answer for a technical role.
QUESTION: ${q.question_text || q.text}
INTENDED COMPETENCY: ${q.competency || 'Role Competency'}
DIFFICULTY (1-5): ${q.difficulty_level || 3}

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
      const compRes = await ai.models.generateContent({
        model: SCORING_MODEL,
        contents: compPrompt,
        config: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(cleanJson(compRes.text || '{}'));
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
      questionScores.push({
        ord,
        competency: q.competency || 'Role Competency',
        score: 3,
        confidence: 0.6,
        justification: 'Automated fallback evaluation.',
        evidence: [],
      });
    }
  }

  // 4. Evaluate CEFR English Fluency (Gemini Flash)
  let fluencyModelScore = 70;
  let fluencyCefr: 'A2' | 'B1' | 'B2' | 'C1' | 'C2' = 'B2';
  let fluencyBreakdown: Record<string, unknown> = {};

  if (combinedCandidateText.trim()) {
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
      const fluencyRes = await ai.models.generateContent({
        model: SCORING_MODEL,
        contents: fluencyPrompt,
        config: { responseMimeType: 'application/json' },
      });

      const parsedFluency = JSON.parse(cleanJson(fluencyRes.text || '{}'));
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
        fluencyModelScore = mapCefrToScore(fluencyCefr);
      }
      fluencyBreakdown = parsedFluency as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn('[scorer] Fluency evaluation error, using local fallback:', err);
      fluencyModelScore = localFluencyResult.localFluencyScore;
    }
  }

  // Combine Local + Model Fluency
  const finalFluencyScore = combineFluencyScores(
    localFluencyResult.localFluencyScore,
    fluencyModelScore
  );

  // 5. Compute Cognitive Composite
  const competencyAvg = questionScores.length > 0
    ? questionScores.reduce((acc, curr) => acc + curr.score, 0) / questionScores.length
    : 3;

  const reasoningSubscore = Math.min(100, Math.round(competencyAvg * 20));
  const claritySubscore = localFluencyResult.localFluencyScore;
  const cognitiveComposite = calculateCognitiveComposite(competencyAvg, reasoningSubscore, claritySubscore);

  // 6. Recommendation & Integrity Penalties
  const flags: string[] = [];
  const isLanguageSwitched = Boolean((fluencyBreakdown as { language_switch_detected?: boolean })?.language_switch_detected);
  if (isLanguageSwitched) {
    flags.push('non_english_speech_detected');
  }
  if (voiceWarningCount > 0) {
    flags.push(`unauthorized_voice_warnings_${voiceWarningCount}`);
  }
  if (session.status === 'terminated') {
    flags.push('interview_terminated');
  }

  let recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' = 'yes';
  let recommendationRationale = '';

  // Continuous 3-warning rule: any 3 proctoring warnings (face, object, voice)
  if (session.status === 'terminated' || totalWarningCount >= 3) {
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

  // 6b. Generate 2-3 Follow-Up Recommendations for Round 2 based on weak spots
  let followUpRecommendations: string[] = [];
  try {
    const weakQuestions = questionScores.filter((qs) => qs.score <= 3);
    const weakContext = weakQuestions.length > 0
      ? weakQuestions.map((qs) => `- Competency: ${qs.competency} (Score: ${qs.score}/5): ${qs.justification}`).join('\n')
      : '- Candidate performed solidly across baseline questions. Probe advanced architecture, scalability tradeoffs, and edge case resilience.';

    const followUpPrompt = `
You are a Senior Technical Hiring Lead.
Candidate evaluation:
${weakContext}

Based on the candidate's answers and weak spots or gaps identified above, generate exactly 2 to 3 practical, deep-dive technical follow-up questions for the human interviewer in Round 2.
Return JSON ONLY:
{
  "follow_up_recommendations": [
    "Technical question 1...",
    "Technical question 2...",
    "Technical question 3..."
  ]
}
`.trim();

    const followUpRes = await ai.models.generateContent({
      model: SCORING_MODEL,
      contents: followUpPrompt,
      config: { responseMimeType: 'application/json' },
    });

    const parsedFollowUp = JSON.parse(cleanJson(followUpRes.text || '{}'));
    if (Array.isArray(parsedFollowUp.follow_up_recommendations) && parsedFollowUp.follow_up_recommendations.length > 0) {
      followUpRecommendations = parsedFollowUp.follow_up_recommendations.slice(0, 3);
    }
  } catch (err) {
    console.warn('[scorer] Follow-up questions generation fallback:', err);
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

  // 7. Persist to interview_reports
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
    flags,
    rubric_version: 'v1',
  };

  const { data: existingReport } = await supabaseAdmin
    .from('interview_reports')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existingReport) {
    await supabaseAdmin.from('interview_reports').update(reportPayload).eq('id', existingReport.id);
  } else {
    await supabaseAdmin.from('interview_reports').insert(reportPayload);
  }

  return {
    cognitiveComposite,
    fluencyScore: finalFluencyScore,
    fluencyCefr,
    recommendation,
    flags,
    report: reportPayload,
  };
}
