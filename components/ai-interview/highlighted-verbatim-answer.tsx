'use client';

import React from 'react';
import { identifyFillerSpans } from '@/lib/ai-interview/fluency-calculator';

export interface HighlightedVerbatimAnswerProps {
  text: string;
  className?: string;
  showLegend?: boolean;
}

/**
 * Renders candidate answers verbatim, highlighting verbal filler hesitations
 * (e.g., um, uh, like, you know) in a distinct titled/italic font with a subtle amber badge.
 */
export function HighlightedVerbatimAnswer({
  text,
  className = '',
  showLegend = true,
}: HighlightedVerbatimAnswerProps) {
  if (!text) return null;

  const spans = identifyFillerSpans(text);
  const hasFillers = spans.some((s) => s.isFiller);

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="text-base sm:text-lg text-zinc-900 dark:text-white leading-relaxed whitespace-pre-wrap font-medium">
        {spans.map((span, idx) => {
          if (!span.isFiller) {
            return <React.Fragment key={idx}>{span.text}</React.Fragment>;
          }

          return (
            <span
              key={idx}
              title={`Verbal filler hesitation: "${span.fillerWord || span.text.trim()}"`}
              className="inline-block mx-0.5 px-1.5 py-0.5 rounded font-semibold italic text-amber-700 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/50 border border-amber-300/80 dark:border-amber-700/60 shadow-2xs select-text cursor-help transition-all hover:bg-amber-200/90 dark:hover:bg-amber-900/60"
            >
              {span.text}
            </span>
          );
        })}
      </p>

      {hasFillers && showLegend && (
        <div className="flex items-center gap-1.5 pt-0.5 text-xs text-amber-700 dark:text-amber-400 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>Tilted font highlights detected verbal filler words (e.g., um, uh, like).</span>
        </div>
      )}
    </div>
  );
}
