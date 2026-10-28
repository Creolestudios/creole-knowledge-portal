'use client';

import React from 'react';
import { Calendar, Search, Filter, Clock, ChevronDown } from 'lucide-react';

export interface FilterState {
  type: 'week' | 'month' | 'range';
  weekOffset: number;
  monthOffset: number;
  startDate: string;
  endDate: string;
  search: string;
}

interface ZohoFilterBarProps {
  filter: FilterState;
  onChange: (updated: Partial<FilterState>) => void;
}

export default function ZohoFilterBar({ filter, onChange }: ZohoFilterBarProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm space-y-4">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Preset Filter Tabs (Zoho Style) */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-x-auto text-xs font-semibold">
          <button
            type="button"
            onClick={() => onChange({ type: 'week', weekOffset: 0 })}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter.type === 'week' && filter.weekOffset === 0
                ? 'bg-white dark:bg-zinc-900 text-[#34c4f2] shadow-sm font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => onChange({ type: 'week', weekOffset: -1 })}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter.type === 'week' && filter.weekOffset === -1
                ? 'bg-white dark:bg-zinc-900 text-[#34c4f2] shadow-sm font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            Last Week
          </button>
          <button
            type="button"
            onClick={() => onChange({ type: 'month', monthOffset: 0 })}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter.type === 'month' && filter.monthOffset === 0
                ? 'bg-white dark:bg-zinc-900 text-[#34c4f2] shadow-sm font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => onChange({ type: 'month', monthOffset: -1 })}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter.type === 'month' && filter.monthOffset === -1
                ? 'bg-white dark:bg-zinc-900 text-[#34c4f2] shadow-sm font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            Last Month
          </button>
          <button
            type="button"
            onClick={() => onChange({ type: 'range' })}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
              filter.type === 'range'
                ? 'bg-white dark:bg-zinc-900 text-[#34c4f2] shadow-sm font-bold'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Custom Range</span>
          </button>
        </div>

        {/* User Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search employee by name, email or role..."
            value={filter.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="w-full pl-10 pr-4 py-2 text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#34c4f2]"
          />
        </div>
      </div>

      {/* Custom Date Range Pickers (Visible when custom range selected) */}
      {filter.type === 'range' && (
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
          <span className="font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[#34c4f2]" /> Select Range:
          </span>
          <div className="flex items-center gap-2">
            <label htmlFor="zoho-start-date" className="text-zinc-400">From:</label>
            <input
              id="zoho-start-date"
              type="date"
              value={filter.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
              className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#34c4f2]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="zoho-end-date" className="text-zinc-400">To:</label>
            <input
              id="zoho-end-date"
              type="date"
              value={filter.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
              className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#34c4f2]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
