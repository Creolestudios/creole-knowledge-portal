'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
  RotateCcw,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  Code2,
  MessageSquare,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ReportChatCopilotProps {
  sessionId: string;
  candidateName?: string | null;
  roleTitle?: string | null;
  recommendation?: string | null;
}

const SUGGESTED_QUESTIONS = [
  {
    icon: Sparkles,
    label: 'Key Strengths & Weaknesses',
    query: 'Summarize the candidate’s top 3 strengths and top 3 areas of concern based on their actual answers.',
  },
  {
    icon: Code2,
    label: 'Technical Depth',
    query: 'How strong was their technical depth on the core technical questions? Did they provide concrete details or general buzzwords?',
  },
  {
    icon: ShieldAlert,
    label: 'Proctoring & Integrity',
    query: 'Were there any proctoring flags, suspicious tab switches, voice interruptions, or reasons for termination?',
  },
  {
    icon: HelpCircle,
    label: 'Round 2 Interview Questions',
    query: 'What specific technical or scenario questions should the team ask this candidate in the next round to verify weak areas?',
  },
];

/**
 * Basic markdown-style parser for assistant responses (bold, bullets, quotes, code).
 */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="space-y-2 text-xs sm:text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        // Empty line
        if (!trimmed) {
          return <div key={`line-${idx}`} className="h-1" />;
        }

        // Headings (e.g. ### Title)
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={`line-${idx}`} className="font-bold text-sm text-zinc-900 dark:text-white mt-2 pt-1 border-b border-zinc-100 dark:border-zinc-800 pb-0.5">
              {renderInlineStyles(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={`line-${idx}`} className="font-black text-sm text-zinc-900 dark:text-white mt-3 pt-1">
              {renderInlineStyles(trimmed.slice(3))}
            </h3>
          );
        }

        // Bullet point
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={`line-${idx}`} className="flex items-start gap-2 pl-2">
              <span className="text-[#34c4f2] font-bold text-sm leading-none mt-0.5">•</span>
              <span className="flex-1">{renderInlineStyles(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={`line-${idx}`} className="flex items-start gap-2 pl-2">
              <span className="text-[#1689aa] dark:text-[#34c4f2] font-bold text-xs mt-0.5">{numMatch[1]}.</span>
              <span className="flex-1">{renderInlineStyles(numMatch[2])}</span>
            </div>
          );
        }

        // Blockquote
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={`line-${idx}`}
              className="border-l-2 border-[#34c4f2] pl-3 py-1 my-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-r-lg italic text-zinc-600 dark:text-zinc-300"
            >
              {renderInlineStyles(trimmed.slice(2))}
            </blockquote>
          );
        }

        // Default paragraph line
        return <p key={`line-${idx}`}>{renderInlineStyles(line)}</p>;
      })}
    </div>
  );
}

function renderInlineStyles(text: string): React.ReactNode {
  // Split on bold (`**text**`) and inline code (`` `code` ``)
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-zinc-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[#1689aa] dark:text-[#34c4f2] font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function ReportChatCopilot({
  sessionId,
  candidateName,
  roleTitle,
}: ReportChatCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm your AI Interview Copilot for **${candidateName || 'this candidate'}**. 

I have full access to their:
- 🎯 **Verbatim Answers & Transcript** across all questions
- 📊 **Scoring & Competency Breakdown**
- 🛡️ **Proctoring Logs, Warnings & Integrity Status**
- 💼 **Job Role Requirements** (${roleTitle || 'Target Role'})

Feel free to ask any specific question below or click one of the suggested prompts!`,
      timestamp: new Date(),
    },
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const question = (textToSend ?? input).trim();
    if (!question || isLoading) return;

    setErrorMessage(null);
    setInput('');

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Build lightweight conversation history for the API
      const historyPayload = newMessages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const res = await fetch(`/api/admin/reports/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: historyPayload.slice(-8),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer || 'No response generated.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reach AI Copilot.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Conversation reset. Ask any question about **${candidateName || 'this candidate'}**'s interview!`,
        timestamp: new Date(),
      },
    ]);
    setErrorMessage(null);
  };

  return (
    <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card overflow-hidden flex flex-col min-h-[620px] max-h-[780px]">
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-[#4a4a4a] bg-zinc-50/50 dark:bg-[#222] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#34c4f2] to-[#1689aa] text-white flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-zinc-900 dark:text-white">
                Interview Copilot & Admin Q&A
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#34c4f2]/15 text-[#1689aa] dark:text-[#34c4f2] border border-[#34c4f2]/30 uppercase tracking-wider">
                Grounded AI
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
              Real-time intelligence on {candidateName || 'candidate’s'} answers, competencies, and flags
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetChat}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Reset conversation"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* ── Suggested Quick Question Pills ────────────────────────── */}
      <div className="px-6 py-3 bg-zinc-50/80 dark:bg-[#252525] border-b border-zinc-200 dark:border-[#4a4a4a] overflow-x-auto scrollbar-none flex items-center gap-2">
        <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#34c4f2]" />
          Suggested:
        </span>
        {SUGGESTED_QUESTIONS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <button
              key={idx}
              type="button"
              disabled={isLoading}
              onClick={() => handleSendMessage(s.query)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#1e1e1e] border border-zinc-200 dark:border-[#444] text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:border-[#34c4f2] hover:text-[#1689aa] dark:hover:text-[#34c4f2] transition-all flex-shrink-0 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Icon className="w-3 h-3 text-[#34c4f2]" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Chat Messages Stream ──────────────────────────────────── */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold shadow-2xs ${
                  isUser
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2]'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-2xs ${
                  isUser
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-tr-sm'
                    : 'bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] text-zinc-900 dark:text-white rounded-tl-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      isUser
                        ? 'text-zinc-300 dark:text-zinc-600'
                        : 'text-[#1689aa] dark:text-[#34c4f2]'
                    }`}
                  >
                    {isUser ? 'Admin' : 'AI Copilot'}
                  </span>
                  {!isUser && m.id !== 'welcome' && (
                    <button
                      type="button"
                      onClick={() => handleCopy(m.id, m.content)}
                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                      title="Copy response"
                    >
                      {copiedId === m.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {isUser ? (
                  <p className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap font-medium">
                    {m.content}
                  </p>
                ) : (
                  <FormattedMessage text={m.content} />
                )}
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2] flex items-center justify-center flex-shrink-0 shadow-2xs">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#34c4f2] animate-bounce" />
                <span
                  className="w-2 h-2 rounded-full bg-[#34c4f2] animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-[#34c4f2] animate-bounce"
                  style={{ animationDelay: '0.4s' }}
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium ml-2">
                  Analyzing transcript & interview scoring...
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Chat Input Footer ─────────────────────────────────────── */}
      <div className="p-4 border-t border-zinc-200 dark:border-[#4a4a4a] bg-white dark:bg-[#2b2b2b]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask anything about ${candidateName || 'this candidate’s'} answers, technical skills, or proctoring... (Enter to send)`}
            className="w-full resize-none rounded-xl border border-zinc-200 dark:border-[#4a4a4a] bg-zinc-50 dark:bg-[#1f1f1f] px-3.5 py-2.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#34c4f2] transition-all"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="h-10 px-4 rounded-xl bg-[#34c4f2] text-zinc-900 font-black text-xs hover:bg-[#2db0db] disabled:opacity-40 transition-all shadow-md shadow-[#34c4f2]/20 flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
        <p className="text-[10px] text-zinc-400 mt-2 text-center">
          Grounds answers on verified session transcripts, competency rubrics, and proctoring events.
        </p>
      </div>
    </div>
  );
}
