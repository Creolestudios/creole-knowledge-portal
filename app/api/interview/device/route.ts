import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase/admin';
import { resolveInterviewSessionId } from '../../../../lib/ai-interview/invite-token';

export const runtime = 'nodejs';

/**
 * POST /api/interview/device
 *
 * Saves whether the candidate is using Bluetooth or the standard Microphone into the database.
 * 1. Inserts a 'device_info' event in interview_events (metadata: { audio_device_type: 'bluetooth' | 'mic' })
 * 2. Updates interview_sessions.audio_device_type = 'bluetooth' | 'mic'
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const audioDeviceType = body?.audioDeviceType === 'bluetooth' ? 'bluetooth' : 'mic';
  const deviceLabel = (body?.deviceLabel as string) || '';

  if (!interviewId) {
    return NextResponse.json({ error: 'interviewId is required' }, { status: 400 });
  }

  const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

  // 1. Record in interview_events table for HR audit trail & report view
  const eventPayload = {
    session_id: targetSessionId,
    event_type: 'device_info',
    category: 'device_info',
    severity: 'info',
    meta: {
      audio_device_type: audioDeviceType,
      device_label: deviceLabel,
      is_bluetooth: audioDeviceType === 'bluetooth',
      recorded_at: new Date().toISOString(),
    },
    metadata: {
      audio_device_type: audioDeviceType,
      device_label: deviceLabel,
      is_bluetooth: audioDeviceType === 'bluetooth',
      recorded_at: new Date().toISOString(),
    },
  };

  try {
    await supabaseAdmin.from('interview_events').insert(eventPayload);
  } catch (err) {
    console.warn('[interview/device] Failed to log event:', err);
  }

  // 2. Also update interview_sessions table if the column exists
  try {
    await supabaseAdmin
      .from('interview_sessions')
      .update({ audio_device_type: audioDeviceType, updated_at: new Date().toISOString() })
      .eq('id', targetSessionId);
  } catch (sessionErr) {
    console.warn('[interview/device] Could not update interview_sessions column:', sessionErr);
  }

  return NextResponse.json({
    success: true,
    interviewId: targetSessionId,
    audioDeviceType,
    deviceLabel,
  });
}
