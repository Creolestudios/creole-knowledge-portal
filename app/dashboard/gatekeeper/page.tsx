'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LogOut,
  User,
  Settings,
  Bell,
  Search,
  Home,
  ShieldCheck,
  Loader2,
  UploadCloud,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  AlertTriangle,
  BookOpen,
  Trophy,
  ArrowRight
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import { motion, AnimatePresence } from 'motion/react';

interface ValidationReport {
  qualityScore: number;
  gibberishDetected: boolean;
  lowQualityDetected: boolean;
  aiSpamDetected: boolean;
  plagiarismOverlap: number;
  reason?: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
}

interface Submission {
  id: string;
  title: string;
  content: string;
  author: string;
  status: 'PENDING_QUIZ' | 'APPROVED' | 'REJECTED_QUIZ' | 'REJECTED_AI' | 'FLAGGED';
  validationReport?: ValidationReport;
  quiz?: {
    questions: QuizQuestion[];
    userSelection?: Record<string, number>;
    score?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export default function GatekeeperPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'submit'>('history');

  // Submit form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState(0); // 0 = idle, 1 = AI check, 2 = plagiarism, 3 = quiz gen

  // Active quiz state
  const [activeQuizSubmission, setActiveQuizSubmission] = useState<Submission | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);

  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const router = useRouter();

  const fetchSubmissions = async () => {
    try {
      const res = await fetch('/api/submissions');
      const data = await res.json();
      if (data.submissions) {
        // Sort by createdAt descending
        setSubmissions(
          data.submissions.sort(
            (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        );
      }
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
    }
  };

  useEffect(() => {
    async function getInitialData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      setUser(user);
      await fetchSubmissions();
      setLoading(false);
    }
    getInitialData();
  }, [supabase, router]);

  const handleBlogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSubmitting(true);
    setError(null);

    // Simulate steps in AI pipeline for nice visual effect
    setSubmitStep(1);
    await new Promise((r) => setTimeout(r, 1200));
    setSubmitStep(2);
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitStep(3);
    await new Promise((r) => setTimeout(r, 800));

    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit blog');
      }

      await fetchSubmissions();
      setTitle('');
      setContent('');

