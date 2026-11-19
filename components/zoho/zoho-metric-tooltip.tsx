'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

export const ZOHO_METRIC_TIPS = {
  plannedTime: {
    title: 'Planned Time',
    text: 'Time planned for this task.',
  },
  actualSpent: {
    title: 'Actual Spent',
    text: 'Total time logged in Zoho.',
  },
  timeSpentScore: {
    title: 'Time Spent',
    text: 'Score for finishing on time within the allowed buffer.',
  },
  workScore: {
    title: 'Work Score',
    text: 'Score for how clearly comments explain the work done.',
  },
  dayScore: {
    title: 'Day Score',
    text: 'Overall score for today\'s tasks.',
  },
  statusBreakdown: {
    title: 'Status Breakdown',
    text: 'Shows if tasks are in QA Review or Completed.',
  },
};

interface ZohoMetricTooltipProps {
  title?: string;
  text: string;
  children?: React.ReactNode;
  position?: 'top' | 'bottom';
  className?: string;
  iconClassName?: string;
}

export function ZohoMetricTooltip({
  title,
  text,
  children,
  position = 'top',
  className = '',
  iconClassName = 'w-3 h-3',
}: ZohoMetricTooltipProps) {
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
      aria-label={title ? `${title}: ${text}` : text}
    >
      {children}
      <Info
        className={`text-zinc-400 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] transition-colors shrink-0 ${iconClassName}`}
        aria-hidden="true"
      />

      {isVisible && (
        <span
          className={`absolute z-50 left-1/2 -translate-x-1/2 ${
            position === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } w-48 sm:w-56 p-2 rounded-lg bg-zinc-900/95 dark:bg-[#1a1a1a]/95 text-white dark:text-zinc-100 text-[11px] leading-snug shadow-xl border border-zinc-700/60 pointer-events-none backdrop-blur-xs animate-in fade-in zoom-in-95 duration-100 block text-left font-normal normal-case tracking-normal`}
        >
          {title && <strong className="block font-bold text-xs text-[#34c4f2] mb-0.5">{title}</strong>}
          <span>{text}</span>
          <span
            className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
              position === 'top'
                ? 'top-full -mt-px border-t-zinc-900/95 dark:border-t-[#1a1a1a]/95'
                : 'bottom-full -mb-px border-b-zinc-900/95 dark:border-b-[#1a1a1a]/95'
            }`}
          />
        </span>
      )}
    </span>
  );
}

export default ZohoMetricTooltip;
