'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  ShieldAlert,
  Loader2,
  Search,
  Filter,
  BookOpen,
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ValidationReport {
  qualityScore: number;
  gibberishDetected: boolean;
  lowQualityDetected: boolean;
  aiSpamDetected: boolean;
  plagiarismOverlap: number;
  reason?: string;
}

interface Submission {
  id: string;
  title: string;
  content: string;
  author: string;
  status: 'PENDING_QUIZ' | 'APPROVED' | 'REJECTED_QUIZ' | 'REJECTED_AI' | 'FLAGGED';
  validationReport?: ValidationReport;
  quiz?: {
    questions: any[];
    userSelection?: Record<string, number>;
    score?: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  id: string;
  submissionId?: string;
  action: 'SUBMITTED' | 'AI_VALIDATED' | 'QUIZ_TAKEN' | 'MODERATOR_APPROVED' | 'MODERATOR_REJECTED';
  performedBy: string;
  timestamp: string;
  details?: string;
}

export default function SubmissionsModeration() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'logs'>('list');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Expanded submission content ID
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Moderation state
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [moderationReason, setModerationReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [subsRes, logsRes] = await Promise.all([
        fetch('/api/submissions'),
        fetch('/api/admin/audit-logs'),
      ]);

      const subsData = await subsRes.json();
      const logsData = await logsRes.json();

      if (subsData.submissions) {
        setSubmissions(
          subsData.submissions.sort(
            (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        );
      }
      if (logsData.auditLogs) {
        setAuditLogs(logsData.auditLogs);
      }
    } catch (err) {
      console.error('Failed to load moderation data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchData();
    })();
  }, []);

  const handleModerate = async (id: string, action: 'APPROVE' | 'REJECT') => {
    setModifyingId(id);
    setError(null);
    const reason = moderationReason[id] || '';

    try {
      const res = await fetch(`/api/submissions/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Moderation action failed');
      }

      // Clear the reason input for this item
      setModerationReason((prev) => ({ ...prev, [id]: '' }));

      // Refresh list & logs
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'An error occurred during moderation.');
    } finally {
      setModifyingId(null);
    }
  };

  const getStatusBadge = (status: Submission['status']) => {
    const badges = {
      APPROVED: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'Approved' },
      PENDING_QUIZ: { bg: 'bg-blue-50 text-blue-700 border-blue-100', label: 'Quiz Pending' },
      REJECTED_QUIZ: { bg: 'bg-orange-50 text-orange-700 border-orange-100', label: 'Quiz Failed' },
      REJECTED_AI: { bg: 'bg-red-50 text-red-700 border-red-100', label: 'AI Rejected' },
      FLAGGED: { bg: 'bg-zinc-150 text-zinc-700 border-zinc-250', label: 'Flagged / Rejected' },
    };

    const badge = badges[status] || {
      bg: 'bg-zinc-50 text-zinc-700 border-zinc-100',
      label: status,
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${badge.bg}`}
      >
        {badge.label}
      </span>
    );
  };

