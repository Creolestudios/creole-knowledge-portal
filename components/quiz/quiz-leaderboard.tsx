'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Trophy, Clock, Target, ArrowLeft } from 'lucide-react';

interface LeaderboardProps {
  blogId?: number | string;
  onClose: () => void;
  onRetake?: () => void;
}

export function QuizLeaderboard({ blogId, onClose, onRetake }: LeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const url = blogId ? `/api/quizzes/leaderboard?blogId=${blogId}` : '/api/quizzes/leaderboard';
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.success) {
          setLeaderboard(data.leaderboard);
        } else {
          setError(data.error || 'Failed to fetch leaderboard');
        }
      } catch (err) {
        setError('Error fetching leaderboard');
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [blogId]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-4xl mx-auto mt-8"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-zinc-800">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <Trophy className="text-yellow-500" />
            Top Developers
          </h2>
          <p className="text-zinc-500 text-sm mt-1">Ranking based on highest score and fastest time.</p>
        </div>
        <div className="flex items-center gap-2">
          {onRetake && (
            <button
              onClick={onRetake}
              className="flex items-center gap-2 text-black bg-brand hover:bg-brand/90 transition-colors text-sm font-black uppercase tracking-wider px-4 py-2 rounded-lg cursor-pointer shadow-brand"
            >
              Resume / Retake Quiz
            </button>
          )}
          <button 
            onClick={onClose}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-semibold bg-zinc-900 px-4 py-2 rounded-lg cursor-pointer"
          >
            <ArrowLeft size={16} /> Back to Briefing
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 font-medium text-sm">Loading rankings...</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
          {error}
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
          No quiz attempts found yet. Be the first to take the quiz!
        </div>
      ) : (
        <div className="space-y-3">
          {leaderboard.map((entry, idx) => (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={idx}
              className={`flex items-center justify-between p-4 rounded-xl border ${
                entry.isSelf ? 'bg-brand/10 border-brand/40 shadow-sm' :
                idx === 0 ? 'bg-yellow-500/5 border-yellow-500/20' :
                idx === 1 ? 'bg-zinc-300/5 border-zinc-300/20' :
                idx === 2 ? 'bg-amber-700/5 border-amber-700/20' :
                'bg-zinc-900/50 border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  idx === 0 ? 'bg-yellow-500/20 text-yellow-500' :
                  idx === 1 ? 'bg-zinc-300/20 text-zinc-300' :
                  idx === 2 ? 'bg-amber-700/20 text-amber-500' :
                  'bg-zinc-800 text-zinc-500'
                }`}>
                  #{entry.rank}
                </div>
                <div>
                  <div className="font-bold text-zinc-200">{entry.userName}</div>
                  <div className="text-[11px] text-brand font-semibold tracking-wider uppercase">{entry.role}</div>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1 justify-end">
                    <Target size={12} /> Accuracy
                  </div>
                  <div className="font-semibold text-zinc-300">{entry.percentage}%</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1 justify-end">
                    <Clock size={12} /> Time
                  </div>
                  <div className="font-mono text-sm font-semibold text-zinc-300">
                    {Math.floor((entry.timeTaken || 0) / 60)}:{((entry.timeTaken || 0) % 60).toString().padStart(2, '0')}
                  </div>
                </div>
                <div className="text-right w-16">
                  <div className="text-xs text-zinc-500 mb-1 font-semibold uppercase tracking-wider">Score</div>
                  <div className="font-black text-xl text-white">{entry.score}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
