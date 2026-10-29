'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import {
  getISOWeekNumber,
  formatDateDDMMYYYY,
  formatDateYYYYMMDD,
} from '@/lib/zoho/service';

export interface DateRangeSelection {
  type: 'week' | 'month' | 'range';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  weekNumber?: number;
  label: string;
}

interface ZohoDateFilterPickerProps {
  value: DateRangeSelection;
  onChange: (selection: DateRangeSelection) => void;
}

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAY_NAMES_HEADER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function ZohoDateFilterPicker({ value, onChange }: ZohoDateFilterPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'week' | 'month' | 'range'>(value.type);

  // Present date boundaries to prevent selecting future dates
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const todayIso = formatDateYYYYMMDD(now);

  const currentDayOfWeek = now.getDay();
  const diffToCurrentMonday = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
  const currentMonday = new Date(now);
  currentMonday.setDate(now.getDate() + diffToCurrentMonday);
  currentMonday.setHours(0, 0, 0, 0);
  const currentMondayIso = formatDateYYYYMMDD(currentMonday);

  // Temporary selection state while popup is open
  const [viewYear, setViewYear] = useState<number>(() => {
    const d = value.startDate ? new Date(value.startDate) : new Date();
    return Number.isNaN(d.getTime()) ? currentYear : d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState<number>(() => {
    const d = value.startDate ? new Date(value.startDate) : new Date();
    return Number.isNaN(d.getTime()) ? currentMonth : d.getMonth();
  });

  const [tempStart, setTempStart] = useState<string>(value.startDate);
  const [tempEnd, setTempEnd] = useState<string>(value.endDate);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync internal state when external value changes
  useEffect(() => {
    setActiveTab(value.type);
    setTempStart(value.startDate);
    setTempEnd(value.endDate);
    const d = value.startDate ? new Date(value.startDate) : new Date();
    if (!Number.isNaN(d.getTime())) {
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Compute weeks for a given year & month (Monday start)
  const getCalendarWeeks = (year: number, month: number) => {
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);

    const day = firstOfMonth.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const current = new Date(firstOfMonth);
    current.setDate(firstOfMonth.getDate() + diffToMonday);

    const weeks = [];
    while (current <= lastOfMonth || current.getDay() !== 1) {
      const weekDays = [];
      const weekNumber = getISOWeekNumber(current);
      for (let i = 0; i < 7; i++) {
        weekDays.push({
          date: new Date(current),
          dayOfMonth: current.getDate(),
          isCurrentMonth: current.getMonth() === month,
          isoString: formatDateYYYYMMDD(current),
        });
        current.setDate(current.getDate() + 1);
      }
      weeks.push({ weekNumber, days: weekDays });
      if (current > lastOfMonth && current.getDay() === 1) break;
    }
    return weeks;
  };

  // Helper to calculate week start & end for a selected date
  const selectWeekForDate = (targetDate: Date) => {
    const day = targetDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(targetDate);
    monday.setDate(targetDate.getDate() + diffToMonday);

    const startIso = formatDateYYYYMMDD(monday);
    // Block selecting a future week
    if (startIso > currentMondayIso) return;

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const endIso = formatDateYYYYMMDD(sunday);

    setTempStart(startIso);
    setTempEnd(endIso);
  };

  // Determine if stepping forward on the main bar would enter the future
  const isNextDisabledOnMainBar = (() => {
    if (value.type === 'week') {
      return value.startDate >= currentMondayIso;
    }
    if (value.type === 'month') {
      const s = new Date(value.startDate);
      if (Number.isNaN(s.getTime())) return false;
      return (
        s.getFullYear() > currentYear ||
        (s.getFullYear() === currentYear && s.getMonth() >= currentMonth)
      );
    }
    if (value.type === 'range') {
      return value.endDate >= todayIso;
    }
    return false;
  })();

  // Handle previous / next stepper on the main bar
  const handleStep = (direction: 'prev' | 'next') => {
    if (direction === 'next' && isNextDisabledOnMainBar) return;

    const factor = direction === 'prev' ? -1 : 1;
    const currentStartDate = new Date(value.startDate);
    if (Number.isNaN(currentStartDate.getTime())) return;

    if (value.type === 'week') {
      const nextMonday = new Date(currentStartDate);
      nextMonday.setDate(currentStartDate.getDate() + factor * 7);
      const startIso = formatDateYYYYMMDD(nextMonday);

      // Block stepping into future week
      if (factor === 1 && startIso > currentMondayIso) return;

      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);
      const endIso = formatDateYYYYMMDD(nextSunday);
      const weekNum = getISOWeekNumber(nextMonday);
      onChange({
        type: 'week',
        startDate: startIso,
        endDate: endIso,
        weekNumber: weekNum,
        label: `${formatDateDDMMYYYY(nextMonday)} to ${formatDateDDMMYYYY(nextSunday)} (WEEK - ${weekNum})`,
      });
      return;
    }

    if (value.type === 'month') {
      const nextMonth = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth() + factor, 1);
      // Block stepping into future month
      if (
        factor === 1 &&
        (nextMonth.getFullYear() > currentYear ||
          (nextMonth.getFullYear() === currentYear && nextMonth.getMonth() > currentMonth))
      ) {
        return;
      }

      const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
      const startIso = formatDateYYYYMMDD(nextMonth);
      const endIso = formatDateYYYYMMDD(lastDay);
      onChange({
        type: 'month',
        startDate: startIso,
        endDate: endIso,
        label: `${MONTH_NAMES_SHORT[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`,
      });
      return;
    }

    // Range: shift by duration
    const currentEndDate = new Date(value.endDate);
    const diffMs = currentEndDate.getTime() - currentStartDate.getTime();
    const durationDays = Math.max(1, Math.round(diffMs / 86400000) + 1);

    const nextStart = new Date(currentStartDate);
    nextStart.setDate(currentStartDate.getDate() + factor * durationDays);
    const nextEnd = new Date(currentEndDate);
    nextEnd.setDate(currentEndDate.getDate() + factor * durationDays);

    const startIso = formatDateYYYYMMDD(nextStart);
    const endIso = formatDateYYYYMMDD(nextEnd);

    // Block stepping if end date exceeds today
    if (factor === 1 && endIso > todayIso) return;

    onChange({
      type: 'range',
      startDate: startIso,
      endDate: endIso,
      label: `${formatDateDDMMYYYY(nextStart)} to ${formatDateDDMMYYYY(nextEnd)}`,
    });
  };

  // Commit selection when "OK" is clicked
  const handleApply = () => {
    const sDate = new Date(tempStart);
    const eDate = new Date(tempEnd);

    if (activeTab === 'week') {
      // Prevent applying a future week
      const safeStart = tempStart > currentMondayIso ? currentMondayIso : tempStart;
      const safeStartDate = new Date(safeStart);
      const safeEndDate = new Date(safeStartDate);
      safeEndDate.setDate(safeStartDate.getDate() + 6);
      const weekNum = getISOWeekNumber(safeStartDate);
      onChange({
        type: 'week',
        startDate: safeStart,
        endDate: formatDateYYYYMMDD(safeEndDate),
        weekNumber: weekNum,
        label: `${formatDateDDMMYYYY(safeStartDate)} to ${formatDateDDMMYYYY(safeEndDate)} (WEEK - ${weekNum})`,
      });
    } else if (activeTab === 'month') {
      // Prevent applying a future month
      let safeStart = tempStart;
      let safeEnd = tempEnd;
      if (
        sDate.getFullYear() > currentYear ||
        (sDate.getFullYear() === currentYear && sDate.getMonth() > currentMonth)
      ) {
        const curFirst = new Date(currentYear, currentMonth, 1);
        const curLast = new Date(currentYear, currentMonth + 1, 0);
        safeStart = formatDateYYYYMMDD(curFirst);
        safeEnd = formatDateYYYYMMDD(curLast);
      }
      const safeMonthDate = new Date(safeStart);
      onChange({
        type: 'month',
        startDate: safeStart,
        endDate: safeEnd,
        label: `${MONTH_NAMES_SHORT[safeMonthDate.getMonth()]} ${safeMonthDate.getFullYear()}`,
      });
    } else {
      // Prevent applying future dates in range
      const safeStart = tempStart > todayIso ? todayIso : tempStart;
      const safeEnd = tempEnd > todayIso ? todayIso : tempEnd;
      const s = new Date(safeStart);
      const e = new Date(safeEnd);
      onChange({
        type: 'range',
        startDate: safeStart,
        endDate: safeEnd,
        label: `${formatDateDDMMYYYY(s)} to ${formatDateDDMMYYYY(e)}`,
      });
    }
    setIsOpen(false);
  };

  // Quick helper: Set current week
  const handleSetCurrentWeek = () => {
    selectWeekForDate(now);
    setViewYear(currentYear);
    setViewMonth(currentMonth);
  };

  // Quick helper: Set current month
  const handleSetCurrentMonth = () => {
    const first = new Date(currentYear, currentMonth, 1);
    const last = new Date(currentYear, currentMonth + 1, 0);
    setTempStart(formatDateYYYYMMDD(first));
    setTempEnd(formatDateYYYYMMDD(last));
    setViewYear(currentYear);
    setViewMonth(currentMonth);
  };

  const isDateSelectedInWeek = (isoString: string) => {
    return isoString >= tempStart && isoString <= tempEnd;
  };

  const isMonthSelected = (monthIndex: number, year: number) => {
    const sDate = new Date(tempStart);
    return sDate.getFullYear() === year && sDate.getMonth() === monthIndex;
  };

  // Popover calendar navigation boundary checks
  const isNextMonthNavDisabled =
    viewYear > currentYear || (viewYear === currentYear && viewMonth >= currentMonth);
  const isNextYearNavDisabled = viewYear >= currentYear;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Modern Filter Stepper Bar (Theme Sky Color) */}
      <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-2 py-1.5 shadow-xs text-xs font-semibold select-none hover:border-[#34c4f2]/60 transition-colors">
        {/* Step Prev Button */}
        <button
          type="button"
          onClick={() => handleStep('prev')}
          aria-label="Previous Period"
          className="p-1 rounded-lg hover:bg-[#34c4f2]/10 text-[#1689aa] dark:text-[#34c4f2] hover:text-[#126e88] dark:hover:text-[#67d5f6] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Trigger Popover Button */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 px-2.5 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer"
        >
          <div className="p-1 rounded-md bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2]">
            <Calendar className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold tracking-tight text-zinc-900 dark:text-white">
            {value.label}
          </span>
        </button>

        {/* Step Next Button (Disabled if currently at present period) */}
        <button
          type="button"
          onClick={() => handleStep('next')}
          disabled={isNextDisabledOnMainBar}
          aria-label="Next Period"
          className={`p-1 rounded-lg transition-colors ${
            isNextDisabledOnMainBar
              ? 'opacity-30 cursor-not-allowed text-zinc-400'
              : 'hover:bg-[#34c4f2]/10 text-[#1689aa] dark:text-[#34c4f2] hover:text-[#126e88] dark:hover:text-[#67d5f6] cursor-pointer'
          }`}
          title={isNextDisabledOnMainBar ? 'Future dates are not selectable' : 'Next Period'}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Popover Modal (Week / Month / Range Tabs) */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl shadow-zinc-900/10 dark:shadow-black/60 p-4 w-[340px] sm:w-[380px] text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
          {/* Top Tabs (Week, Month, Range) */}
          <div className="flex items-center justify-around border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-3 text-xs font-semibold">
            {(['week', 'month', 'range'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === 'week') handleSetCurrentWeek();
                  else if (tab === 'month') handleSetCurrentMonth();
                }}
                className={`px-3 py-1.5 capitalize transition-all relative cursor-pointer ${
                  activeTab === tab
                    ? 'text-[#1689aa] dark:text-[#34c4f2] font-bold border-b-2 border-[#34c4f2]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab 1: Week Selector */}
          {activeTab === 'week' && (
            <div className="space-y-3">
              {/* Month & Year Navigation Header */}
              <div className="flex items-center justify-between px-2 text-xs font-bold text-zinc-800 dark:text-zinc-100">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewYear((y) => y - 1)}
                    className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-white rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Previous Year"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (viewMonth === 0) {
                        setViewMonth(11);
                        setViewYear((y) => y - 1);
                      } else {
                        setViewMonth((m) => m - 1);
                      }
                    }}
                    className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-white rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Previous Month"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>

                <span className="font-bold text-sm">
                  {MONTH_NAMES_SHORT[viewMonth]} {viewYear}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isNextMonthNavDisabled}
                    onClick={() => {
                      if (isNextMonthNavDisabled) return;
                      if (viewMonth === 11) {
                        setViewMonth(0);
                        setViewYear((y) => y + 1);
                      } else {
                        setViewMonth((m) => m + 1);
                      }
                    }}
                    className={`p-1 rounded ${
                      isNextMonthNavDisabled
                        ? 'opacity-30 cursor-not-allowed text-zinc-300 dark:text-zinc-600'
                        : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                    }`}
                    title={isNextMonthNavDisabled ? 'Future months not allowed' : 'Next Month'}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isNextYearNavDisabled}
                    onClick={() => {
                      if (isNextYearNavDisabled) return;
                      setViewYear((y) => y + 1);
                    }}
                    className={`p-1 rounded ${
                      isNextYearNavDisabled
                        ? 'opacity-30 cursor-not-allowed text-zinc-300 dark:text-zinc-600'
                        : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                    }`}
                    title={isNextYearNavDisabled ? 'Future years not allowed' : 'Next Year'}
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Days Table */}
              <div className="text-[11px]">
                {/* Header: Week# + Days of week */}
                <div className="grid grid-cols-8 gap-1 text-center font-bold text-zinc-400 pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-400">Wk</div>
                  {DAY_NAMES_HEADER.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>

                {/* Weeks Rows */}
                <div className="mt-1 space-y-1">
                  {getCalendarWeeks(viewYear, viewMonth).map((week) => {
                    const isWeekSelected = week.days.some((d) => isDateSelectedInWeek(d.isoString));
                    const isFutureWeek = week.days[0].isoString > currentMondayIso;

                    return (
                      <button
                        key={week.weekNumber}
                        type="button"
                        disabled={isFutureWeek}
                        onClick={() => {
                          if (isFutureWeek) return;
                          selectWeekForDate(week.days[0].date);
                        }}
                        className={`w-full grid grid-cols-8 gap-1 py-1 px-0.5 rounded-xl transition-colors ${
                          isFutureWeek
                            ? 'opacity-30 cursor-not-allowed pointer-events-none'
                            : isWeekSelected
                            ? 'bg-[#34c4f2]/15 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#67d5f6] ring-1 ring-[#34c4f2]/50 cursor-pointer'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer'
                        }`}
                        title={isFutureWeek ? 'Future weeks are not selectable' : undefined}
                      >
                        <div className="text-[10px] font-semibold text-zinc-400 flex items-center justify-center">
                          {week.weekNumber}
                        </div>
                        {week.days.map((day) => {
                          const isSel = isDateSelectedInWeek(day.isoString);
                          const isFutureDay = day.isoString > todayIso;
                          return (
                            <div
                              key={day.isoString}
                              className={`h-6 flex items-center justify-center rounded-full text-xs font-semibold ${
                                isFutureWeek
                                  ? 'text-zinc-300 dark:text-zinc-700'
                                  : isSel
                                  ? 'bg-[#34c4f2] text-zinc-900 font-black shadow-xs'
                                  : day.isCurrentMonth
                                  ? isFutureDay
                                    ? 'text-zinc-400 dark:text-zinc-500'
                                    : 'text-zinc-800 dark:text-zinc-200'
                                  : 'text-zinc-300 dark:text-zinc-600'
                              }`}
                            >
                              {day.dayOfMonth}
                            </div>
                          );
                        })}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={handleSetCurrentWeek}
                  className="text-[#1689aa] dark:text-[#34c4f2] hover:underline font-semibold cursor-pointer"
                >
                  Current Week
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApply}
                    className="px-4 py-1.5 rounded-xl bg-[#34c4f2] hover:bg-[#2eb0db] text-zinc-900 font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Month Selector */}
          {activeTab === 'month' && (
            <div className="space-y-4">
              {/* Year Navigation Header */}
              <div className="flex items-center justify-between px-4 text-xs font-bold text-zinc-800 dark:text-zinc-100">
                <button
                  type="button"
                  onClick={() => setViewYear((y) => y - 1)}
                  className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-white rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  title="Previous Year"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold">{viewYear}</span>
                <button
                  type="button"
                  disabled={isNextYearNavDisabled}
                  onClick={() => {
                    if (isNextYearNavDisabled) return;
                    setViewYear((y) => y + 1);
                  }}
                  className={`p-1 rounded ${
                    isNextYearNavDisabled
                      ? 'opacity-30 cursor-not-allowed text-zinc-300 dark:text-zinc-600'
                      : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                  }`}
                  title={isNextYearNavDisabled ? 'Future years not allowed' : 'Next Year'}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* 12-Month Grid (4 cols x 3 rows) */}
              <div className="grid grid-cols-4 gap-2.5 py-2">
                {MONTH_NAMES_SHORT.map((mName, mIdx) => {
                  const isSelected = isMonthSelected(mIdx, viewYear);
                  const isFutureMonth =
                    viewYear > currentYear || (viewYear === currentYear && mIdx > currentMonth);

                  return (
                    <button
                      key={mName}
                      type="button"
                      disabled={isFutureMonth}
                      onClick={() => {
                        if (isFutureMonth) return;
                        const first = new Date(viewYear, mIdx, 1);
                        const last = new Date(viewYear, mIdx + 1, 0);
                        setTempStart(formatDateYYYYMMDD(first));
                        setTempEnd(formatDateYYYYMMDD(last));
                      }}
                      className={`h-10 rounded-full text-xs font-semibold flex items-center justify-center transition-all ${
                        isFutureMonth
                          ? 'opacity-25 cursor-not-allowed pointer-events-none text-zinc-300 dark:text-zinc-600'
                          : isSelected
                          ? 'bg-[#34c4f2] text-zinc-900 font-black shadow-md shadow-[#34c4f2]/30 ring-2 ring-[#34c4f2]/40 scale-105 cursor-pointer'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                      }`}
                      title={isFutureMonth ? 'Future months not selectable' : undefined}
                    >
                      {mName}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={handleSetCurrentMonth}
                  className="text-[#1689aa] dark:text-[#34c4f2] hover:underline font-semibold cursor-pointer"
                >
                  Current Month
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApply}
                    className="px-4 py-1.5 rounded-xl bg-[#34c4f2] hover:bg-[#2eb0db] text-zinc-900 font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Custom Date Range Selector */}
          {activeTab === 'range' && (
            <div className="space-y-3">
              {/* Range Navigation Header */}
              <div className="flex items-center justify-between px-2 text-xs font-bold text-zinc-800 dark:text-zinc-100">
                <button
                  type="button"
                  onClick={() => {
                    if (viewMonth === 0) {
                      setViewMonth(11);
                      setViewYear((y) => y - 1);
                    } else {
                      setViewMonth((m) => m - 1);
                    }
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-white rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-bold text-sm">
                  {MONTH_NAMES_SHORT[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  disabled={isNextMonthNavDisabled}
                  onClick={() => {
                    if (isNextMonthNavDisabled) return;
                    if (viewMonth === 11) {
                      setViewMonth(0);
                      setViewYear((y) => y + 1);
                    } else {
                      setViewMonth((m) => m + 1);
                    }
                  }}
                  className={`p-1 rounded ${
                    isNextMonthNavDisabled
                      ? 'opacity-30 cursor-not-allowed text-zinc-300 dark:text-zinc-600'
                      : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                  }`}
                  title={isNextMonthNavDisabled ? 'Future months not allowed' : 'Next Month'}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Days Table */}
              <div className="text-[11px]">
                <div className="grid grid-cols-7 gap-1 text-center font-bold text-zinc-400 pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
                  {DAY_NAMES_HEADER.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>

                <div className="mt-1 space-y-1">
                  {getCalendarWeeks(viewYear, viewMonth).map((week) => (
                    <div key={week.weekNumber} className="grid grid-cols-7 gap-1">
                      {week.days.map((day) => {
                        const isStart = day.isoString === tempStart;
                        const isEnd = day.isoString === tempEnd;
                        const inBetween = day.isoString > tempStart && day.isoString < tempEnd;
                        const isFutureDay = day.isoString > todayIso;

                        return (
                          <button
                            key={day.isoString}
                            type="button"
                            disabled={isFutureDay}
                            onClick={() => {
                              if (isFutureDay) return;
                              if (tempStart && tempEnd && tempStart !== tempEnd) {
                                setTempStart(day.isoString);
                                setTempEnd(day.isoString);
                              } else if (!tempStart || day.isoString < tempStart) {
                                setTempStart(day.isoString);
                                setTempEnd(day.isoString);
                              } else {
                                setTempEnd(day.isoString);
                              }
                            }}
                            className={`h-7 flex items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                              isFutureDay
                                ? 'opacity-25 cursor-not-allowed pointer-events-none text-zinc-300 dark:text-zinc-600'
                                : isStart || isEnd
                                ? 'bg-[#34c4f2] text-zinc-900 font-black shadow-xs cursor-pointer'
                                : inBetween
                                ? 'bg-[#34c4f2]/15 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#67d5f6] cursor-pointer'
                                : day.isCurrentMonth
                                ? 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                                : 'text-zinc-300 dark:text-zinc-600'
                            }`}
                            title={isFutureDay ? 'Future dates are not selectable' : undefined}
                          >
                            {day.dayOfMonth}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Range Display */}
              <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
                <span>Start: <strong className="text-zinc-900 dark:text-zinc-100">{formatDateDDMMYYYY(tempStart) || 'Select'}</strong></span>
                <span>End: <strong className="text-zinc-900 dark:text-zinc-100">{formatDateDDMMYYYY(tempEnd) || 'Select'}</strong></span>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={handleSetCurrentMonth}
                  className="text-[#1689aa] dark:text-[#34c4f2] hover:underline font-semibold cursor-pointer"
                >
                  Current Month
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApply}
                    className="px-4 py-1.5 rounded-xl bg-[#34c4f2] hover:bg-[#2eb0db] text-zinc-900 font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