  const filteredSubmissions = submissions.filter((sub) => {
    const matchesSearch =
      sub.title.toLowerCase().includes(search.toLowerCase()) ||
      sub.author.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || sub.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-[#34c4f2] animate-spin" />
        <p className="text-zinc-500 font-medium">Fetching submission logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab select and Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
        <div className="flex bg-zinc-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('list')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'list'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            <BookOpen size={14} />
            Submissions ({filteredSubmissions.length})
          </button>
          <button
            onClick={() => setActiveSubTab('logs')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'logs'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            <Activity size={14} />
            System Audit Logs ({auditLogs.length})
          </button>
        </div>

        {activeSubTab === 'list' && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                size={14}
              />
              <input
                type="text"
                placeholder="Search title or author..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2]"
              />
            </div>

            {/* Status Filter */}
            <div className="relative flex items-center gap-1.5">
              <Filter className="text-zinc-400" size={14} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2]"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING_QUIZ">Quiz Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED_QUIZ">Quiz Failed</option>
                <option value="REJECTED_AI">AI Rejected</option>
                <option value="FLAGGED">Flagged / Moderated</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs font-semibold flex items-center gap-2">
          <XCircle className="shrink-0" size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Main tab content */}
      <AnimatePresence mode="wait">
        {activeSubTab === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {filteredSubmissions.length === 0 ? (
              <div className="text-center py-20 bg-white border rounded-2xl p-8">
                <FileText className="mx-auto text-zinc-300 w-12 h-12 mb-4" />
                <p className="text-zinc-500 font-medium">No matching submissions found.</p>
              </div>
            ) : (
              filteredSubmissions.map((sub) => {
                const isExpanded = expandedId === sub.id;
                const canOverride = sub.status !== 'APPROVED';

                return (
                  <div
                    key={sub.id}
                    className="bg-white border border-zinc-150 rounded-2xl overflow-hidden shadow-sm hover:shadow-card hover:border-[#34c4f2]/30 transition-all"
                  >
                    {/* Header line */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                      className="p-6 flex items-center justify-between gap-4 cursor-pointer hover:bg-zinc-50/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                            {new Date(sub.createdAt).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                            •
                          </span>
                          <span className="text-xs text-zinc-500 font-medium truncate max-w-xs">
                            {sub.author}
                          </span>
                          {getStatusBadge(sub.status)}
                        </div>
                        <h3 className="text-lg font-bold text-zinc-900 truncate">{sub.title}</h3>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {sub.validationReport && (
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-none mb-1">
                              Quality Score
                            </p>
                            <p
                              className={`text-base font-black ${
                                sub.validationReport.qualityScore >= 70
                                  ? 'text-emerald-500'
                                  : 'text-zinc-800'
                              }`}
                            >
                              {sub.validationReport.qualityScore}/100
                            </p>
                          </div>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="text-zinc-400" size={18} />
                        ) : (
                          <ChevronDown className="text-zinc-400" size={18} />
                        )}
                      </div>
                    </div>

                    {/* Collapsible Content block */}
                    {isExpanded && (
                      <div className="border-t border-zinc-100 p-6 bg-zinc-50/30 space-y-6">
                        {/* Validation report parameters */}
                        {sub.validationReport && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white border rounded-xl p-4 shadow-sm">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                                Quality Score
                              </span>
                              <div className="flex items-center gap-2">
                                <Sparkles
                                  className={
                                    sub.validationReport.qualityScore >= 70
                                      ? 'text-emerald-500'
                                      : 'text-amber-500'
                                  }
                                  size={16}
                                />
                                <span className="text-lg font-black">
                                  {sub.validationReport.qualityScore}/100
                                </span>
                              </div>
                            </div>
                            <div className="bg-white border rounded-xl p-4 shadow-sm">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                                Anti-Spam / Quality
                              </span>
                              <div className="flex items-center gap-1.5 text-xs font-bold">
                                {sub.validationReport.gibberishDetected ||
                                sub.validationReport.lowQualityDetected ||
                                sub.validationReport.aiSpamDetected ? (
                                  <>
                                    <XCircle className="text-red-500" size={15} />
                                    <span className="text-red-600">Failed Screen</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="text-emerald-500" size={15} />
                                    <span className="text-emerald-600">Passed Screen</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="bg-white border rounded-xl p-4 shadow-sm">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                                Plagiarism Check
                              </span>
                              <span
                                className={`text-base font-black ${
                                  sub.validationReport.plagiarismOverlap > 30
                                    ? 'text-red-500'
                                    : 'text-emerald-600'
                                }`}
                              >
                                {sub.validationReport.plagiarismOverlap}% overlap
                              </span>
                            </div>
                            <div className="bg-white border rounded-xl p-4 shadow-sm">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                                Quiz Status
                              </span>
                              <span className="text-xs font-bold">
                                {sub.quiz?.score !== undefined
                                  ? `Scored ${sub.quiz.score}/3`
                                  : 'Quiz Not Attempted'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Detailed validation reason */}
                        {sub.validationReport?.reason && (
                          <div className="bg-white border border-zinc-150 rounded-xl p-4">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                              AI Gatekeeper Rationale
                            </span>
                            <p className="text-xs font-semibold text-zinc-600 leading-relaxed">
                              {sub.validationReport.reason}
                            </p>
                          </div>
                        )}

                        {/* Full blog content block */}
                        <div className="bg-white border border-zinc-150 rounded-2xl p-6">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-3">
                            Blog Content Preview
                          </span>
                          <div className="prose prose-sm max-w-none max-h-72 overflow-y-auto text-zinc-700 font-mono text-xs whitespace-pre-wrap leading-relaxed border-t pt-3">
                            {sub.content}
                          </div>
                        </div>

                        {/* Quiz representation */}
                        {sub.quiz && (
                          <div className="bg-white border border-zinc-150 rounded-xl p-6">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-3">
                              Comprehension Quiz Setup
                            </span>
                            <div className="space-y-4">
                              {sub.quiz.questions.map((q, idx) => {
                                const selectedOpt = sub.quiz?.userSelection?.[q.id];
                                return (
                                  <div
                                    key={q.id}
                                    className="text-xs border-b pb-3 last:border-0 last:pb-0"
                                  >
                                    <p className="font-bold text-zinc-900 mb-2">
                                      {idx + 1}. {q.question}
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-3">
                                      {q.options.map((opt: string, oIdx: number) => {
                                        const isCorrect = oIdx === q.correctOptionIndex;
                                        const isSelected = oIdx === selectedOpt;
                                        return (
                                          <div
                                            key={oIdx}
                                            className={`p-2 rounded border flex items-center justify-between ${
                                              isCorrect
                                                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                                                : isSelected
                                                  ? 'bg-red-50 border-red-100 text-red-800'
                                                  : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                                            }`}
                                          >
                                            <span>{opt}</span>
                                            {isCorrect && (
                                              <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                Correct
                                              </span>
                                            )}
                                            {isSelected && !isCorrect && (
                                              <span className="text-[9px] font-black uppercase text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                                                User Picked
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Moderation manual override block */}
                        {canOverride && (
                          <div className="pt-6 border-t border-zinc-100 flex flex-col md:flex-row items-end md:items-center gap-4 bg-zinc-50/50 -mx-6 -mb-6 p-6">
                            <div className="flex-1 w-full relative">
                              <MessageSquare
                                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"
                                size={14}
                              />
                              <input
                                type="text"
                                placeholder="Provide moderation notes or reason (optional)..."
                                value={moderationReason[sub.id] || ''}
                                onChange={(e) =>
                                  setModerationReason((prev) => ({
                                    ...prev,
                                    [sub.id]: e.target.value,
                                  }))
                                }
                                className="w-full pl-10 pr-4 py-3 bg-white border border-zinc-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2]"
                              />
                            </div>

                            <div className="flex gap-2 shrink-0 w-full md:w-auto">
                              <button
                                onClick={() => handleModerate(sub.id, 'REJECT')}
                                disabled={modifyingId === sub.id}
                                className="flex-1 md:flex-none px-5 py-3 border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-xs font-bold transition-all active:scale-98 disabled:opacity-50"
                              >
                                {modifyingId === sub.id ? (
                                  <Loader2 className="animate-spin inline" size={12} />
                                ) : (
                                  'Flag / Reject'
                                )}
                              </button>
                              <button
                                onClick={() => handleModerate(sub.id, 'APPROVE')}
                                disabled={modifyingId === sub.id}
                                className="flex-1 md:flex-none px-6 py-3 bg-brand text-black font-black shadow-brand hover:bg-brand-hover rounded-xl text-xs uppercase tracking-wider transition-all active:scale-98 disabled:opacity-50"
                              >
                                {modifyingId === sub.id ? (
                                  <Loader2 className="animate-spin inline" size={12} />
                                ) : (
                                  'Approve Override'
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </motion.div>
        ) : (
          // Timeline Audit Logs view
          <motion.div
            key="logs"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm max-w-3xl mx-auto"
          >
            {auditLogs.length === 0 ? (
              <div className="text-center py-10">
                <Clock className="mx-auto text-zinc-300 w-10 h-10 mb-2" />
                <p className="text-zinc-500 font-medium">No audit logs recorded yet.</p>
              </div>
            ) : (
              <div className="relative border-l-2 border-zinc-100 pl-6 space-y-6 py-2">
                {auditLogs.map((log) => {
                  const actionColors = {
                    SUBMITTED: 'bg-blue-500',
                    AI_VALIDATED: 'bg-indigo-500',
                    QUIZ_TAKEN: 'bg-amber-500',
                    MODERATOR_APPROVED: 'bg-emerald-500',
                    MODERATOR_REJECTED: 'bg-red-500',
                  };
                  const color = actionColors[log.action] || 'bg-zinc-500';

                  return (
                    <div key={log.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[31px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ring-4 ring-zinc-50 ${color}`}
                      />

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                            {new Date(log.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            • {new Date(log.timestamp).toLocaleDateString()}
                          </span>
                          <span className="text-xs font-black text-zinc-800 px-2 py-0.5 rounded bg-zinc-100 uppercase tracking-widest scale-90">
                            {log.action}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-zinc-800 leading-normal">
                          {log.details}
                        </p>

                        <p className="text-[10px] font-mono text-zinc-400">
                          Performed by: {log.performedBy}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
