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
  const attemptMinTs = previousRecTs > 0 ? previousRecTs + 1000 : 0;
  const attemptMaxTs = recUploadTs > 0 ? recUploadTs + 60_000 : Infinity;

  const getEventTimeMs = (e: {
    ts_ms?: number | string | null;
    created_at?: string | null;
    metadata?: Record<string, unknown> | null;
    meta?: Record<string, unknown> | null;
  }): number => {
    const meta = (e.meta || e.metadata || {}) as Record<string, unknown>;
    const clientTs = typeof meta.client_ts === 'number' && !Number.isNaN(meta.client_ts) && meta.client_ts > 0
      ? meta.client_ts
      : (typeof meta.client_ts === 'string' && !Number.isNaN(Number(meta.client_ts)) && Number(meta.client_ts) > 0 ? Number(meta.client_ts) : undefined);
    if (clientTs) return clientTs;

    const toastShownTs = typeof meta.toastShownTs === 'number' && !Number.isNaN(meta.toastShownTs) && meta.toastShownTs > 0
      ? meta.toastShownTs
      : (typeof meta.toastShownTs === 'string' && !Number.isNaN(Number(meta.toastShownTs)) && Number(meta.toastShownTs) > 0 ? Number(meta.toastShownTs) : undefined);
    if (toastShownTs) return toastShownTs;

    const warnEventTs = typeof meta.warnEventTs === 'number' && !Number.isNaN(meta.warnEventTs) && meta.warnEventTs > 0
      ? meta.warnEventTs
      : (typeof meta.warnEventTs === 'string' && !Number.isNaN(Number(meta.warnEventTs)) && Number(meta.warnEventTs) > 0 ? Number(meta.warnEventTs) : undefined);
    if (warnEventTs) return warnEventTs;

    const metaTs = typeof meta.ts === 'number' && !Number.isNaN(meta.ts) && meta.ts > 0
      ? meta.ts
      : (typeof meta.ts === 'string' && !Number.isNaN(Number(meta.ts)) && Number(meta.ts) > 0 ? Number(meta.ts) : undefined);
    if (metaTs) return metaTs;

    const rawTsMs = typeof e.ts_ms === 'number' && !Number.isNaN(e.ts_ms) && e.ts_ms > 0
      ? e.ts_ms
      : (typeof e.ts_ms === 'string' && !Number.isNaN(Number(e.ts_ms)) && Number(e.ts_ms) > 0 ? Number(e.ts_ms) : undefined);
    if (rawTsMs) return rawTsMs;

    if (e.created_at) {
      const parsed = new Date(e.created_at).getTime();
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return 0;
  };

  const attemptEvents = allEvents.filter((e) => {
    if (e.category === 'full_recording' || e.event_type === 'full_recording') return false;
    const t = getEventTimeMs(e);
    return t >= attemptMinTs && t <= attemptMaxTs;
  });

  // Extract strikes occurring within this active attempt:
  // Genuine warnings (strike 1, 2, 3) are priority
  const candidateStrikes = attemptEvents.filter((e) => {
    const cat = e.category || e.event_type || '';
    const meta = (e.meta || e.metadata || {}) as Record<string, unknown>;
    const reason = String(meta.reason || '');
    if (cat === 'proctoring_violation' && reason.toLowerCase().includes('three proctoring warnings issued')) {
      return false;
    }
    const hasStrikeMeta =
      (typeof meta.strikeNumber === 'number' && meta.strikeNumber > 0) ||
      (typeof meta.warningCount === 'number' && meta.warningCount > 0);
    return (
      hasStrikeMeta ||
      STRIKE_CATEGORIES.includes(cat) ||
      cat === 'proctoring_warning' ||
      cat === 'warning' ||
      cat === 'tab_switch' ||
      cat === 'window_blur'
    );
  });

  // Strictly sort strikes chronologically:
  // 1. By explicit strikeNumber / warningCount if present
  // 2. By toast offset seconds in video if present
  // 3. By exact occurrence timestamp
  candidateStrikes.sort((a, b) => {
    const aMeta = (a.meta || a.metadata || {}) as Record<string, unknown>;
    const bMeta = (b.meta || b.metadata || {}) as Record<string, unknown>;

    const aStrike = Number(aMeta.strikeNumber || aMeta.warningCount);
    const bStrike = Number(bMeta.strikeNumber || bMeta.warningCount);
    if (Number.isInteger(aStrike) && Number.isInteger(bStrike) && aStrike > 0 && bStrike > 0 && aStrike !== bStrike) {
      return aStrike - bStrike;
    }

    const aOffset = typeof aMeta.screenToastOffsetSec === 'number' && aMeta.screenToastOffsetSec >= 0
      ? aMeta.screenToastOffsetSec
      : (typeof aMeta.offsetSeconds === 'number' && aMeta.offsetSeconds >= 0 ? aMeta.offsetSeconds : undefined);
    const bOffset = typeof bMeta.screenToastOffsetSec === 'number' && bMeta.screenToastOffsetSec >= 0
      ? bMeta.screenToastOffsetSec
      : (typeof bMeta.offsetSeconds === 'number' && bMeta.offsetSeconds >= 0 ? bMeta.offsetSeconds : undefined);

    if (aOffset !== undefined && bOffset !== undefined && aOffset !== bOffset) {
      return aOffset - bOffset;
    }

    const aTime = getEventTimeMs(a);
    const bTime = getEventTimeMs(b);
    return aTime - bTime;
  });

  // Debounce consecutive duplicates from same detector firing within 3 seconds
  // NEVER debounce distinct strikes (e.g. Strike 1 vs Strike 2)
  const debouncedStrikes: typeof candidateStrikes = [];
  for (const event of candidateStrikes) {
    const eTs = getEventTimeMs(event);
    const last = debouncedStrikes[debouncedStrikes.length - 1];
    if (last) {
      const lastTs = getEventTimeMs(last);
      const lastMeta = (last.meta || last.metadata || {}) as Record<string, unknown>;
      const eMeta = (event.meta || event.metadata || {}) as Record<string, unknown>;
      const lastStrike = Number(lastMeta.strikeNumber || lastMeta.warningCount);
      const eStrike = Number(eMeta.strikeNumber || eMeta.warningCount);

      if (Number.isInteger(lastStrike) && Number.isInteger(eStrike) && lastStrike > 0 && eStrike > 0 && lastStrike !== eStrike) {
        debouncedStrikes.push(event);
        continue;
      }

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
            getEventTimeMs(e) <= recUploadTs + 5000
        ) || allEvents.find((e) => e.event_type === 'proctoring_violation'))
    : [...allEvents].reverse().find((e) => e.event_type === 'proctoring_violation');

  const violationMeta = (violationEvent?.metadata || violationEvent?.meta) as { reason?: string } | undefined;

  // If session was terminated and we have fewer than 3 strikes (e.g. exactly 0, 1, or 2 warnings, or terminated by violation),
  // include the terminal proctoring event as the final strike so all warnings are accounted for
  if (isTerminated && violationEvent && debouncedStrikes.length < 3) {
    const alreadyIncluded = debouncedStrikes.some((s) => s.id === violationEvent.id);
    if (!alreadyIncluded) {
      debouncedStrikes.push(violationEvent);
    }
  }

  // Cap to 3 strikes for this attempt
  const finalStrikes = debouncedStrikes.slice(0, 3);

  // 1. Check for most recent explicit recording_started or session_started event for this run
  // Search in attemptEvents first, then in allEvents as a reliable fallback
  const relevantRecStart =
    [...attemptEvents].reverse().find(
      (e) => e.category === 'recording_started' || e.event_type === 'recording_started'
    ) ||
    [...allEvents].reverse().find(
      (e) => e.category === 'recording_started' || e.event_type === 'recording_started'
    );

  const recStartMeta = (relevantRecStart?.meta || relevantRecStart?.metadata || {}) as Record<string, unknown>;
  const recStartServerMs = relevantRecStart?.ts_ms
    ? Number(relevantRecStart.ts_ms)
    : (relevantRecStart?.created_at ? new Date(relevantRecStart.created_at).getTime() : 0);

  // 2. Explicit duration from recording metadata
  const explicitDurationSec = typeof recMeta.durationSeconds === 'number' && recMeta.durationSeconds > 0
    ? recMeta.durationSeconds
    : (typeof recMeta.duration === 'number' && recMeta.duration > 0 ? recMeta.duration : undefined);

  // 3. Fallback server-estimated recording start from upload time - duration
  const estimatedRecStartServerMs = (recUploadTs > 0 && explicitDurationSec && explicitDurationSec > 0)
    ? Math.max(0, recUploadTs - explicitDurationSec * 1000)
    : 0;

  // 4. Explicit recording start timestamp from recording metadata or recording_started meta (moment MediaRecorder started capturing screen)
  const explicitRecStart = Number(
    recMeta.recordingStartTime ||
    recMeta.startedAt ||
    recStartMeta.startedAt ||
    recStartMeta.client_ts ||
    recStartMeta.recordingStartTime ||
    0
  ) || undefined;

  let videoStartMs: number;
  if (explicitRecStart && explicitRecStart > 0) {
    videoStartMs = explicitRecStart;
  } else if (estimatedRecStartServerMs > 0) {
    videoStartMs = estimatedRecStartServerMs;
  } else if (recStartServerMs > 0) {
    videoStartMs = recStartServerMs;
  } else if (finalStrikes.length > 0) {
    // If the first strike recorded a direct offset (e.g. 29s into recording),
    // derive videoStartMs = firstStrikeTs - offset * 1000
    const firstStrikeMeta = (finalStrikes[0].meta || finalStrikes[0].metadata || {}) as Record<string, unknown>;
    const firstStrikeOffset = typeof firstStrikeMeta.screenToastOffsetSec === 'number' && firstStrikeMeta.screenToastOffsetSec > 0
      ? firstStrikeMeta.screenToastOffsetSec
      : (typeof firstStrikeMeta.offsetSeconds === 'number' && firstStrikeMeta.offsetSeconds > 0 ? firstStrikeMeta.offsetSeconds : 0);
    const firstStrikeTs = getEventTimeMs(finalStrikes[0]);
    if (firstStrikeTs > 0 && firstStrikeOffset > 0) {
      videoStartMs = firstStrikeTs - firstStrikeOffset * 1000;
    } else {
      videoStartMs = sessionCreatedMs > 0 ? sessionCreatedMs : (firstStrikeTs || sessionCreatedMs);
    }
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
      categoryLabel = cat.replaceAll('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'Integrity Violation';
      reason = rawReason || `${categoryLabel} recorded during interview.`;
    }

    // Strike number strictly serial (Strike 1 = earliest, Strike 2 = second, Strike 3 = third)
    const storedStrikeNum = Number(meta.strikeNumber || meta.warningCount);
    const strikeNum = Number.isInteger(storedStrikeNum) && storedStrikeNum >= 1 && storedStrikeNum <= 3
      ? storedStrikeNum
      : (index + 1);

    const directOffsetSec = typeof meta.screenToastOffsetSec === 'number' && meta.screenToastOffsetSec >= 0
      ? meta.screenToastOffsetSec
      : (typeof meta.offsetSeconds === 'number' && meta.offsetSeconds >= 0
        ? meta.offsetSeconds
        : (typeof meta.videoOffsetSec === 'number' && meta.videoOffsetSec >= 0 ? meta.videoOffsetSec : undefined));

    const rawTsMs = getEventTimeMs(w) || undefined;

    const computedOffset = (rawTsMs && videoStartMs > 0 && rawTsMs >= videoStartMs)
      ? Math.floor((rawTsMs - videoStartMs) / 1000)
      : undefined;

    let offsetSeconds: number;
    if (directOffsetSec !== undefined && directOffsetSec > 0) {
      offsetSeconds = Math.min(directOffsetSec, maxVideoDurationSec);
    } else if (computedOffset !== undefined && computedOffset > 0) {
      offsetSeconds = Math.min(computedOffset, maxVideoDurationSec);
    } else if (directOffsetSec !== undefined) {
      offsetSeconds = Math.min(directOffsetSec, maxVideoDurationSec);
    } else {
      offsetSeconds = 0;
    }

    const mins = Math.floor(offsetSeconds / 60);
    const secs = offsetSeconds % 60;
    const elapsedLabel = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const warnDate = rawTsMs && rawTsMs > 0 ? new Date(rawTsMs) : (w.created_at ? new Date(w.created_at) : undefined);

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

  // Ensure strike numbers are strictly sequential (1, 2, 3) across warnings
  const assignedStrikes = new Set<number>();
  proctoringWarnings.forEach((warn, idx) => {
    if (warn.strikeNumber && !assignedStrikes.has(warn.strikeNumber) && warn.strikeNumber >= 1 && warn.strikeNumber <= 3) {
      assignedStrikes.add(warn.strikeNumber);
    } else {
      warn.strikeNumber = idx + 1;
      assignedStrikes.add(idx + 1);
    }
  });

  // If there were NO strikes found, but the session was terminated by proctoring guard,
  // show exactly ONE terminal violation incident rather than leaving it empty
  if (proctoringWarnings.length === 0 && isTerminated) {
    const vMeta = (violationEvent?.metadata || violationEvent?.meta || {}) as Record<string, unknown>;
    const directTermOffset = typeof vMeta.screenToastOffsetSec === 'number' && vMeta.screenToastOffsetSec >= 0
      ? vMeta.screenToastOffsetSec
      : (typeof vMeta.offsetSeconds === 'number' && vMeta.offsetSeconds >= 0
        ? vMeta.offsetSeconds
        : (typeof vMeta.videoOffsetSec === 'number' && vMeta.videoOffsetSec >= 0 ? vMeta.videoOffsetSec : undefined));
    const rawTermTsMs = violationEvent ? (getEventTimeMs(violationEvent) || undefined) : undefined;

    let termOffset: number;
    if (directTermOffset !== undefined) {
      termOffset = Math.min(directTermOffset, maxVideoDurationSec);
    } else {
      const termComputed = (rawTermTsMs && videoStartMs > 0 && rawTermTsMs >= videoStartMs)
        ? Math.floor((rawTermTsMs - videoStartMs) / 1000)
        : maxVideoDurationSec;
      termOffset = Math.max(0, Math.min(termComputed, maxVideoDurationSec));
    }
    const tMins = Math.floor(termOffset / 60);
    const tSecs = termOffset % 60;
    const tElapsedLabel = `${String(tMins).padStart(2, '0')}:${String(tSecs).padStart(2, '0')}`;

    const termDate = rawTermTsMs && rawTermTsMs > 0 ? new Date(rawTermTsMs) : (violationEvent?.created_at ? new Date(violationEvent.created_at) : undefined);

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
