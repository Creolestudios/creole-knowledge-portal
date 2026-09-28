import { supabaseAdmin } from '@/lib/supabase/admin';

export interface StoredInterviewReport {
  id?: string;
  session_id: string;
  cognitive_composite?: number | null;
  reasoning_subscore?: number | null;
  clarity_subscore?: number | null;
  fluency_score?: number | null;
  fluency_cefr?: string | null;
  fluency_breakdown?: Record<string, unknown> | null;
  local_metrics?: unknown;
  competency_scores?: unknown[] | null;
  recommendation?: 'strong_yes' | 'yes' | 'maybe' | 'no' | null;
  recommendation_rationale?: string | null;
  flags?: string[] | null;
  rubric_version?: string;
  created_at?: string;
  [key: string]: unknown;
}

/**
 * Saves an interview report.
 * Tries `interview_reports` table first; if the table does not exist in Supabase (PGRST205),
 * falls back seamlessly to persisting in `interview_events` with event_type: 'scoring_report'.
 */
export async function saveInterviewReport(
  reportPayload: StoredInterviewReport
): Promise<{ success: boolean; target: 'table' | 'event'; id?: string; error?: string }> {
  const sessionId = reportPayload.session_id;

  // 1. Try public.interview_reports
  try {
    const { data: existingReport, error: selErr } = await supabaseAdmin
      .from('interview_reports')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!selErr) {
      if (existingReport?.id) {
        const { error: updErr } = await supabaseAdmin
          .from('interview_reports')
          .update(reportPayload)
          .eq('id', existingReport.id);
        if (!updErr) {
          return { success: true, target: 'table', id: existingReport.id };
        }
      } else {
        const { data: insData, error: insErr } = await supabaseAdmin
          .from('interview_reports')
          .insert(reportPayload)
          .select('id')
          .maybeSingle();
        if (!insErr) {
          return { success: true, target: 'table', id: insData?.id };
        }
      }
    }
  } catch {
    // Ignore and proceed to resilient fallback
  }

  // 2. Resilient fallback: public.interview_events with event_type: 'scoring_report'
  try {
    const { data: existingEvent } = await supabaseAdmin
      .from('interview_events')
      .select('id')
      .eq('session_id', sessionId)
      .eq('event_type', 'scoring_report')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEvent?.id) {
      const { error: updEventErr } = await supabaseAdmin
        .from('interview_events')
        .update({
          metadata: reportPayload,
          meta: reportPayload,
          severity: 'info',
        })
        .eq('id', existingEvent.id);

      if (updEventErr) {
        return { success: false, target: 'event', error: updEventErr.message };
      }
      return { success: true, target: 'event', id: existingEvent.id };
    }

    const { data: insEvent, error: insEventErr } = await supabaseAdmin
      .from('interview_events')
      .insert({
        session_id: sessionId,
        event_type: 'scoring_report',
        severity: 'info',
        metadata: reportPayload,
        meta: reportPayload,
        confidence: 1,
      })
      .select('id')
      .maybeSingle();

    if (insEventErr) {
      return { success: false, target: 'event', error: insEventErr.message };
    }
    return { success: true, target: 'event', id: insEvent?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, target: 'event', error: msg };
  }
}

/**
 * Retrieves a single report for a given session ID.
 * Checks `interview_reports` table first, then falls back to `interview_events`.
 */
export async function getInterviewReport(
  sessionId: string
): Promise<StoredInterviewReport | null> {
  // 1. Try public.interview_reports
  try {
    const { data: rep, error } = await supabaseAdmin
      .from('interview_reports')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!error && rep) {
      return rep as StoredInterviewReport;
    }
  } catch {
    // Fall back to interview_events
  }

  // 2. Fall back to public.interview_events
  try {
    const { data: event, error: eventErr } = await supabaseAdmin
      .from('interview_events')
      .select('id, session_id, metadata, created_at')
      .eq('session_id', sessionId)
      .eq('event_type', 'scoring_report')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!eventErr && event && event.metadata) {
      const meta = event.metadata as Record<string, unknown>;
      return {
        id: event.id,
        session_id: sessionId,
        created_at: event.created_at,
        ...meta,
      } as StoredInterviewReport;
    }
  } catch {
    // No report found
  }

  return null;
}

/**
 * Batch retrieves reports for multiple session IDs.
 * Checks `interview_reports` table first, then supplements any missing with `interview_events`.
 */
export async function getInterviewReports(
  sessionIds: string[]
): Promise<Map<string, StoredInterviewReport>> {
  const map = new Map<string, StoredInterviewReport>();
  if (!sessionIds.length) return map;

  // 1. Query interview_reports
  try {
    const { data: tableReports, error } = await supabaseAdmin
      .from('interview_reports')
      .select('*')
      .in('session_id', sessionIds);

    if (!error && tableReports) {
      for (const r of tableReports) {
        if (r.session_id) {
          map.set(r.session_id, r as StoredInterviewReport);
        }
      }
    }
  } catch {
    // Ignore and proceed to event fallback
  }

  // 2. For any sessions not in map, query interview_events
  const missingIds = sessionIds.filter((id) => !map.has(id));
  if (missingIds.length > 0) {
    try {
      const { data: eventReports, error: eventErr } = await supabaseAdmin
        .from('interview_events')
        .select('id, session_id, metadata, created_at')
        .in('session_id', missingIds)
        .eq('event_type', 'scoring_report')
        .order('created_at', { ascending: false });

      if (!eventErr && eventReports) {
        for (const ev of eventReports) {
          if (ev.session_id && !map.has(ev.session_id) && ev.metadata) {
            const meta = ev.metadata as Record<string, unknown>;
            map.set(ev.session_id, {
              id: ev.id,
              session_id: ev.session_id,
              created_at: ev.created_at,
              ...meta,
            } as StoredInterviewReport);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  return map;
}
