/**
 * Next.js 15 Server Instrumentation Hook
 * Executes automatically when the Next.js server starts in production (Node.js runtime).
 * Initializes internal background cron timers (Zoho evaluation and planned task sync).
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const { startInProcessCron } = await import('./lib/zoho/in-process-cron');
      startInProcessCron();
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize in-process cron scheduler:', err);
    }
  }
}
