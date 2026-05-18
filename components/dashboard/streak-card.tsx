'use client'

import React from 'react'
import { Flame } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface StreakCardProps {
  currentStreak: number
  longestStreak: number
  lastActivityDate?: string
}

export function StreakCard({ currentStreak, longestStreak, lastActivityDate }: StreakCardProps) {
  // Generate 7-day activity dots
  const days = []
  const today = new Date()

  for (let i = 6; i >= 0; i--) {
    const date = new Date()
    date.setDate(today.getDate() - i)
    const dateString = date.toISOString().split('T')[0]

    // We don't actually have the full activity log here, but for the UI
    // we can simulate dots or the parent can pass activity dates.
    // For now, we'll just show the current streak filling from the right.
    const isActive = i < currentStreak
    days.push({ date: dateString, active: isActive })
  }

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
            <Flame className="w-6 h-6 text-orange-500" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Learning Streak</h3>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{currentStreak} Days</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Best</p>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{longestStreak}</p>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2">
        {days.map((day, idx) => (
          <div key={idx} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "w-3 h-3 rounded-full transition-colors",
                day.active
                  ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"
                  : "bg-zinc-200 dark:bg-zinc-700"
              )}
            />
            <span className="text-[10px] text-zinc-400 uppercase font-medium">
              {day.date.split('-')[2]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
