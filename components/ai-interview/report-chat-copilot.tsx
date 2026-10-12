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
    <div className="space-y-2.5 text-sm sm:text-base leading-relaxed text-zinc-800 dark:text-zinc-200 font-normal">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        // Empty line
        if (!trimmed) {
          return <div key={`line-${idx}`} className="h-1" />;
        }

        // Headings (e.g. ### Title)
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={`line-${idx}`} className="font-bold text-base text-zinc-900 dark:text-white mt-2 pt-1 border-b border-zinc-100 dark:border-zinc-800 pb-0.5">
              {renderInlineStyles(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={`line-${idx}`} className="font-black text-lg text-zinc-900 dark:text-white mt-3 pt-1">
              {renderInlineStyles(trimmed.slice(3))}
            </h3>
          );
        }

        // Bullet point
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={`line-${idx}`} className="flex items-start gap-2 pl-2">
              <span className="text-[#34c4f2] font-bold text-base leading-none mt-0.5">•</span>
              <span className="flex-1">{renderInlineStyles(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={`line-${idx}`} className="flex items-start gap-2 pl-2">
              <span className="text-[#1689aa] dark:text-[#34c4f2] font-bold text-sm mt-0.5">{numMatch[1]}.</span>
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
          className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[#1689aa] dark:text-[#34c4f2] font-mono text-xs"
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
      content: `Hello! I'm your AI Interview Copilot for **${candidateName || 'this candidate'}**${roleTitle ? ` (${roleTitle})` : ''}.\n\nAsk me anything about their actual answers, coding/technical skills, competencies, or proctoring flags, or click a suggested prompt below!`,
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
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden min-h-0">
      {/* ── Sub-bar: Status & Reset ────────────────────────────────── */}
      <div className="px-5 py-2.5 bg-zinc-50/70 dark:bg-[#232323] border-b border-zinc-200 dark:border-[#383838] flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <MessageSquare className="w-3.5 h-3.5 text-[#34c4f2]" />
          <span>Real-time Candidate Intelligence</span>
        </div>

        <button
          type="button"
          onClick={handleResetChat}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-[#333] transition-colors cursor-pointer"
          title="Reset conversation"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Chat</span>
        </button>
      </div>

      {/* ── Suggested Quick Question Pills ────────────────────────── */}
      <div className="px-5 py-2.5 bg-zinc-50/40 dark:bg-[#232323]/50 border-b border-zinc-200 dark:border-[#383838] overflow-x-auto flex items-center gap-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#2a2a2a] border border-zinc-200 dark:border-[#444] text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:border-[#34c4f2] hover:text-[#1689aa] dark:hover:text-[#34c4f2] transition-all flex-shrink-0 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Icon className="w-3.5 h-3.5 text-[#34c4f2]" />
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Chat Messages Stream ──────────────────────────────────── */}
      <div className="flex-1 px-5 py-4 overflow-y-auto space-y-4 min-h-0">
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
                    : 'bg-zinc-50 dark:bg-[#252525] border border-zinc-200/80 dark:border-[#383838] text-zinc-900 dark:text-white rounded-tl-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
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
                  <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap font-medium">
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
            <div className="bg-zinc-50 dark:bg-[#252525] border border-zinc-200/80 dark:border-[#383838] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-2xs">
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
                <span className="text-sm text-zinc-500 dark:text-zinc-400 font-medium ml-2">
                  Analyzing transcript & interview scoring...
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Chat Input Footer ─────────────────────────────────────── */}
      <div className="p-4 border-t border-zinc-200 dark:border-[#383838] bg-white dark:bg-[#1e1e1e]">
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
            placeholder={`Ask about ${candidateName || 'candidate’s'} answers, technical skills, or proctoring... (Enter to send)`}
            className="w-full resize-none rounded-xl border border-zinc-200 dark:border-[#444] bg-zinc-50 dark:bg-[#252525] px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#34c4f2] transition-all"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="h-10 px-4 rounded-xl bg-[#34c4f2] text-zinc-900 font-bold text-sm hover:bg-[#2db0db] disabled:opacity-40 transition-all shadow-sm shadow-[#34c4f2]/20 flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>Send</span>
          </button>
        </form>
        <p className="text-[11px] text-zinc-400 mt-2 text-center">
          Grounds answers on verified session transcripts, competency rubrics, and proctoring events.
        </p>
      </div>
    </div>
  );
}
