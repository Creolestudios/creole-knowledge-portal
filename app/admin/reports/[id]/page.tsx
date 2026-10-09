import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ReportDetailView } from '@/components/ai-interview/report-detail-view';
import { getInterviewReport } from '@/lib/ai-interview/report-store';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminInterviewReportPage({ params }: PageProps) {
  const { id } = await params;

  const [
    { data: session },
    initialReport,
    { data: transcript },
    { data: questions },
    { data: warningEvents },
    { data: answers },
    { data: invite },
  ] = await Promise.all([
    supabaseAdmin
      .from('interview_sessions')
      // NOTE: interview_sessions does NOT have termination_reason column — use interview_events
      .select('id, candidate_name, candidate_email, status, created_at, updated_at, parsed_jd, parsed_resume, voice_warning_count, face_warning_count, object_warning_count')
      .eq('id', id)
      .single(),
    getInterviewReport(id),
    supabaseAdmin
      .from('interview_transcript')
      .select('*')
      .eq('session_id', id)
      .order('ts_ms', { ascending: true }),
    supabaseAdmin
      .from('interview_questions')
      .select('*')
      .eq('session_id', id),
    // All events for warnings AND termination reason
    supabaseAdmin
      .from('interview_events')
      .select('id, session_id, event_type, category, severity, snapshot_path, metadata, meta, created_at, ts_ms')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('interview_answers')
      .select('*')
      .eq('session_id', id),
    // Invite status to determine true session state
    supabaseAdmin
      .from('interview_invites')
      .select('id, status')
      .eq('session_id', id)
      .maybeSingle(),
  ]);

  if (!session) notFound();

  // ── Derive true terminal state from both session + invite ──────────
  const inviteStatus = invite?.status || '';
  const rawStatus = session.status || 'draft';
  const isTerminated =
    rawStatus === 'cancelled' ||
    rawStatus === 'terminated' ||
    inviteStatus === 'revoked';
  const isTerminal =
    isTerminated ||
    rawStatus === 'completed' ||
    inviteStatus === 'completed';

  // ── Auto-score for ALL session statuses if no existing report ──────
  let report = initialReport;
  if (!report) {
    try {
      const scoringResult = await scoreInterviewSession({ sessionId: id });
      report = (scoringResult.report as unknown as typeof initialReport) || null;
    } catch (err) {
      console.warn(`[admin-report] On-demand scoring failed for session ${id}:`, err);
    }
  }

  // ── Sort questions by order ────────────────────────────────────────
  const sortedQuestions = [...(questions ?? [])].sort((a, b) => {
    const ordA = a.question_order ?? a.order_index ?? 0;
    const ordB = b.question_order ?? b.order_index ?? 0;
    return ordA - ordB;
  });

  // ── Strike Categories strictly representing real proctoring violations ───
  const STRIKE_CATEGORIES = [
    'unauthorized_voice',
    'bg_voice',
    'background_voice',
    'gaze_away',
    'no_face',
    'multi_face',
    'reading_suspected',
    'object_detected',
    'object',
    'cell_phone',
    'notes_detected',
  ];

  const allEvents = warningEvents ?? [];

  // Filter ONLY true proctoring strikes (excluding terminal proctoring_violation events)
  const realWarnEvents = allEvents.filter(
    (e) =>
      (e.severity === 'warning' || e.severity === 'critical' || e.severity === 'error') &&
      STRIKE_CATEGORIES.includes(e.category || e.event_type)
  );

  // Deduplicate warnings by category and timestamp within a 2-second window
  const seenKeys = new Set<string>();
  const deduplicatedWarnEvents = realWarnEvents.filter((w) => {
    const ts = w.ts_ms
      ? Math.floor(Number(w.ts_ms) / 2000)
      : (w.created_at ? Math.floor(new Date(w.created_at).getTime() / 2000) : 0);
    const key = `${w.category || w.event_type}_${ts}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const voiceEvents = deduplicatedWarnEvents.filter((w) =>
    ['unauthorized_voice', 'bg_voice', 'background_voice'].includes(w.category || w.event_type)
  );
  const faceEvents = deduplicatedWarnEvents.filter((w) =>
    ['gaze_away', 'no_face', 'multi_face', 'reading_suspected'].includes(w.category || w.event_type)
  );
  const objectEvents = deduplicatedWarnEvents.filter((w) =>
    ['object_detected', 'object', 'cell_phone', 'notes_detected'].includes(w.category || w.event_type)
  );

  const rawVoiceCount = Math.max(session.voice_warning_count ?? 0, voiceEvents.length);
  const rawFaceCount = Math.max(session.face_warning_count ?? 0, faceEvents.length);
  const rawObjectCount = Math.max(session.object_warning_count ?? 0, objectEvents.length);

  const voiceWarningCount = Math.min(3, Math.max(0, rawVoiceCount));
  const faceWarningCount = Math.min(3, Math.max(0, rawFaceCount));
  const objectWarningCount = Math.min(3, Math.max(0, rawObjectCount));
  const realStrikeCount = Math.min(3, voiceWarningCount + faceWarningCount + objectWarningCount);

  // ── Google Drive Recording Event (Latest Upload) ─────────────────
  const recordingEvent = [...allEvents]
    .reverse()
    .find((e) => e.category === 'full_recording' || e.event_type === 'full_recording');
  const recMeta = (recordingEvent?.meta || recordingEvent?.metadata || {}) as Record<string, unknown>;
  const recFileId = String(recMeta.fileId || '');
  const recWebViewLink = (recMeta.webViewLink as string) || (recFileId ? `https://drive.google.com/file/d/${recFileId}/view` : '');
  const recPreviewUrl = (recMeta.previewUrl as string) || (recFileId ? `https://drive.google.com/file/d/${recFileId}/preview` : '');
  const recording = (recFileId || recWebViewLink)
    ? {
        fileId: recFileId || 'drive_file',
        webViewLink: recWebViewLink,
        previewUrl: recPreviewUrl,
        fileName: recMeta.fileName as string | undefined,
        status: recMeta.status as string | undefined,
        purged_at: recMeta.purged_at as string | undefined,
      }
    : null;

  // ── Determine Video Recording Session Window & Start Timestamp ────
  const recUploadTs = recordingEvent?.created_at
    ? new Date(recordingEvent.created_at).getTime()
    : (recMeta.uploadedAt ? new Date(recMeta.uploadedAt as string).getTime() : 0);

  // Check for any true previous attempt in the session: must be at least 3 minutes prior
  // (avoids treating consecutive upload flushes at session termination as separate attempts)
  const previousRecording = allEvents
    .filter(
      (e) =>
        (e.category === 'full_recording' || e.event_type === 'full_recording') &&
        (e.ts_ms ? Number(e.ts_ms) : new Date(e.created_at).getTime()) < (recUploadTs - 3 * 60 * 1000)
    )
    .pop();
  const previousRecTs = previousRecording
    ? (previousRecording.ts_ms ? Number(previousRecording.ts_ms) : new Date(previousRecording.created_at).getTime())
    : 0;

  const sessionCreatedMs = new Date(session.created_at).getTime();

  // Scope active events strictly to the current recorded interview run/attempt
  const attemptMinTs = previousRecTs > 0
    ? previousRecTs + 1000
    : (recUploadTs > 0 ? Math.max(sessionCreatedMs, recUploadTs - 45 * 60 * 1000) : 0);
  const attemptMaxTs = recUploadTs > 0 ? recUploadTs + 15_000 : Infinity;

  const attemptEvents = allEvents.filter((e) => {
    if (e.category === 'full_recording' || e.event_type === 'full_recording') return false;
    const t = e.ts_ms ? Number(e.ts_ms) : (e.created_at ? new Date(e.created_at).getTime() : 0);
    return t >= attemptMinTs && t <= attemptMaxTs;
  });

  // Extract strikes occurring within this active attempt
  const candidateStrikes = attemptEvents.filter((e) => {
    const cat = e.category || e.event_type || '';
    const reason = String(e.metadata?.reason || e.meta?.reason || '');
    if (cat === 'proctoring_violation' && reason.toLowerCase().includes('three proctoring warnings issued')) {
      return false;
    }
    return (
      STRIKE_CATEGORIES.includes(cat) ||
      cat === 'proctoring_warning' ||
      cat === 'warning' ||
      cat === 'tab_switch' ||
      cat === 'window_blur' ||
      cat === 'proctoring_violation'
    );
  });

  // Strictly sort strikes chronologically ascending by violation timestamp (earliest first)
  candidateStrikes.sort((a, b) => {
    const aTs = a.ts_ms ? Number(a.ts_ms) : (a.created_at ? new Date(a.created_at).getTime() : 0);
    const bTs = b.ts_ms ? Number(b.ts_ms) : (b.created_at ? new Date(b.created_at).getTime() : 0);
    return aTs - bTs;
  });

  // Debounce consecutive duplicates from same detector firing within 3 seconds
  const debouncedStrikes: typeof candidateStrikes = [];
  for (const event of candidateStrikes) {
    const eTs = event.ts_ms ? Number(event.ts_ms) : new Date(event.created_at).getTime();
    const last = debouncedStrikes[debouncedStrikes.length - 1];
    if (last) {
      const lastTs = last.ts_ms ? Number(last.ts_ms) : new Date(last.created_at).getTime();
      const sameCat = (last.category || last.event_type) === (event.category || event.event_type);
      const sameReason = (last.metadata?.reason || last.meta?.reason) === (event.metadata?.reason || event.meta?.reason);
      if (Math.abs(eTs - lastTs) < 3000 && (sameCat || sameReason)) {
        continue;
      }
    }
    debouncedStrikes.push(event);
  }

  // ── Termination reason from proctoring_violation events ───────────
  const violationEvent = recUploadTs > 0
    ? ([...allEvents]
        .reverse()
        .find(
          (e) =>
            (e.event_type === 'proctoring_violation' || e.category === 'proctoring_violation') &&
            (e.ts_ms ? Number(e.ts_ms) : new Date(e.created_at).getTime()) <= recUploadTs + 5000
        ) || allEvents.find((e) => e.event_type === 'proctoring_violation'))
    : [...allEvents].reverse().find((e) => e.event_type === 'proctoring_violation');

  const violationMeta = (violationEvent?.metadata || violationEvent?.meta) as { reason?: string } | undefined;

  // If session was terminated and we have fewer than 3 strikes (e.g. exactly 2 strikes, or terminated by violation),
  // include the terminal proctoring event as the final strike so all warnings are accounted for
  if (isTerminated && violationEvent && debouncedStrikes.length < 3) {
    const alreadyIncluded = debouncedStrikes.some((s) => s.id === violationEvent.id);
    if (!alreadyIncluded) {
      debouncedStrikes.push(violationEvent);
    }
  }

  // Cap to 3 strikes for this attempt
  const finalStrikes = debouncedStrikes.slice(0, 3);

  // 1. Explicit recording start timestamp from recording metadata
  const explicitRecStart = recMeta.recordingStartTime || recMeta.startedAt
    ? Number(recMeta.recordingStartTime || recMeta.startedAt)
    : undefined;

  // 2. Explicit duration from recording metadata
  const explicitDurationSec = typeof recMeta.durationSeconds === 'number' && recMeta.durationSeconds > 0
    ? recMeta.durationSeconds
    : (typeof recMeta.duration === 'number' && recMeta.duration > 0 ? recMeta.duration : undefined);

  // 3. Check for explicit recording_started or session_started event for this run
  const relevantRecStart = attemptEvents.find(
    (e) => e.category === 'recording_started' || e.event_type === 'recording_started'
  );

  let videoStartMs: number;
  if (explicitRecStart && explicitRecStart > 0) {
    videoStartMs = explicitRecStart;
  } else if (relevantRecStart) {
    videoStartMs = relevantRecStart.ts_ms
      ? Number(relevantRecStart.ts_ms)
      : new Date(relevantRecStart.created_at).getTime();
  } else if (explicitDurationSec && explicitDurationSec > 0 && recUploadTs > 0) {
    videoStartMs = Math.max(0, recUploadTs - explicitDurationSec * 1000);
  } else if (finalStrikes.length > 0) {
    const firstStrikeTs = finalStrikes[0].ts_ms
      ? Number(finalStrikes[0].ts_ms)
      : new Date(finalStrikes[0].created_at).getTime();
    videoStartMs = firstStrikeTs;
  } else {
    videoStartMs = sessionCreatedMs;
  }

  // Never clamp to artificial 15s if the actual video is only 4 seconds!
  const maxVideoDurationSec = typeof explicitDurationSec === 'number' && explicitDurationSec > 0
    ? explicitDurationSec
    : (recUploadTs > videoStartMs ? Math.max(1, Math.floor((recUploadTs - videoStartMs) / 1000)) : 3600);

  const terminationReason = isTerminated
    ? (violationMeta?.reason ??
       (finalStrikes.length > 0
         ? `Terminated due to proctoring violation (${realStrikeCount} warning${realStrikeCount === 1 ? '' : 's'}: ${finalStrikes[finalStrikes.length - 1]?.category || 'Integrity rules breached'}).`
         : 'Terminated due to candidate leaving or refreshing the interview window.'))
    : null;

  // Extract structured list of warning incidents with precise serial numbers, timestamps, and video offsets
  let proctoringWarnings = finalStrikes.map((w, index) => {
    const meta = (w.metadata || w.meta || {}) as Record<string, unknown>;
    const rawReason = typeof meta.reason === 'string' ? meta.reason.trim() : '';
    const cat = w.category || w.event_type || '';

    let category: 'voice' | 'face' | 'object' | 'general' = 'general';
    let categoryLabel = 'Proctoring Violation';
    let reason = rawReason;

    if (['unauthorized_voice', 'bg_voice', 'background_voice'].includes(cat)) {
      category = 'voice';
      categoryLabel = 'Background Audio / Voice Violation';
      reason = rawReason || 'Background voice or secondary speech detected in the room.';
    } else if (cat === 'gaze_away') {
      category = 'face';
      categoryLabel = 'Looking Away / Abnormal Gaze Violation';
      reason = rawReason || 'Please keep your attention focused on the interview screen.';
    } else if (cat === 'reading_suspected') {
      category = 'face';
      categoryLabel = 'Reading Off-Screen Suspected';
      reason = rawReason || 'Please avoid looking away or reading from another source during the interview.';
    } else if (cat === 'no_face') {
      category = 'face';
      categoryLabel = 'Face Not Visible in Camera';
      reason = rawReason || 'Your face is not clearly visible. Please position yourself properly in front of the camera.';
    } else if (cat === 'multi_face') {
      category = 'face';
      categoryLabel = 'Multiple Faces Detected';
      reason = rawReason || 'Multiple faces detected. Please ensure that only you are present during the interview.';
    } else if (cat === 'framing_issue') {
      category = 'face';
      categoryLabel = 'Face Framing / Position Issue';
      reason = rawReason || 'Please adjust your position so your face remains clearly visible.';
    } else if (['object_detected', 'object', 'cell_phone', 'notes_detected'].includes(cat)) {
      category = 'object';
      const obj = (meta.object as string) || 'cell phone';
      categoryLabel = obj.toLowerCase().includes('phone')
        ? 'Mobile Phone / Unauthorized Device'
        : `${obj.charAt(0).toUpperCase() + obj.slice(1)} Detected`;
      reason = rawReason || `Unauthorized object (${obj}) detected in camera view.`;
    } else if (cat === 'tab_switch' || cat === 'window_blur') {
      category = 'general';
      categoryLabel = 'Tab Switch / Window Minimized';
      reason = rawReason || 'Candidate switched tabs or minimized the interview window.';
    } else if (cat === 'proctoring_violation') {
      category = 'general';
      categoryLabel = 'Integrity Violation (Terminated)';
      reason = rawReason || 'The candidate clicked outside the interview window or switched tabs.';
    } else {
      category = 'general';
      categoryLabel = cat.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Integrity Violation';
      reason = rawReason || `${categoryLabel} recorded during interview.`;
    }

    // Strike number strictly serial (Strike 1 = earliest, Strike 2 = second, Strike 3 = third)
    const storedStrikeNum = Number(meta.strikeNumber || meta.warningCount);
    const strikeNum = Number.isInteger(storedStrikeNum) && storedStrikeNum >= 1 && storedStrikeNum <= 3
      ? storedStrikeNum
      : (index + 1);

    const rawTsMs = w.ts_ms
      ? Number(w.ts_ms)
      : (w.created_at ? new Date(w.created_at).getTime() : undefined);

    const computedOffset = (rawTsMs && videoStartMs > 0 && rawTsMs >= videoStartMs)
      ? Math.floor((rawTsMs - videoStartMs) / 1000)
      : 0;
    const offsetSeconds = Math.max(0, Math.min(computedOffset, maxVideoDurationSec));

    const mins = Math.floor(offsetSeconds / 60);
    const secs = offsetSeconds % 60;
    const elapsedLabel = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const warnDate = rawTsMs ? new Date(rawTsMs) : (w.created_at ? new Date(w.created_at) : undefined);

    return {
      id: w.id || `strike-${strikeNum}`,
      strikeNumber: strikeNum,
      category,
      categoryLabel,
      reason,
      timestamp: warnDate
        ? warnDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : undefined,
      rawTsMs,
      offsetSeconds,
      elapsedLabel,
      severity: w.severity || 'warning',
      snapshotPath: w.snapshot_path || null,
    };
  });

  // If there were NO strikes found, but the session was terminated by proctoring guard,
  // show exactly ONE terminal violation incident rather than leaving it empty
  if (proctoringWarnings.length === 0 && isTerminated) {
    const rawTermTsMs = violationEvent?.ts_ms
      ? Number(violationEvent.ts_ms)
      : (violationEvent?.created_at ? new Date(violationEvent.created_at).getTime() : undefined);
    const termComputed = (rawTermTsMs && videoStartMs > 0 && rawTermTsMs >= videoStartMs)
      ? Math.floor((rawTermTsMs - videoStartMs) / 1000)
      : maxVideoDurationSec;
    const termOffset = Math.max(0, Math.min(termComputed, maxVideoDurationSec));
    const tMins = Math.floor(termOffset / 60);
    const tSecs = termOffset % 60;
    const tElapsedLabel = `${String(tMins).padStart(2, '0')}:${String(tSecs).padStart(2, '0')}`;

    const termDate = rawTermTsMs ? new Date(rawTermTsMs) : (violationEvent?.created_at ? new Date(violationEvent.created_at) : undefined);

    proctoringWarnings = [
      {
        id: violationEvent?.id || 'term-violation-1',
        strikeNumber: 1,
        category: 'general',
        categoryLabel: 'Terminal Integrity Violation',
        reason: terminationReason || 'The candidate clicked outside the interview window or switched tabs.',
        timestamp: termDate
          ? termDate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : undefined,
        rawTsMs: rawTermTsMs,
        offsetSeconds: termOffset,
        elapsedLabel: tElapsedLabel,
        severity: 'critical',
        snapshotPath: violationEvent?.snapshot_path || null,
      },
    ];
  }

  const totalWarnings = Math.max(proctoringWarnings.length, realStrikeCount);

  // ── Extract Zoho Recruiter Link if provided at interview creation ──
  const parsedResume = (session as unknown as { parsed_resume?: { zohoRecruiterLink?: string; zoho_recruiter_link?: string } | null })?.parsed_resume;
  const parsedJd = (session.parsed_jd as { zohoRecruiterLink?: string; zoho_recruiter_link?: string; jobTitle?: string } | null);
  const zohoRecruiterLink =
    parsedResume?.zohoRecruiterLink ||
    parsedResume?.zoho_recruiter_link ||
    parsedJd?.zohoRecruiterLink ||
    parsedJd?.zoho_recruiter_link ||
    (session as unknown as { zoho_recruiter_link?: string })?.zoho_recruiter_link ||
    null;

  // ── Inject terminationReason & zohoRecruiterLink into session object for the view ─────
  const sessionWithReason = {
    ...session,
    termination_reason: terminationReason,
    invite_status: inviteStatus,
    zoho_recruiter_link: zohoRecruiterLink,
  };

  // ── Follow-up questions from fluency_breakdown ─────────────────────
  const fluencyBreakdown = report?.fluency_breakdown as {
    follow_up_recommendations?: string[];
    [key: string]: unknown;
  } | null;
  const followUpQuestions: string[] =
    (Array.isArray(fluencyBreakdown?.follow_up_recommendations)
      ? fluencyBreakdown!.follow_up_recommendations
      : null) ??
    ((report as unknown as { follow_up_recommendations?: string[] })?.follow_up_recommendations ?? []);

  return (
    <ReportDetailView
      session={sessionWithReason as unknown as React.ComponentProps<typeof ReportDetailView>['session']}
      recording={recording}
      report={report as unknown as React.ComponentProps<typeof ReportDetailView>['report']}
      questions={sortedQuestions}
      answers={answers ?? []}
      transcript={transcript ?? []}
      voiceWarningCount={voiceWarningCount}
      faceWarningCount={faceWarningCount}
      objectWarningCount={objectWarningCount}
      totalWarnings={totalWarnings}
      proctoringWarnings={proctoringWarnings}
      followUpQuestions={followUpQuestions}
    />
  );
}
