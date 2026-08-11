'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { logActivity } from '@/lib/data/activity';

/**
 * Sticky reading timer. Counts up while the tab is visible and the component
 * is mounted; pauses when the browser tab loses focus. Accumulated seconds are
 * flushed to the activity store periodically and on unmount, so the Activity
 * tab reflects real reading time.
 */
export default function ReadingTimer({ date }: { date: string }) {
  const [seconds, setSeconds] = useState(0);
  const unflushedRef = useRef(0);

  useEffect(() => {
    let active = !document.hidden;

    const interval = setInterval(() => {
      if (!active) return;
      setSeconds((s) => s + 1);
      unflushedRef.current += 1;
      // Flush every 30s so progress survives reloads / navigation.
      if (unflushedRef.current >= 30) {
        void logActivity({ date, readSeconds: unflushedRef.current });
        unflushedRef.current = 0;
      }
    }, 1000);

    const onVisibility = () => {
      active = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      if (unflushedRef.current > 0) {
        void logActivity({ date, readSeconds: unflushedRef.current });
        unflushedRef.current = 0;
      }
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
