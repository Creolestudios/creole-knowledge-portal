import { NextResponse } from 'next/server';
import { processZohoWebhookTask, syncLiveZohoTasks } from '@/lib/zoho/sync';

/**
 * Zoho Projects Webhook Endpoint
 *
 * Zoho Projects sends instant webhook notifications whenever a task is:
 * - Created
 * - Updated (status changed, time logged, description edited)
 * - Deleted
 *
 * This allows real-time task ingestion directly into the Creole Knowledge Portal.
 */

export async function GET(request: Request) {
  // Support Zoho webhook verification challenges
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge') || searchParams.get('token');

  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/zoho',
    challenge: challenge || 'zoho-webhook-verified',
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    let payload: any = null;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      try {
        payload = await request.json();
      } catch {
        const text = await request.text();
        payload = { raw: text };
      }
    }

    console.log('[ZohoWebhook] Incoming task event:', payload?.event || payload?.action || 'task_event');

    // Invalidate cache and trigger real-time sync in background
    await processZohoWebhookTask(payload);
    // Non-blocking sync to refresh live cache immediately
    syncLiveZohoTasks(true).catch((err) => {
      console.warn('[ZohoWebhook] Background sync error:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Zoho task webhook processed successfully. Portal updated.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ZohoWebhook] Error processing webhook:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
