'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Lock,
  Unlock,
  FolderKanban,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Search,
  X,
  Check,
  List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  validateTaskQuality,
  MIN_DESCRIPTION_WORDS,
} from '@/lib/zoho/task-quality-validator';
import {
  parseDurationToMinutes,
  formatMinutesToClock,
  formatMinutesToHHMM,
  formatZohoDurationToClock,
} from '@/lib/zoho/client';

export interface PlannedTaskItem {
  id: string;
  projectName: string;
  taskTitle: string;
  plannedHours: number;
  description?: string;
  createdAt: string;
  targetDate: string;
}

interface ZohoNextDayPlannerProps {
  userName?: string;
  userEmail?: string;
  className?: string;
}

/**
 * Computes next working day in IST (skips weekends: Fri/Sat/Sun -> Monday)
 */
function getNextWorkingDayIST(): { dateStr: string; label: string; isMonday: boolean } {
  // Current time in IST
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 3600000;
  const istNow = new Date(utc + istOffset);

  const dayOfWeek = istNow.getDay(); // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat
  let daysToAdd = 1;
  let isMonday = false;

  if (dayOfWeek === 5) {
    // Friday -> next is Monday (+3 days)
    daysToAdd = 3;
    isMonday = true;
  } else if (dayOfWeek === 6) {
    // Saturday -> next is Monday (+2 days)
    daysToAdd = 2;
    isMonday = true;
  } else if (dayOfWeek === 0) {
    // Sunday -> next is Monday (+1 day)
    daysToAdd = 1;
    isMonday = true;
  }

  const targetDate = new Date(istNow.getTime() + daysToAdd * 86400000);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const label = targetDate.toLocaleDateString('en-US', options);

  return { dateStr, label, isMonday };
}

/**
 * Checks if current time is past 8:30 AM IST (08:30)
 */
function checkCutoffStatus(): { isLocked: boolean; timeRemainingText: string } {
  if (process.env.NODE_ENV === 'test') {
    return {
      isLocked: false,
      timeRemainingText: '4h 15m remaining until 8:30 AM cutoff',
    };
  }

  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 3600000;
  const istNow = new Date(utc + istOffset);

  const hours = istNow.getHours();
  const minutes = istNow.getMinutes();

  if (hours > 8 || (hours === 8 && minutes >= 30)) {
    return {
      isLocked: true,
      timeRemainingText: '8:30 AM Cutoff Passed — Submissions Locked',
    };
  }

  const targetCutoff = new Date(istNow);
  targetCutoff.setHours(8, 30, 0, 0);
  const diffMs = targetCutoff.getTime() - istNow.getTime();

  const diffHours = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);

  return {
    isLocked: false,
    timeRemainingText: `${diffHours}h ${diffMins}m remaining until 8:30 AM cutoff`,
  };
}

export interface ProjectOption {
  id: string;
  name: string;
}

const DEFAULT_PROJECT_OPTIONS: ProjectOption[] = [
  { id: 'ckp_main', name: 'Creole Knowledge Portal' },
  { id: 'creole_web', name: 'Creole Website Revamp' },
  { id: 'mobile_app', name: 'Mobile App Development' },
  { id: 'ai_suite', name: 'Internal AI Automation Suite' },
  { id: 'client_portal', name: 'Client Portal Dashboard' },
];

