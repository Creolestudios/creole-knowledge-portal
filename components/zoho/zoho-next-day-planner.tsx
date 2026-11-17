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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  validateTaskQuality,
  MIN_DESCRIPTION_WORDS,
} from '@/lib/zoho/task-quality-validator';

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
 * Checks if current time is past 10:00 PM IST (22:00)
 */
function checkCutoffStatus(): { isLocked: boolean; timeRemainingText: string } {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 3600000;
  const istNow = new Date(utc + istOffset);

  const hours = istNow.getHours();
  const minutes = istNow.getMinutes();

  if (hours >= 22) {
    return {
      isLocked: true,
      timeRemainingText: '10:00 PM Cutoff Passed — Submissions Locked',
    };
  }

  const targetCutoff = new Date(istNow);
  targetCutoff.setHours(22, 0, 0, 0);
  const diffMs = targetCutoff.getTime() - istNow.getTime();

  const diffHours = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);

  return {
    isLocked: false,
    timeRemainingText: `${diffHours}h ${diffMins}m remaining until 10:00 PM cutoff`,
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

const QUICK_HOURS = [1.0, 2.0, 3.0, 4.0, 6.0, 8.0];

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
  const [customProject, setCustomProject] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [plannedHours, setPlannedHours] = useState<number>(4.0);
  const [description, setDescription] = useState('');
  const [cutoffStatus, setCutoffStatus] = useState(checkCutoffStatus);

  // Edit task state (allowing developers to edit tomorrow's tasks before 10 PM)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isTaskSelectOpen, setIsTaskSelectOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  // Searchable Target Project selector state
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  const nextWorkingDay = useMemo(() => getNextWorkingDayIST(), []);
  const storageKey = `ckp_planned_tasks_${nextWorkingDay.dateStr}_${userEmail || 'default'}`;

  // Click outside listener for dropdowns
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const taskDropdownRef = useRef<HTMLDivElement>(null);

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
    setPlannedHours(task.plannedHours);

    // Sync project name
    const projMatch = projectOptions.find(
      (p) => p.name.toLowerCase() === task.projectName.toLowerCase()
    );
    if (projMatch) {
      setProjectName(projMatch.name);
    } else {
      setProjectName('__custom__');
      setCustomProject(task.projectName);
    }

    setIsTaskSelectOpen(false);
    setTaskSearchQuery('');
  };

  // Cancel edit / reset to new task mode
  const handleResetToNew = () => {
    setEditingTaskId(null);
    setTaskTitle('');
    setDescription('');
    setPlannedHours(4.0);
    setIsTaskSelectOpen(false);
    setTaskSearchQuery('');
  };

  // Quality & Deliverable Validation (word count >= 40, non-vague title, relevance)
  const qualityResult = useMemo(() => {
    return validateTaskQuality(taskTitle, description, MIN_DESCRIPTION_WORDS);
  }, [taskTitle, description]);

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qualityResult.isValid || plannedHours <= 0) return;
    if (projectName === '__custom__' && !customProject.trim()) return;
    if (cutoffStatus.isLocked) return;

    const selectedProj = projectName === '__custom__' ? customProject.trim() : projectName;
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
              plannedHours: Number(plannedHours.toFixed(1)),
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
            plannedHours: Number(plannedHours.toFixed(1)),
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
      plannedHours: Number(plannedHours.toFixed(1)),
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
    setPlannedHours(4.0);

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
                Tasks submitted here are automatically queued and created in Zoho Projects via the 10:00 PM cron
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
          {/* Locked Notice if after 10 PM */}
          {cutoffStatus.isLocked && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>10:00 PM Cutoff Passed:</strong> Submissions for {nextWorkingDay.label} are locked and queued for tonight&apos;s Zoho sync. Any new tasks added will apply to the subsequent working day.
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
                      {projectName === '__custom__'
                        ? customProject || '+ Enter Custom Project'
                        : projectName}
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
                        <button
                          type="button"
                          onClick={() => {
                            setProjectName('__custom__');
                            setIsProjectDropdownOpen(false);
                            setProjectSearchQuery('');
                          }}
                          className={cn(
                            'w-full text-left px-2.5 py-1.5 rounded-lg text-xs border-t border-zinc-100 dark:border-zinc-800 mt-1 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 font-semibold cursor-pointer',
                            projectName === '__custom__' && 'bg-teal-500/10'
                          )}
                        >
                          + Enter Custom Project Name
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {projectName === '__custom__' && (
                  <input
                    type="text"
                    disabled={cutoffStatus.isLocked}
                    required
                    placeholder="Enter project name..."
                    value={customProject}
                    onChange={(e) => setCustomProject(e.target.value)}
                    className="w-full text-xs mt-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                )}
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
                    Planned Hours <span className="text-rose-500 font-bold">*</span>
                  </span>
                  <span className="text-teal-600 dark:text-teal-400 font-extrabold">{plannedHours}h</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    disabled={cutoffStatus.isLocked}
                    required
                    step="0.5"
                    min="0.5"
                    max="12"
                    value={plannedHours}
                    onChange={(e) => setPlannedHours(Number(e.target.value) || 1)}
                    className="w-20 text-xs font-semibold px-2 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 text-center"
                  />
                  <button
                    type="submit"
                    disabled={
                      cutoffStatus.isLocked ||
                      !qualityResult.isValid ||
                      (projectName === '__custom__' && !customProject.trim()) ||
                      plannedHours <= 0
                    }
                    title={
                      !qualityResult.isValid
                        ? qualityResult.descriptionError || qualityResult.titleError || qualityResult.relevanceError
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
              </div>
            </div>

            {/* Task Description & Deliverables Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  Task Description & Technical Scope <span className="text-rose-500 font-bold">*</span>
                </label>
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
                disabled={cutoffStatus.isLocked}
                required
                rows={3}
                placeholder="Describe acceptance criteria, endpoints/components to modify, PR scope, or QA testing notes (minimum 40 words required)..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 resize-y min-h-[64px]"
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

            {/* Quick Hours Preset Chips & Optional Notes */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Quick Hours:</span>
                {QUICK_HOURS.map((hr) => (
                  <button
                    key={hr}
                    type="button"
                    disabled={cutoffStatus.isLocked}
                    onClick={() => setPlannedHours(hr)}
                    className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all cursor-pointer disabled:cursor-not-allowed',
                      plannedHours === hr
                        ? 'bg-teal-500/20 border-teal-500/40 text-teal-700 dark:text-teal-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                    )}
                  >
                    {hr}h
                  </button>
                ))}
              </div>

              <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-teal-500" />
                <span>
                  Target folder: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{firstName.toLowerCase()} bucket</span> (or others)
                </span>
              </div>
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
                  {totalPlannedHours.toFixed(1)} hrs
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
                  Add your planned deliverables above before 10:00 PM. The system will automatically place them inside your weekly Zoho subtask bucket!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((item, index) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-800/40 flex items-center justify-between gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                        {index + 1}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                            {item.taskTitle}
                          </p>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300">
                            {item.projectName}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-teal-500/10 text-teal-700 dark:text-teal-300 tabular-nums">
                        {item.plannedHours.toFixed(1)} hrs
                      </span>

                      {!cutoffStatus.isLocked && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(item.id)}
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
    </div>
  );
}
