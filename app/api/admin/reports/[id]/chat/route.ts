import { NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import { getInterviewReport } from '@/lib/ai-interview/report-store';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 45;

const COPILOT_MODELS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate admin user
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json(
      { error: 'Unauthorized. Admin access required.' },
      { status: 401 },
    );
  }

  const { id: sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required.' }, { status: 400 });
  }

  // 2. Parse request payload
  let payload: { question?: string; history?: ChatMessage[] } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const question = (payload.question || '').trim();
  if (!question) {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 });
  }

  const history: ChatMessage[] = Array.isArray(payload.history)
    ? payload.history.slice(-10) // Keep last 10 messages for context efficiency
    : [];

  // 3. Fetch interview session data in parallel
  const [
    { data: session },
    report,
    { data: questions },
    { data: rawAnswers },
    { data: rawTranscripts },
    { data: rawEvents },
    { data: invite },
  ] = await Promise.all([
    supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, voice_warning_count, face_warning_count, object_warning_count')
      .eq('id', sessionId)
      .single(),
    getInterviewReport(sessionId),
    supabaseAdmin
      .from('interview_questions')
      .select('*')
      .eq('session_id', sessionId),
    supabaseAdmin
      .from('interview_answers')
      .select('*')
      .eq('session_id', sessionId),
    supabaseAdmin
      .from('interview_transcript')
      .select('*')
      .eq('session_id', sessionId)
      .order('ts_ms', { ascending: true }),
    supabaseAdmin
      .from('interview_events')
      .select('id, session_id, event_type, category, severity, metadata, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('interview_invites')
      .select('id, status')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ]);

  if (!session) {
    return NextResponse.json({ error: 'Interview session not found.' }, { status: 404 });
  }

  // 4. Extract and organize session facts
  const inviteStatus = invite?.status || '';
  const rawStatus = session.status || 'draft';
  const isTerminated =
    rawStatus === 'cancelled' ||
    rawStatus === 'terminated' ||
    inviteStatus === 'revoked';
  const isCompleted =
    !isTerminated &&
    (rawStatus === 'completed' || inviteStatus === 'completed');

  const questionList = [...(questions ?? [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  const answersList = rawAnswers ?? [];
  const transcriptList = rawTranscripts ?? [];
  const eventsList = rawEvents ?? [];

  // Map answers by question_id or order
  const answerMap = new Map<string, string>();
  for (const a of answersList) {
    if (a.question_id && a.transcript) {
      answerMap.set(a.question_id, a.transcript.trim());
    }
  }

  // Group candidate speech by question_ord
  const candidateTranscriptByOrd = new Map<number, string[]>();
  for (const t of transcriptList) {
    if (t.speaker === 'candidate' && t.text?.trim()) {
      const ord = t.question_ord || 0;
      const existing = candidateTranscriptByOrd.get(ord) || [];
      existing.push(t.text.trim());
      candidateTranscriptByOrd.set(ord, existing);
    }
  }

  // Proctoring warnings breakdown
  const proctoringWarnings = eventsList.filter(
    (e) =>
      e.severity === 'warning' ||
      e.severity === 'critical' ||
      e.severity === 'error' ||
      e.event_type === 'proctoring_violation' ||
      ['unauthorized_voice', 'bg_voice', 'background_voice', 'gaze_away', 'no_face', 'multi_face', 'cell_phone', 'object_detected', 'reading_suspected', 'tab_switched', 'tab_switch'].includes(e.category),
  );

  // Termination reason event if any
  const termEvent = eventsList.find(
    (e) =>
      e.event_type === 'session_terminated' ||
      e.event_type === 'proctoring_violation' ||
      e.severity === 'critical',
  );
  const terminationReason =
    termEvent?.metadata?.reason ||
    termEvent?.metadata?.trigger ||
    (isTerminated ? 'Automated proctoring termination' : null);

  // Build Q&A list for prompt
  const qaSummaries = questionList.map((q, idx) => {
    const ord = q.question_order ?? q.order_index ?? idx + 1;
    let ansText = answerMap.get(q.id) || answerMap.get(String(ord)) || '';
    if (!ansText && candidateTranscriptByOrd.has(ord)) {
      ansText = candidateTranscriptByOrd.get(ord)!.join(' ');
    }
    return {
      order: ord,
      category: q.category || q.intent || 'Technical',
      question: q.question_text || q.text,
      answer: ansText || '(No answer recorded / candidate skipped)',
    };
  });

  // 5. Assemble ground truth context
  const contextString = `
=== INTERVIEW CONTEXT & CANDIDATE DATA ===
Candidate Name: ${session.candidate_name || 'Anonymous'}
Candidate Email: ${session.candidate_email || 'Not provided'}
Target Job Role: ${session.parsed_jd?.jobTitle || 'Technical Role'}
Session Status: ${isTerminated ? 'TERMINATED EARLY' : isCompleted ? 'COMPLETED' : rawStatus}
${terminationReason ? `Termination Reason: ${terminationReason}` : ''}

EVALUATION & SCORES:
- Final Recommendation: ${report?.recommendation ? report.recommendation.toUpperCase() : 'Pending evaluation'}
- Recommendation Rationale: ${report?.recommendation_rationale || 'None provided'}
- Technical / Cognitive Composite Score: ${report?.cognitive_composite != null ? `${report.cognitive_composite}/100` : 'N/A'}
- Communication / Fluency Score: ${report?.fluency_score != null ? `${report.fluency_score}/100` : 'N/A'} (CEFR: ${report?.fluency_cefr || 'N/A'})
- Flags: ${Array.isArray(report?.flags) && report.flags.length ? report.flags.join(', ') : 'None'}

COMPETENCY BREAKDOWN:
${
  Array.isArray(report?.competency_scores) && report.competency_scores.length
    ? (report.competency_scores as Array<{ competency?: string; score?: number; justification?: string; bluff_suspected?: boolean }>)
        .map(
          (c, i) =>
            `${i + 1}. ${c.competency || 'Competency'}: Score ${c.score}/5. ${c.justification || ''}${c.bluff_suspected ? ' [BLUFF SUSPECTED]' : ''}`,
        )
        .join('\n')
    : 'No competency breakdown available.'
}

PROCTORING & INTEGRITY:
- Voice Warnings: ${session.voice_warning_count ?? 0}
- Face Warnings: ${session.face_warning_count ?? 0}
- Object Warnings: ${session.object_warning_count ?? 0}
- Total Recorded Warning Events: ${proctoringWarnings.length}
${
  proctoringWarnings.length > 0
    ? `Specific Warnings: ${proctoringWarnings.map((w) => `[${w.category || w.event_type} (${w.severity})]`).slice(0, 15).join(', ')}`
    : 'No integrity violations logged.'
}

QUESTIONS & VERBATIM ANSWERS:
${qaSummaries
  .map(
    (qa) => `[Q${qa.order} - ${qa.category}]
Question: ${qa.question}
Candidate Answer: ${qa.answer}`,
  )
  .join('\n\n')}
=== END CONTEXT ===
`.trim();

  // 6. Build the prompt
  const systemInstruction = `
You are an expert AI Talent Partner and Interview Copilot for Creole Studios.
You are assisting an administrator, HR lead, or hiring manager reviewing this candidate's interview session.

Your instructions:
1. Answer the user's question accurately and professionally, grounded STRICTLY in the provided interview context, transcript, scoring, and proctoring data.
2. When discussing candidate answers, cite question numbers (e.g. Q1, Q2) or brief verbatim quotes to substantiate your claims.
3. If asked about a topic or skill that was NOT asked or demonstrated in the interview, clearly state that it was not covered in this interview session.
4. If asked about integrity, proctoring warnings, or termination, accurately reference the recorded proctoring counts and events.
5. Format your output cleanly in markdown with bold headings, concise bullet points, or quote blocks where appropriate.
6. Keep your tone objective, analytical, constructive, and executive-ready.
`.trim();

  const formattedHistory = history.map((msg) => `${msg.role === 'user' ? 'Admin' : 'Copilot'}: ${msg.content}`).join('\n\n');

  const fullPrompt = `${systemInstruction}

${contextString}

${formattedHistory ? `PREVIOUS CONVERSATION:\n${formattedHistory}\n\n` : ''}
Admin Query: ${question}

Provide your grounded response:`;

  // 7. Call Gemini with automatic fallback across reliable models
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Gemini API key is not configured on the server.' },
      { status: 500 },
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  let answer = '';
  const errorDetails: string[] = [];

  for (const model of COPILOT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
      });
      answer = (response.text || '').trim();
      if (answer) {
        break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push(`[${model}] ${msg.slice(0, 100)}`);
      console.warn(`[admin-copilot] Model ${model} failed, trying next fallback:`, msg.slice(0, 80));
    }
  }

  if (!answer) {
    console.error('[admin-copilot] All models failed:', errorDetails);
    return NextResponse.json(
      {
        error:
          'Could not generate a response from the AI Copilot. Please try asking again in a moment.',
        details: errorDetails.slice(0, 3),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ answer });
}