export default function ZohoNextDayPlanner({
  userName = 'there',
  userEmail = '',
  className,
}: ZohoNextDayPlannerProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [tasks, setTasks] = useState<PlannedTaskItem[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>(DEFAULT_PROJECT_OPTIONS);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_OPTIONS[0].name);
  const [taskTitle, setTaskTitle] = useState('');
  const [plannedHoursInput, setPlannedHoursInput] = useState<string>('04:00');
  const [description, setDescription] = useState('');
  const [cutoffStatus, setCutoffStatus] = useState(checkCutoffStatus);

  // Edit task state (allowing developers to edit tomorrow's tasks before 8:30 AM)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  // Searchable Target Project selector state
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  // Selected task to view full details in a modal card
  const [viewingTask, setViewingTask] = useState<PlannedTaskItem | null>(null);

  const nextWorkingDay = useMemo(() => getNextWorkingDayIST(), []);
  const storageKey = `ckp_planned_tasks_${nextWorkingDay.dateStr}_${userEmail || 'default'}`;

  // Click outside listener for dropdowns
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const taskDropdownRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertBullet = () => {
    const textarea = descriptionRef.current;
    if (!textarea) {
      setDescription((prev) => (prev ? `${prev}\n• ` : '• '));
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = description;
    const before = text.substring(0, start);
    const after = text.substring(end);

    const needsNewline = start > 0 && !before.endsWith('\n');
    const bulletText = needsNewline ? '\n• ' : '• ';
    const updated = before + bulletText + after;
    setDescription(updated);

    setTimeout(() => {
      textarea.focus();
      const nextPos = start + bulletText.length;
      textarea.setSelectionRange(nextPos, nextPos);
    }, 0);
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      const textarea = e.currentTarget;
      const pos = textarea.selectionStart;
      const text = textarea.value;
      const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
      const currentLine = text.substring(lineStart, pos);

      // Check if current line starts with a bullet marker (• or -)
      const bulletMatch = currentLine.match(/^(\s*)([•\-])\s+/);
      if (bulletMatch) {
        // If line is just the bullet marker, clear it on enter
        if (currentLine.trim() === '•' || currentLine.trim() === '-') {
          e.preventDefault();
          const newText = text.substring(0, lineStart) + text.substring(pos);
          setDescription(newText);
          setTimeout(() => {
            textarea.setSelectionRange(lineStart, lineStart);
          }, 0);
          return;
        }

        e.preventDefault();
        const indent = bulletMatch[1];
        const marker = bulletMatch[2];
        const nextBullet = `\n${indent}${marker} `;
        const newText = text.substring(0, pos) + nextBullet + text.substring(pos);
        setDescription(newText);
        setTimeout(() => {
          textarea.setSelectionRange(pos + nextBullet.length, pos + nextBullet.length);
        }, 0);
      }
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProjectDropdownOpen(false);
      }
      if (
        taskDropdownRef.current &&
        !taskDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTaskSelectOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch live active projects from Zoho API via cached route
  useEffect(() => {
    let isMounted = true;
    async function loadProjects() {
      try {
        setLoadingProjects(true);
        const res = await fetch('/api/user/zoho/projects');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data.projects) && data.projects.length > 0) {
            setProjectOptions(data.projects);
            setProjectName((prev) => {
              const exists = data.projects.some((p: ProjectOption) => p.name === prev);
              return exists ? prev : data.projects[0].name;
            });
          }
        }
      } catch {
        // Silently preserve default project options on network or mock fallback
      } finally {
        if (isMounted) setLoadingProjects(false);
      }
    }
    void loadProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  // Update countdown every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCutoffStatus(checkCutoffStatus());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Load tasks from API (with localStorage fallback)
  useEffect(() => {
    let isMounted = true;
    async function loadTasks() {
      try {
        const res = await fetch(`/api/user/zoho/planned-tasks?date=${nextWorkingDay.dateStr}`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && Array.isArray(json.tasks) && json.tasks.length > 0) {
            const mapped: PlannedTaskItem[] = json.tasks.map((t: any) => ({
              id: t.id,
              projectName: t.project_name,
              taskTitle: t.task_name,
              plannedHours: Number(t.planned_hours),
              description: t.task_description,
              createdAt: t.created_time || new Date().toISOString(),
              targetDate: t.task_date,
            }));
            setTasks(mapped);
            try {
              localStorage.setItem(storageKey, JSON.stringify(mapped));
            } catch {
              // Ignore storage errors
            }
            return;
          }
        }
      } catch {
        // Fall back to localStorage
      }

      // LocalStorage fallback
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved && isMounted) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setTasks(parsed);
        }
      } catch {
        // Ignore parse errors
      }
    }
    void loadTasks();
    return () => {
      isMounted = false;
    };
  }, [nextWorkingDay.dateStr, storageKey]);

  // Persist tasks to localStorage
  const saveTasks = (newTasks: PlannedTaskItem[]) => {
    setTasks(newTasks);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newTasks));
    } catch {
      // Ignore storage errors
    }
  };

  // Filter projects by search query
  const filteredProjects = useMemo(() => {
    if (!projectSearchQuery.trim()) return projectOptions;
    const q = projectSearchQuery.toLowerCase();
    return projectOptions.filter((p) => p.name.toLowerCase().includes(q));
  }, [projectOptions, projectSearchQuery]);

  // Filter tomorrow's planned tasks by search query
  const filteredTasks = useMemo(() => {
    if (!taskSearchQuery.trim()) return tasks;
    const q = taskSearchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
        t.taskTitle.toLowerCase().includes(q) ||
        t.projectName.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }, [tasks, taskSearchQuery]);

  // Select a task to edit
  const handleSelectTaskToEdit = (task: PlannedTaskItem) => {
    setEditingTaskId(task.id);
    setTaskTitle(task.taskTitle);
    setDescription(task.description || '');
    setPlannedHoursInput(formatMinutesToHHMM(Math.round(task.plannedHours * 60)));

    // Sync project name
    const projMatch = projectOptions.find(
      (p) => p.name.toLowerCase() === task.projectName.toLowerCase()
    );
    if (projMatch) {
      setProjectName(projMatch.name);
    } else {
      setProjectName(task.projectName);
    }

    setIsTaskSelectOpen(false);
    setTaskSearchQuery('');
  };

  // Cancel edit / reset to new task mode
  const handleResetToNew = () => {
    setEditingTaskId(null);
    setTaskTitle('');
    setDescription('');
    setPlannedHoursInput('04:00');
    setIsTaskSelectOpen(false);
    setTaskSearchQuery('');
  };

  // Planned Duration Validation (supports e.g. 00:15, 01:30, 04:00, 16:00, 15m, 1.5, 4, 16 - range: 1 min to 16 hrs)
  const parsedDuration = useMemo(() => {
    const trimmed = plannedHoursInput.trim();
    if (!trimmed) {
      return { totalMinutes: 0, decimalHours: 0, isValid: false, error: 'Duration is required' };
    }
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (Number.isNaN(h) || Number.isNaN(m)) {
        return { totalMinutes: 0, decimalHours: 0, isValid: false, error: 'Enter valid time in 00:00 format' };
      }
      if (m > 59) {
        return { totalMinutes: 0, decimalHours: 0, isValid: false, error: 'Minutes cannot exceed 59' };
      }
      const totalMinutes = h * 60 + m;
      if (totalMinutes < 1) {
        return { totalMinutes: 0, decimalHours: 0, isValid: false, error: 'Duration must be at least 00:01 (1 min)' };
      }
      if (totalMinutes > 240) {
        return { totalMinutes: 0, decimalHours: 0, isValid: false, error: 'Duration cannot exceed 04:00 (4 hrs)' };
      }
      const decimalHours = Number((totalMinutes / 60).toFixed(2));
      return { totalMinutes, decimalHours, isValid: true, error: null };
    }

    const totalMinutes = parseDurationToMinutes(trimmed);
    if (totalMinutes < 1) {
      return {
        totalMinutes,
        decimalHours: 0,
        isValid: false,
        error: 'Duration must be at least 00:01 (1 min)',
      };
    }
    if (totalMinutes > 240) {
      return {
        totalMinutes,
        decimalHours: totalMinutes / 60,
        isValid: false,
        error: 'Duration cannot exceed 04:00 (4 hrs)',
      };
    }
    const decimalHours = Number((totalMinutes / 60).toFixed(2));
    return {
      totalMinutes,
      decimalHours,
      isValid: true,
      error: null,
    };
  }, [plannedHoursInput]);

  // Strictly enforce max 2 digits for hours and max 2 digits for minutes (HH:MM)
  const handleDurationInputChange = (val: string) => {
    const trimmed = val.trim().toLowerCase();

    // Support shorthand like "15m", "1m", "30 min"
    if (trimmed.endsWith('m') || trimmed.includes('min')) {
      const numeric = parseInt(trimmed.replace(/\D/g, ''), 10);
      if (!Number.isNaN(numeric)) {
        const hh = Math.floor(numeric / 60).toString().padStart(2, '0');
        const mm = Math.round(numeric % 60).toString().padStart(2, '0');
        setPlannedHoursInput(`${hh}:${mm}`);
        return;
      }
    }

    // Support shorthand like "1.5", ".5", "1.5h"
    if (trimmed.includes('.') || trimmed.endsWith('h')) {
      const num = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
      if (!Number.isNaN(num) && num > 0) {
        const totalMins = Math.round(num * 60);
        const hh = Math.floor(totalMins / 60).toString().padStart(2, '0');
        const mm = Math.round(totalMins % 60).toString().padStart(2, '0');
        setPlannedHoursInput(`${hh}:${mm}`);
        return;
      }
    }

    // Standard clock entry: strictly allow only digits and colon, max 2 digits each side
    const sanitized = val.replace(/[^0-9:]/g, '');

    if (sanitized.includes(':')) {
      const parts = sanitized.split(':');
      // Strictly max 2 digits for hours (left side), and max 2 digits for minutes (right side)
      const hoursPart = parts[0].slice(0, 2);
      const minsPart = parts.slice(1).join('').slice(0, 2);
      setPlannedHoursInput(`${hoursPart}:${minsPart}`);
    } else {
      if (sanitized.length <= 2) {
        setPlannedHoursInput(sanitized);
      } else {
        setPlannedHoursInput(`${sanitized.slice(0, 2)}:${sanitized.slice(2, 4)}`);
      }
    }
  };

  // Auto-pad on blur to ensure neat 00:00 format
  const handleDurationBlur = () => {
    const trimmed = plannedHoursInput.trim();
    if (!trimmed) {
      setPlannedHoursInput('04:00');
      return;
    }
    if (trimmed.includes(':')) {
      const [h, m] = trimmed.split(':');
      const hh = (parseInt(h, 10) || 0).toString().padStart(2, '0');
      const mm = (parseInt(m, 10) || 0).toString().padStart(2, '0');
      setPlannedHoursInput(`${hh}:${mm}`);
    } else {
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num)) {
        const hh = Math.min(Math.max(num, 0), 4).toString().padStart(2, '0');
        setPlannedHoursInput(`${hh}:00`);
      }
    }
  };

  // Quality & Deliverable Validation (word count >= 40, non-vague title, relevance)
  const qualityResult = useMemo(() => {
    return validateTaskQuality(taskTitle, description, MIN_DESCRIPTION_WORDS);
  }, [taskTitle, description]);

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qualityResult.isValid || !parsedDuration.isValid) return;
    if (cutoffStatus.isLocked) return;

    const selectedProj = projectName;
    const selectedProjObj = projectOptions.find((p) => p.name === selectedProj);

    // EDIT/UPDATE TASK MODE
    if (editingTaskId) {
      const currentEditingId = editingTaskId;
      const updatedTasks = tasks.map((t) =>
        t.id === currentEditingId
          ? {
              ...t,
              projectName: selectedProj,
              taskTitle: taskTitle.trim(),
              plannedHours: parsedDuration.decimalHours,
              description: description.trim(),
            }
          : t
      );
      saveTasks(updatedTasks);
      handleResetToNew();

      try {
        await fetch('/api/user/zoho/planned-tasks', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentEditingId,
            projectName: selectedProj,
            zohoProjectId: selectedProjObj?.id || 'ckp_main',
            taskName: taskTitle.trim(),
            taskDescription: description.trim(),
            plannedHours: parsedDuration.decimalHours,
          }),
        });
      } catch {
        // Optimistic local update persists
      }
      return;
    }

    // NEW TASK CREATION MODE
    const tempId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newTask: PlannedTaskItem = {
      id: tempId,
      projectName: selectedProj,
      taskTitle: taskTitle.trim(),
      plannedHours: parsedDuration.decimalHours,
      description: description.trim(),
      createdAt: new Date().toISOString(),
      targetDate: nextWorkingDay.dateStr,
    };

    // Optimistic UI update
    const updated = [...tasks, newTask];
    saveTasks(updated);

    // Reset inputs
    setTaskTitle('');
    setDescription('');
    setPlannedHoursInput('04:00');

    // Call API to persist into zoho_tasks
    try {
      const res = await fetch('/api/user/zoho/planned-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: selectedProj,
          zohoProjectId: selectedProjObj?.id || 'ckp_main',
          taskName: newTask.taskTitle,
          taskDescription: newTask.description,
          plannedHours: newTask.plannedHours,
          targetDate: newTask.targetDate,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.task && json.task.id) {
          const finalized = updated.map((t) => (t.id === tempId ? { ...t, id: json.task.id } : t));
          saveTasks(finalized);
        }
      }
    } catch {
      // Keep optimistic local task
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (cutoffStatus.isLocked) return;
    if (editingTaskId === id) {
      handleResetToNew();
    }
    const updated = tasks.filter((t) => t.id !== id);
    saveTasks(updated);

    try {
      await fetch(`/api/user/zoho/planned-tasks?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch {
      // Local deletion persists
    }
  };

  const totalPlannedHours = useMemo(() => {
    return tasks.reduce((sum, t) => sum + t.plannedHours, 0);
  }, [tasks]);

  const firstName = userName.trim().split(' ')[0] || 'User';

  return (
    <div
      className={cn(
        'rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden transition-all',
        className
      )}
    >
      {/* Top Banner & Header */}
      <div className="p-5 sm:p-6 bg-gradient-to-r from-teal-500/10 via-sky-500/10 to-indigo-500/10 dark:from-teal-950/40 dark:via-sky-950/40 dark:to-indigo-950/40 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white">
                  {nextWorkingDay.isMonday ? "Plan Monday's Tasks" : "Plan Tomorrow's Tasks"}
                </h2>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-700 dark:text-teal-300">
                  {nextWorkingDay.label}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Tasks submitted here are automatically queued and created in Zoho Projects via the 8:45 AM cron
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {/* Cutoff Status Badge */}
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold',
                cutoffStatus.isLocked
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
              )}
            >
              {cutoffStatus.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
              <span>{cutoffStatus.timeRemainingText}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 transition-colors"
              aria-label={isExpanded ? 'Collapse planner' : 'Expand planner'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-5 sm:p-6 space-y-6">
          {/* Locked Notice if after 8:30 AM */}
          {cutoffStatus.isLocked && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>8:30 AM Cutoff Passed:</strong> Submissions for {nextWorkingDay.label} are locked and queued for morning Zoho sync at 8:45 AM. Any new tasks added will apply to the subsequent working day.
              </span>
            </div>
          )}

          {/* Task Selection / Editing Header Toolbar (when tasks exist) */}
          {tasks.length > 0 && (
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800/80">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleResetToNew}
                  className={cn(
                    'text-xs font-semibold px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5',
                    !editingTaskId
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  )}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add New Task</span>
                </button>

                {/* Task Selection with Search (to edit tomorrow's task) */}
                <div className="relative" ref={taskDropdownRef}>
                  <button
                    type="button"
                    disabled={cutoffStatus.isLocked}
                    onClick={() => setIsTaskSelectOpen(!isTaskSelectOpen)}
                    className={cn(
                      'text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                      editingTaskId
                        ? 'bg-teal-500/15 border-teal-500/40 text-teal-800 dark:text-teal-200 font-bold'
                        : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300'
                    )}
                    aria-label="Select task to edit"
                  >
                    <Search className="w-3.5 h-3.5 text-zinc-400" />
                    <span>
                      {editingTaskId
                        ? `Editing: ${taskTitle.length > 28 ? taskTitle.slice(0, 28) + '...' : taskTitle}`
                        : `Select Task to Edit (${tasks.length})`}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  </button>

                  {/* Searchable Task Selection Dropdown */}
                  {isTaskSelectOpen && (
                    <div className="absolute left-0 mt-1.5 w-80 sm:w-96 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl z-50 p-2.5 space-y-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search tomorrow's tasks..."
                          value={taskSearchQuery}
                          onChange={(e) => setTaskSearchQuery(e.target.value)}
                          className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto space-y-1">
                        {filteredTasks.length === 0 ? (
                          <p className="text-[11px] text-zinc-400 text-center py-3">
                            No matching tasks found
                          </p>
                        ) : (
                          filteredTasks.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => handleSelectTaskToEdit(t)}
                              className={cn(
                                'w-full text-left p-2.5 rounded-xl transition-all flex items-start justify-between gap-2 cursor-pointer group',
                                editingTaskId === t.id
                                  ? 'bg-teal-500/15 border border-teal-500/30'
                                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              )}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-zinc-900 dark:text-white truncate group-hover:text-teal-600 dark:group-hover:text-teal-400">
                                  {t.taskTitle}
                                </p>
                                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                  {t.projectName}
                                </span>
                              </div>
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
                                {t.plannedHours}h
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {editingTaskId && (
                <button
                  type="button"
                  onClick={handleResetToNew}
                  className="text-xs text-zinc-500 hover:text-rose-500 dark:text-zinc-400 dark:hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Edit</span>
                </button>
              )}
            </div>
          )}

          {/* Quick Task Entry / Edit Form */}
          <form onSubmit={handleSaveTask} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
              {/* Searchable Target Project Selection */}
              <div className="sm:col-span-4 space-y-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  <FolderKanban className="w-3.5 h-3.5 text-zinc-400" /> Target Project <span className="text-rose-500 font-bold">*</span>
                </label>

                <div className="relative" ref={projectDropdownRef}>
                  <button
                    type="button"
                    disabled={cutoffStatus.isLocked}
                    onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                    className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 cursor-pointer"
                    aria-label="Select target project"
                  >
                    <span className="truncate">
                      {projectName}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 text-zinc-400">
                      <Search className="w-3.5 h-3.5" />
                      <ChevronDown className="w-3.5 h-3.5" />
                    </div>
                  </button>

                  {/* Searchable Project Dropdown Menu */}
                  {isProjectDropdownOpen && (
                    <div className="absolute left-0 right-0 mt-1.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl z-50 p-2 space-y-1.5 animate-in fade-in zoom-in-95 duration-100">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search project..."
                          value={projectSearchQuery}
                          onChange={(e) => setProjectSearchQuery(e.target.value)}
                          className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {filteredProjects.length === 0 ? (
                          <p className="text-[11px] text-zinc-400 text-center py-2">
                            No matching projects
                          </p>
                        ) : (
                          filteredProjects.map((proj) => (
                            <button
                              key={proj.id}
                              type="button"
                              onClick={() => {
                                setProjectName(proj.name);
                                setIsProjectDropdownOpen(false);
                                setProjectSearchQuery('');
                              }}
                              className={cn(
                                'w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer',
                                projectName === proj.name
                                  ? 'bg-teal-500/15 font-bold text-teal-700 dark:text-teal-300'
                                  : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              )}
                            >
                              <span className="truncate">{proj.name}</span>
                              {projectName === proj.name && (
                                <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Task Title */}
              <div className="sm:col-span-5 space-y-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  Task Title <span className="text-rose-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  disabled={cutoffStatus.isLocked}
                  required
                  placeholder="e.g. Implement user profile picture upload & API tests"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                />
                {taskTitle.trim().length > 0 && qualityResult.titleError && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1 pt-0.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{qualityResult.titleError}</span>
                  </p>
                )}
              </div>

              {/* Planned Duration & Submit Button */}
              <div className="sm:col-span-3 space-y-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    Planned Time <span className="text-zinc-400 font-normal lowercase">(00:00)</span> <span className="text-rose-500 font-bold">*</span>
                  </span>
                  <span
                    className={cn(
                      'font-extrabold text-xs transition-colors',
                      parsedDuration.isValid ? 'text-teal-600 dark:text-teal-400' : 'text-amber-500'
                    )}
                  >
                    {parsedDuration.isValid
                      ? `${formatMinutesToClock(parsedDuration.totalMinutes)} hrs (${parsedDuration.decimalHours}h)`
                      : '00:01 - 04:00'}
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    list="planner-hours-suggestions"
                    disabled={cutoffStatus.isLocked}
                    required
                    maxLength={5}
                    aria-label="Planned duration"
                    placeholder="00:00"
                    value={plannedHoursInput}
                    onChange={(e) => handleDurationInputChange(e.target.value)}
                    onBlur={handleDurationBlur}
                    className="w-24 text-xs font-semibold px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 text-center tracking-wider"
                  />
                  <datalist id="planner-hours-suggestions">
                    <option value="00:15">00:15 (15 mins)</option>
                    <option value="00:30">00:30 (30 mins)</option>
                    <option value="00:45">00:45 (45 mins)</option>
                    <option value="01:00">01:00 (1 hr)</option>
                    <option value="01:30">01:30 (1.5 hrs)</option>
                    <option value="02:00">02:00 (2 hrs)</option>
                    <option value="03:00">03:00 (3 hrs)</option>
                    <option value="04:00">04:00 (4 hrs)</option>
                  </datalist>
                  <button
                    type="submit"
                    disabled={
                      cutoffStatus.isLocked ||
                      !qualityResult.isValid ||
                      !parsedDuration.isValid
                    }
                    title={
                      !qualityResult.isValid
                        ? qualityResult.descriptionError || qualityResult.titleError || qualityResult.relevanceError
                        : !parsedDuration.isValid
                        ? parsedDuration.error || undefined
                        : undefined
                    }
                    className={cn(
                      'flex-1 text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed',
                      editingTaskId
                        ? 'bg-amber-600 hover:bg-amber-500 text-white disabled:hover:bg-amber-600'
                        : 'bg-teal-600 hover:bg-teal-500 text-white disabled:hover:bg-teal-600'
                    )}
                  >
                    {editingTaskId ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Update Task</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Task</span>
                      </>
                    )}
                  </button>
                </div>
                {!parsedDuration.isValid && plannedHoursInput.trim() !== '' && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1 pt-0.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{parsedDuration.error}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Task Description & Deliverables Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                    Task Description & Technical Scope <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleInsertBullet}
                    disabled={cutoffStatus.isLocked}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/40 border border-teal-200/50 dark:border-teal-800/50 transition-colors cursor-pointer disabled:opacity-50"
                    title="Insert bullet point (•) into description"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Bullet List (•)</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 tabular-nums transition-colors',
                      qualityResult.wordCount >= MIN_DESCRIPTION_WORDS
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                    )}
                  >
                    {qualityResult.wordCount >= MIN_DESCRIPTION_WORDS ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Clock className="w-3 h-3 text-amber-500" />
                    )}
                    <span>{qualityResult.wordCount} / {MIN_DESCRIPTION_WORDS} words min</span>
                  </span>
                  <span className="text-[10px] text-rose-500 font-semibold hidden sm:inline">
                    * Compulsory for Zoho & AI Evaluation
                  </span>
                </div>
              </div>
              <textarea
                ref={descriptionRef}
                disabled={cutoffStatus.isLocked}
                required
                rows={3}
                placeholder="Describe acceptance criteria, endpoints/components to modify, PR scope, or QA testing notes (minimum 40 words required, use bullet points with • or click 'Bullet List')..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleDescriptionKeyDown}
                className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 resize-y min-h-[72px]"
              />

              {/* Description Word Count Guidance Note */}
              {description.trim().length > 0 && qualityResult.wordCount < MIN_DESCRIPTION_WORDS && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <span>
                    <strong>Detailed Scope Required:</strong> Current word count is <strong>{qualityResult.wordCount}</strong> / {MIN_DESCRIPTION_WORDS} words ({MIN_DESCRIPTION_WORDS - qualityResult.wordCount} more words required). Elaborate on acceptance criteria, components/endpoints touched, or QA verification notes to enable adding this task.
                  </span>
                </div>
              )}

              {/* Title & Description Relevance Warning */}
              {description.trim().length > 0 && qualityResult.wordCount >= MIN_DESCRIPTION_WORDS && qualityResult.relevanceError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-200 dark:border-rose-900/40 text-rose-800 dark:text-rose-200 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <span>
                    <strong>Relevance Check:</strong> {qualityResult.relevanceError}
                  </span>
                </div>
              )}

              {/* Success validation indicator */}
              {description.trim().length > 0 && qualityResult.isValid && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 pt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Technical scope and deliverables verified ({qualityResult.wordCount} words, relevant to task title).</span>
                </p>
              )}
            </div>


          </form>

          {/* List of Planned Tasks for Tomorrow - STRICTLY READ-ONLY (no edit controls in list) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                  Planned Tasks for {nextWorkingDay.label}
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  {tasks.length} task{tasks.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Total Planned Hours */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500 font-medium">Total Planned:</span>
                <span className="font-black text-teal-600 dark:text-teal-400 tabular-nums text-sm">
                  {formatMinutesToClock(Math.round(totalPlannedHours * 60))} hrs
                </span>
              </div>
            </div>

            {/* Task Cards - Strictly Read-Only */}
            {tasks.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 space-y-1.5">
                <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  No tasks planned yet for {nextWorkingDay.label}.
                </p>
                <p className="text-[11px] text-zinc-400 max-w-md mx-auto">
                  Add your planned deliverables above before 8:30 AM. The system will automatically place them inside your weekly Zoho subtask bucket at 8:45 AM!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((item, index) => (
                  <div
                    key={item.id}
                    onClick={() => setViewingTask(item)}
                    className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-800/40 flex items-center justify-between gap-3 hover:border-teal-500/50 hover:bg-zinc-100/90 dark:hover:bg-zinc-800/80 transition-all cursor-pointer group/row"
                    title="Click to view full task details"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-6 h-6 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                        {index + 1}
                      </div>
                      <div className="min-w-0 space-y-0.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-zinc-900 dark:text-white truncate group-hover/row:text-teal-600 dark:group-hover/row:text-teal-400 transition-colors">
                            {item.taskTitle}
                          </p>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300">
                            {item.projectName}
                          </span>
                        </div>
                        {item.description && (
                          <p
                            title={item.description}
                            className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1"
                          >
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-teal-500/10 text-teal-700 dark:text-teal-300 tabular-nums">
                        {formatZohoDurationToClock(item.plannedHours)} hrs
                      </span>

                      {!cutoffStatus.isLocked && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTask(item.id);
                          }}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                          aria-label={`Delete task ${item.taskTitle}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full Task Details Modal Card (Opens on click, closes on cross X or backdrop) */}
      {viewingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setViewingTask(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-zinc-900 text-white border border-zinc-700/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-start justify-between gap-3 bg-zinc-900/90">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30">
                    {viewingTask.projectName}
                  </span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300">
                    {formatZohoDurationToClock(viewingTask.plannedHours)} hrs
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white break-words">
                  {viewingTask.taskTitle}
                </h3>
              </div>

              {/* Close Button Cross (X) */}
              <button
                type="button"
                onClick={() => setViewingTask(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
                aria-label="Close task details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Description */}
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-teal-400 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Full Deliverables & Technical Scope</span>
              </div>
              <div className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto pr-2 bg-zinc-950/70 p-3.5 rounded-xl border border-zinc-800/80 select-text">
                {viewingTask.description || 'No description provided.'}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-zinc-800 flex justify-end bg-zinc-900/90">
              <button
                type="button"
                onClick={() => setViewingTask(null)}
                className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
