import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateTaskQuality } from '@/lib/zoho/task-quality-validator';
import { parseDurationToMinutes } from '@/lib/zoho/client';

export const runtime = 'nodejs';

/**
 * Computes current date & time in IST (Asia/Kolkata)
 */
function getISTNow(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 3600000;
  return new Date(utc + istOffset);
}

/**
 * Checks if current IST time is past 8:30 AM (08:30) for a given target date.
 * - In test environments (NODE_ENV === 'test' or VITEST), returns false so unit tests can run any time.
 * - If targetDate is in the future, returns false (developers can plan ahead).
 * - If targetDate is today, returns true if current IST time >= 08:30.
 * - If targetDate is in the past, returns true (locked).
 */
export function isPastCutoffIST(targetDateStr?: string): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return false;
  }

  const ist = getISTNow();
  const todayStr = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;

  if (!targetDateStr || targetDateStr === todayStr) {
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    return hours > 8 || (hours === 8 && minutes >= 30);
  }

  if (targetDateStr > todayStr) {
    return false;
  }

  return true;
}

/**
 * GET /api/user/zoho/planned-tasks?date=YYYY-MM-DD
 * Retrieves the logged-in developer's tasks planned for a specific date
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');

    let query = supabaseAdmin
      .from('zoho_tasks')
      .select('id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, sync_status, zoho_status, created_time')
      .eq('user_id', user.id);

    if (dateParam) {
      query = query.eq('task_date', dateParam);
    }

    const { data: tasks, error } = await query.order('created_time', { ascending: true });

    if (error) {
      console.error('[planned-tasks/GET] DB fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch planned tasks' }, { status: 500 });
    }

    return NextResponse.json({ tasks: tasks || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planned-tasks/GET] Unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/user/zoho/planned-tasks
 * Adds a new planned task into public.zoho_tasks with sync_status = 'queued'
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectName,
      zohoProjectId,
      taskName,
      taskDescription,
      plannedHours,
      targetDate,
    } = body;

    // 8:30 AM IST server-side cutoff validation
    if (isPastCutoffIST(targetDate)) {
      return NextResponse.json(
        { error: '8:30 AM Cutoff Passed. Task submissions for this target date are closed.' },
        { status: 403 }
      );
    }

    // Compulsory field validation
    if (!projectName || !String(projectName).trim()) {
      return NextResponse.json({ error: 'Target Project is compulsory' }, { status: 400 });
    }
    if (!taskName || !String(taskName).trim()) {
      return NextResponse.json({ error: 'Task Title is compulsory' }, { status: 400 });
    }
    if (!taskDescription || !String(taskDescription).trim()) {
      return NextResponse.json({ error: 'Task Description & Technical Scope is compulsory' }, { status: 400 });
    }
    const parsedMinutes = typeof plannedHours === 'string'
      ? parseDurationToMinutes(plannedHours)
      : typeof plannedHours === 'number'
      ? parseDurationToMinutes(plannedHours)
      : 0;

    const hoursNum = parsedMinutes > 0 ? parsedMinutes / 60 : Number(plannedHours);

    if (!Number.isFinite(hoursNum) || hoursNum < (1 / 60)) {
      return NextResponse.json({ error: 'Planned duration must be at least 1 minute' }, { status: 400 });
    }
    if (hoursNum > 4.0) {
      return NextResponse.json({ error: 'Planned duration cannot exceed 4 hours for a single task' }, { status: 400 });
    }
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate))) {
      return NextResponse.json({ error: 'A valid targetDate (YYYY-MM-DD) is compulsory' }, { status: 400 });
    }

    // Task Quality & Depth Validation (word count, vague title, relevance)
    const quality = validateTaskQuality(String(taskName), String(taskDescription), 40);
    if (!quality.isValid) {
      const errorMsg = quality.titleError || quality.descriptionError || quality.relevanceError;
      return NextResponse.json({ error: errorMsg, quality }, { status: 400 });
    }

    // Single Table insert: public.zoho_tasks
    let insertedTask: any = null;
    const basePayload = {
      user_id: user.id,
      zoho_project_id: zohoProjectId || 'ckp_main',
      project_name: String(projectName).trim(),
      task_name: String(taskName).trim(),
      task_description: String(taskDescription).trim(),
      planned_hours: Number(hoursNum.toFixed(2)),
      task_date: targetDate,
      zoho_status: 'Planned',
      created_time: new Date().toISOString(),
    };

    const { data: inserted, error } = await supabaseAdmin
      .from('zoho_tasks')
      .insert({
        ...basePayload,
        sync_status: 'queued',
      })
      .select('id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, sync_status, zoho_status, created_time')
      .single();

    if (error) {
      // Fallback for unmigrated remote DB schema (where zoho_task_id/zoho_link are NOT NULL or sync_status does not exist)
      console.warn('[planned-tasks/POST] Primary insert failed, trying schema-tolerant fallback:', error.message);
      const fallbackPayload = {
        ...basePayload,
        zoho_task_id: `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        zoho_link: 'https://projects.zoho.in',
      };
      const { data: fallbackInserted, error: fallbackErr } = await supabaseAdmin
        .from('zoho_tasks')
        .insert(fallbackPayload)
        .select('id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, zoho_status, created_time')
        .single();

      if (fallbackErr) {
        console.error('[planned-tasks/POST] DB fallback insert error:', fallbackErr);
        return NextResponse.json({ error: 'Failed to save planned task' }, { status: 500 });
      }
      insertedTask = fallbackInserted;
    } else {
      insertedTask = inserted;
    }

    return NextResponse.json({ task: insertedTask }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planned-tasks/POST] Unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/user/zoho/planned-tasks
 * Updates an existing queued planned task in public.zoho_tasks before the 10:00 PM cutoff
 */