      const newSub = data.submission as Submission;
      if (newSub.status === 'PENDING_QUIZ') {
        setActiveQuizSubmission(newSub);
        setQuizAnswers({});
        setQuizResult(null);
        setActiveTab('submit'); // Keep on submissions view to show the quiz
      } else {
        setActiveTab('history');
      }
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
      setSubmitStep(0);
    }
  };

  const handleQuizSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuizSubmission) return;

    // Verify all questions are answered
    const questions = activeQuizSubmission.quiz?.questions || [];
    if (Object.keys(quizAnswers).length < questions.length) {
      setError('Please answer all questions before submitting.');
      return;
    }

    setSubmittingQuiz(true);
    setError(null);

    try {
      const res = await fetch(`/api/submissions/${activeQuizSubmission.id}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userSelection: quizAnswers }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit quiz');
      }

      const updatedSub = data.submission as Submission;
      const score = updatedSub.quiz?.score || 0;
      const passed = updatedSub.status === 'APPROVED';

      setQuizResult({ score, passed });
      await fetchSubmissions();
    } catch (err: any) {
      setError(err.message || 'Quiz grading failed');
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const startQuiz = (sub: Submission) => {
    setActiveQuizSubmission(sub);
    setQuizAnswers({});
    setQuizResult(null);
    setError(null);
  };

  const getStatusBadge = (status: Submission['status']) => {
    const badges = {
      APPROVED: {
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        label: 'Approved',
        icon: CheckCircle2,
      },
      PENDING_QUIZ: {
        bg: 'bg-amber-50 text-amber-700 border-amber-100',
        label: 'Comprehension Quiz Pending',
        icon: HelpCircle,
      },
      REJECTED_QUIZ: {
        bg: 'bg-orange-50 text-orange-700 border-orange-100',
        label: 'Quiz Failed',
        icon: XCircle,
      },
      REJECTED_AI: {
        bg: 'bg-red-50 text-red-700 border-red-100',
        label: 'AI Rejected',
        icon: XCircle,
      },
      FLAGGED: {
        bg: 'bg-zinc-100 text-zinc-700 border-zinc-200',
        label: 'Flagged / Moderation',
        icon: AlertTriangle,
      },
    };

    const badge = badges[status] || {
      bg: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      label: status,
      icon: FileText,
    };
    const Icon = badge.icon;

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${badge.bg}`}
      >
        <Icon size={13} />
        {badge.label}
      </span>
    );
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-zinc-500 font-medium">Initializing Gatekeeper UI...</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9fa] flex">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0a0a0a] text-white flex flex-col p-8 hidden md:flex border-r border-zinc-800 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-32 bg-brand/5 blur-[60px] pointer-events-none" />

        <div className="flex items-center gap-3 mb-12 relative z-10">
          <div className="w-10 h-10 bg-brand rounded-lg flex items-center justify-center shadow-brand">
            <span className="text-black font-black text-xl">C</span>
          </div>
          <div>
            <span className="font-bold text-lg block leading-none">Creole</span>
            <span className="text-[10px] text-brand uppercase tracking-widest font-bold">
              Portal
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 relative z-10">
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group cursor-pointer"
          >
            <Home size={20} />
            <span className="font-medium text-sm">Morning Brief</span>
          </button>

          <button
            onClick={() => router.push('/dashboard/gatekeeper')}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group bg-zinc-900/50 text-brand border border-brand/20 shadow-sm"
          >
            <ShieldCheck size={20} />
            <span className="font-semibold text-sm">Blog Submissions</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/quizzes')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group cursor-pointer text-left"
          >
            <Trophy size={20} className="group-hover:scale-110 transition-transform" />
            <span className="font-semibold text-sm">My Quizzes</span>
          </button>

          <div className="h-4" />

          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group">
            <Bell size={20} className="group-hover:rotate-12 transition-transform" />
            <span className="font-medium text-sm">Notifications</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group">
            <Settings size={20} className="group-hover:rotate-90 transition-transform" />
            <span className="font-medium text-sm">Settings</span>
          </button>
        </nav>

        <div className="pt-8 border-t border-zinc-800 relative z-10">
          <LogoutButton variant="sidebar" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-zinc-200 px-10 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4 flex-1">
            <h1 className="text-xl font-extrabold text-zinc-950 flex items-center gap-2">
              <ShieldCheck className="text-brand" />
              <span>AI Gatekeeper Console</span>
            </h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">
                  {user.email?.split('@')[0]}
                </p>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  {user.email?.split('@')[1]}
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-600">
                <User size={20} />
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-10 flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            {/* Header info */}
            <div className="mb-10">
              <h2 className="text-3xl font-black text-zinc-900 tracking-tight mb-2">
                Validate & Share Your Knowledge
              </h2>
              <p className="text-zinc-500 text-base">
                Submit technical articles to our newsletter. The AI Gatekeeper automatically screens
                content quality and structures a comprehension check.
              </p>
            </div>

            {/* Nav tabs */}
            <div className="flex border-b border-zinc-200 mb-8">
              <button
                onClick={() => {
                  setActiveTab('history');
                  setActiveQuizSubmission(null);
                  setError(null);
                }}
                className={`py-3.5 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer ${
                  activeTab === 'history' && !activeQuizSubmission
                    ? 'border-brand text-brand font-black'
                    : 'border-transparent text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Submission History
              </button>
              <button
                onClick={() => {
                  setActiveTab('submit');
                  setActiveQuizSubmission(null);
                  setError(null);
                }}
                className={`py-3.5 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer ${
                  activeTab === 'submit' || activeQuizSubmission
                    ? 'border-brand text-brand font-black'
                    : 'border-transparent text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {activeQuizSubmission ? 'Active Comprehension Quiz' : 'Submit New Blog'}
              </button>
            </div>

            {/* Error alerts */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm font-semibold flex items-start gap-2">
                <XCircle className="shrink-0 mt-0.5" size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Dynamic View rendering */}
            <AnimatePresence mode="wait">
              {activeQuizSubmission ? (
                // Active Quiz Flow
                <motion.div
                  key="quiz"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-3xl border border-zinc-200 p-8 shadow-card"
                >
                  <div className="mb-6 pb-6 border-b border-zinc-100 flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold tracking-widest text-brand uppercase px-2 py-0.5 bg-brand/10 border border-brand/20 rounded">
                        Comprehension Verification
                      </span>
                      <h3 className="text-2xl font-black text-zinc-900 mt-2">
                        Quiz: {activeQuizSubmission.title}
                      </h3>
                      <p className="text-zinc-500 text-sm mt-1">
                        Please answer the questions generated directly from your content to
                        authorize publication.
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveQuizSubmission(null)}
                      className="px-4 py-2 text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded-xl text-xs font-bold transition-all"
                    >
                      Back to Dashboard
                    </button>
                  </div>

                  {!quizResult ? (
                    <form onSubmit={handleQuizSubmit} className="space-y-8">
                      {(activeQuizSubmission.quiz?.questions || []).map((q, qIndex) => (
                        <div key={q.id} className="space-y-3">
                          <p className="text-base font-bold text-zinc-950">
                            {qIndex + 1}. {q.question}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {q.options.map((option, oIndex) => {
                              const isSelected = quizAnswers[q.id] === oIndex;
                              return (
                                <button
                                  type="button"
                                  key={oIndex}
                                  onClick={() =>
                                    setQuizAnswers((prev) => ({ ...prev, [q.id]: oIndex }))
                                  }
                                  className={`p-4 rounded-2xl text-left text-sm font-medium border transition-all flex items-start gap-3 ${
                                    isSelected
                                      ? 'bg-brand/5 border-brand text-brand ring-2 ring-brand/10'
                                      : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100/50 text-zinc-700'
                                  }`}
                                >
                                  <span
                                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                                      isSelected
                                        ? 'bg-brand text-black'
                                        : 'bg-zinc-200 text-zinc-600'
                                    }`}
                                  >
                                    {String.fromCharCode(65 + oIndex)}
                                  </span>
                                  <span>{option}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      <div className="pt-6 border-t border-zinc-100 flex justify-end">
                        <button
                          type="submit"
                          disabled={submittingQuiz}
                          className="px-8 py-4 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 active:scale-98 transition-all text-sm uppercase tracking-widest disabled:opacity-50 flex items-center gap-2"
                        >
                          {submittingQuiz ? (
                            <>
                              <Loader2 className="animate-spin" size={16} />
                              Grading quiz...
                            </>
                          ) : (
                            <>
                              Submit Answers
                              <ArrowRight size={16} />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  ) : (
                    // Quiz Result State
                    <div className="text-center py-10 space-y-6">
                      <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center shadow-lg bg-zinc-50 border">
                        {quizResult.passed ? (
                          <CheckCircle2 className="text-emerald-500 w-12 h-12" />
                        ) : (
                          <XCircle className="text-red-500 w-12 h-12" />
                        )}
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-2xl font-black text-zinc-950">
                          {quizResult.passed
                            ? 'Author Verification Succeeded!'
                            : 'Verification Failed'}
                        </h4>
                        <p className="text-zinc-500 text-sm max-w-md mx-auto">
                          You scored{' '}
                          <span className="font-bold text-zinc-800">{quizResult.score}/3</span>.
                          {quizResult.passed
                            ? ' Your technical blog is approved and is now live on the Creole Knowledge Portal!'
                            : ' You need at least 2 correct answers out of 3. You can review and re-submit your blog later.'}
                        </p>
                      </div>

                      <div className="pt-6 border-t border-zinc-100 flex justify-center gap-4">
                        <button
                          onClick={() => {
                            setActiveQuizSubmission(null);
                            setActiveTab('history');
                          }}
                          className="px-6 py-3 bg-zinc-900 hover:bg-zinc-850 text-white text-xs font-bold rounded-xl transition-all"
                        >
                          Back to Submissions
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : activeTab === 'submit' ? (
                // Submit Form Screen
                <motion.div
                  key="submit"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-3xl border border-zinc-200 p-8 shadow-card"
                >
                  {submitting ? (
                    // Submission loading / checker sequence
                    <div className="py-20 text-center space-y-8 max-w-sm mx-auto">
                      <div className="relative w-24 h-24 mx-auto">
                        <div className="absolute inset-0 rounded-full border-4 border-zinc-100" />
                        <div className="absolute inset-0 rounded-full border-4 border-brand border-t-transparent animate-spin" />
                        <div className="absolute inset-4 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                          <UploadCloud size={24} />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xl font-bold text-zinc-950">AI Gatekeeper Screening</h4>

                        {/* Loading stepper checks */}
                        <div className="space-y-2 text-left bg-zinc-50 border border-zinc-150 p-4 rounded-2xl text-xs font-medium text-zinc-500">
                          <div className="flex items-center gap-2">
                            {submitStep >= 1 ? (
                              <Loader2 className="animate-spin text-brand" size={13} />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full bg-zinc-200" />
                            )}
                            <span className={submitStep >= 1 ? 'text-zinc-800 font-bold' : ''}>
                              Analyzing quality, grammar & structure
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {submitStep >= 2 ? (
                              <Loader2 className="animate-spin text-brand" size={13} />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full bg-zinc-200" />
                            )}
                            <span className={submitStep >= 2 ? 'text-zinc-800 font-bold' : ''}>
                              Scanning anti-plagiarism indices
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {submitStep >= 3 ? (
                              <Loader2 className="animate-spin text-brand" size={13} />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full bg-zinc-200" />
                            )}
                            <span className={submitStep >= 3 ? 'text-zinc-800 font-bold' : ''}>
                              Generating technical check quiz questions
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Input Form
                    <form onSubmit={handleBlogSubmit} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-zinc-700 block">Blog Title</label>
                        <input
                          type="text"
                          required
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Building micro-frontends with Module Federation"
                          className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 font-medium placeholder:text-zinc-300 placeholder:font-normal transition-all"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-bold text-zinc-700 block">
                          Blog Content (Markdown supported)
                        </label>
                        <textarea
                          required
                          rows={12}
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          placeholder="Write or paste your markdown blog post content here..."
                          className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 font-medium placeholder:text-zinc-300 placeholder:font-normal transition-all font-mono text-sm leading-relaxed"
                        />
                      </div>

                      <div className="pt-4 border-t border-zinc-100 flex justify-end">
                        <button
                          type="submit"
                          className="px-10 py-5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 active:scale-98 transition-all text-sm uppercase tracking-widest"
                        >
                          Submit to Gatekeeper
                        </button>
                      </div>
                    </form>
                  )}
                </motion.div>
              ) : (
                // Submission History List
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  {submissions.length === 0 ? (
                    <div className="bg-white border border-zinc-200 rounded-[32px] p-12 text-center space-y-4 shadow-sm">
                      <div className="w-16 h-16 bg-zinc-50 rounded-2xl mx-auto flex items-center justify-center text-zinc-400">
                        <BookOpen size={28} />
                      </div>
                      <h3 className="text-xl font-extrabold text-zinc-900">No submissions yet</h3>
                      <p className="text-zinc-500 max-w-sm mx-auto text-sm">
                        You have not submitted any articles for validation. Share your technical
                        insights with the team today!
                      </p>
                      <button
                        onClick={() => setActiveTab('submit')}
                        className="px-6 py-3 bg-brand text-black font-bold rounded-xl text-xs uppercase tracking-wider shadow-brand hover:bg-brand-hover transition-all"
                      >
                        Create First Submission
                      </button>
                    </div>
                  ) : (
                    submissions.map((sub) => (
                      <div
                        key={sub.id}
                        className="bg-white border border-zinc-150 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-brand/40 hover:shadow-card transition-all"
                      >
                        <div className="space-y-3 flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-xs text-zinc-400 font-medium">
                              {new Date(sub.createdAt).toLocaleDateString()}
                            </span>
                            {getStatusBadge(sub.status)}
                          </div>

                          <h3 className="text-xl font-bold text-zinc-900 truncate">{sub.title}</h3>

                          {sub.validationReport && (
                            <div className="flex items-center gap-4 text-xs font-semibold text-zinc-500">
                              <span className="flex items-center gap-1">
                                Quality Score:
                                <span
                                  className={`font-black ${
                                    sub.validationReport.qualityScore >= 70
                                      ? 'text-emerald-600'
                                      : 'text-zinc-800'
                                  }`}
                                >
                                  {sub.validationReport.qualityScore}/100
                                </span>
                              </span>
                              <span className="flex items-center gap-1">
                                Duplicate Check:
                                <span
                                  className={`font-black ${
                                    sub.validationReport.plagiarismOverlap > 30
                                      ? 'text-red-500'
                                      : 'text-emerald-600'
                                  }`}
                                >
                                  {sub.validationReport.plagiarismOverlap}%
                                </span>
                              </span>
                            </div>
                          )}

                          {sub.validationReport?.reason &&
                            (sub.status === 'REJECTED_AI' || sub.status === 'FLAGGED') && (
                              <p className="text-xs text-red-600 bg-red-50 border border-red-100/30 px-3.5 py-2 rounded-xl mt-2 leading-relaxed">
                                <span className="font-bold uppercase tracking-widest text-[9px] block text-red-500 mb-0.5">
                                  Rejection Details:
                                </span>
                                {sub.validationReport.reason}
                              </p>
                            )}
                        </div>

                        {sub.status === 'PENDING_QUIZ' && (
                          <div className="shrink-0">
                            <button
                              onClick={() => startQuiz(sub)}
                              className="w-full md:w-auto px-5 py-3 bg-brand text-black font-black rounded-xl shadow-brand hover:bg-brand-hover text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 active:scale-98"
                            >
                              Take Verification Quiz
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
