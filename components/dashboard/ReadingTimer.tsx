'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { logActivity } from '@/lib/data/activity';

/**
 * Sticky reading timer. Counts wall-clock time continuously — does NOT pause
 * when the browser tab is hidden or the user switches dashboard tabs.
 * Accumulated seconds are flushed to the activity store periodically and on
 * unmount.
 */
export default function ReadingTimer({ date }: { date: string }) {
  const [seconds, setSeconds] = useState(0);
  const lastFlushedRef = useRef(0);

  useEffect(() => {
    // Start clock in effect only — Date.now() during render fails react-hooks/purity.
    const startedAt = Date.now();
    lastFlushedRef.current = 0;

    const flushDelta = (elapsed: number) => {
      const delta = elapsed - lastFlushedRef.current;
      if (delta <= 0) return;
      void logActivity({ date, readSeconds: delta });
      lastFlushedRef.current = elapsed;
    };

    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setSeconds(elapsed);
      if (elapsed - lastFlushedRef.current >= 30) {
        flushDelta(elapsed);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    // Catch up immediately when the tab becomes visible again (browsers throttle
    // background intervals, but wall-clock elapsed must keep advancing).
    const onVisibility = () => tick();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      flushDelta(elapsed);
    };
  }, [date]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <motion.div
      id="reading-timer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-full shadow-lg text-sm font-bold tabular-nums"
    >
      <Clock size={14} className="text-brand animate-pulse" />
      <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-extrabold">
        Reading
      </span>
      <span aria-live="polite">
        {mm}:{ss}
      </span>
    </motion.div>
  );
}
