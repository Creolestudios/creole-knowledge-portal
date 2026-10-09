'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface MetricTooltipProps {
  label: string;
  explanation: string;
  children?: React.ReactNode;
  showIcon?: boolean;
  className?: string;
}

export function MetricTooltip({
  label,
  explanation,
  children,
  showIcon = true,
  className = '',
}: MetricTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      className={`relative inline-flex items-center gap-1 cursor-help group ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      tabIndex={0}
      role="tooltip"
      aria-label={`${label}: ${explanation}`}
    >
      {children ? children : <span>{label}</span>}
      {showIcon && (
        <Info className="w-3.5 h-3.5 text-zinc-400 group-hover:text-[#34c4f2] transition-colors flex-shrink-0" />
      )}

      {/* Floating Tooltip Bubble */}
      {isVisible && (
        <span
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 rounded-xl bg-zinc-900/95 dark:bg-[#1a1a1a]/95 text-white dark:text-zinc-100 text-[11px] leading-relaxed shadow-xl border border-zinc-700/60 dark:border-zinc-700 pointer-events-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 block text-left font-normal"
        >
          <strong className="block font-bold text-xs text-[#34c4f2] mb-0.5">{label}</strong>
          <span>{explanation}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-zinc-900/95 dark:border-t-[#1a1a1a]/95" />
        </span>
      )}
    </span>
  );
}

export const METRIC_EXPLANATIONS: Record<string, string> = {
  communication: 'Measures how fluently, clearly, and correctly the candidate forms sentences and articulates technical ideas in English.',
  smartness: 'Evaluates executive presence, quickness of thought, confidence, and structured problem solving under interview conditions.',
  technical_depth: 'Assesses engineering domain mastery, architectural reasoning, and depth of technical problem-solving capability.',
  grammar: 'Assesses grammatical correctness, verb tense consistency, and syntactical accuracy in spoken answers.',
  vocabulary: 'Measures the breadth, richness, and precision of professional and technical terminology used.',
  coherence: 'Evaluates how logically ideas are connected, organized, and delivered from start to finish.',
  fluency: 'Assesses speaking rhythm, natural cadence, and absence of unnatural pauses or stuttering.',
  pace: 'Calculates speaking pace in words per minute (optimal professional rate is 120–160 WPM).',
  fillers: 'Measures verbal hesitations (e.g., um, uh, like). An optimal rate is under 3% of spoken words; frequent filler usage decreases articulation crispness.',
};