export async function PUT(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      id,
      projectName,
      zohoProjectId,
      taskName,
      taskDescription,
      plannedHours,
      targetDate,
    } = body;

    // 8:30 AM IST server-side cutoff validation
    if (isPastCutoffIST(targetDate)) {
      return NextResponse.json(
        { error: '8:30 AM Cutoff Passed. Task modifications are locked.' },
        { status: 403 }
      );
    }

    if (!id || !String(id).trim()) {
      return NextResponse.json({ error: 'Task ID is compulsory for update' }, { status: 400 });
    }
    if (!projectName || !String(projectName).trim()) {
      return NextResponse.json({ error: 'Target Project is compulsory' }, { status: 400 });
    }
    if (!taskName || !String(taskName).trim()) {
      return NextResponse.json({ error: 'Task Title is compulsory' }, { status: 400 });
    }
    if (!taskDescription || !String(taskDescription).trim()) {
      return NextResponse.json({ error: 'Task Description & Technical Scope is compulsory' }, { status: 400 });
    }
    const parsedMinutes = typeof plannedHours === 'string'
      ? parseDurationToMinutes(plannedHours)
      : typeof plannedHours === 'number'
      ? parseDurationToMinutes(plannedHours)
      : 0;

    const hoursNum = parsedMinutes > 0 ? parsedMinutes / 60 : Number(plannedHours);

    if (!Number.isFinite(hoursNum) || hoursNum < (1 / 60)) {
      return NextResponse.json({ error: 'Planned duration must be at least 1 minute' }, { status: 400 });
    }
    if (hoursNum > 4.0) {
      return NextResponse.json({ error: 'Planned duration cannot exceed 4 hours for a single task' }, { status: 400 });
    }

    // Task Quality & Depth Validation (word count, vague title, relevance)
    const quality = validateTaskQuality(String(taskName), String(taskDescription), 40);
    if (!quality.isValid) {
      const errorMsg = quality.titleError || quality.descriptionError || quality.relevanceError;
      return NextResponse.json({ error: errorMsg, quality }, { status: 400 });
    }

    // Update the existing row in public.zoho_tasks
    const { data: updated, error } = await supabaseAdmin
      .from('zoho_tasks')
      .update({
        zoho_project_id: zohoProjectId || 'ckp_main',
        project_name: String(projectName).trim(),
        task_name: String(taskName).trim(),
        task_description: String(taskDescription).trim(),
        planned_hours: Number(hoursNum.toFixed(2)),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('sync_status', 'queued')
      .select('id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, sync_status, zoho_status, created_time')
      .single();

    if (error) {
      console.error('[planned-tasks/PUT] DB update error:', error);
      return NextResponse.json({ error: 'Failed to update planned task' }, { status: 500 });
    }

    return NextResponse.json({ task: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planned-tasks/PUT] Unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/user/zoho/planned-tasks?id=UUID
 * Deletes a queued planned task before the 10:00 PM cutoff
 */
export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isPastCutoffIST()) {
      return NextResponse.json(
        { error: '8:30 AM Cutoff Passed. Tasks are locked and cannot be deleted.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('id');

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    // Only allow deletion of user's own queued planned tasks
    const { error } = await supabaseAdmin
      .from('zoho_tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', user.id)
      .eq('sync_status', 'queued');

    if (error) {
      console.error('[planned-tasks/DELETE] DB delete error:', error);
      return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planned-tasks/DELETE] Unexpected error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

