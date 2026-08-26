'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trophy, Clock, Target, Star, Medal } from 'lucide-react';

export default function LeaderboardTab() {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch('/api/leaderboard');
        if (res.ok) {
          const data = await res.json();
          setLeaderboard(data.leaderboard || []);
        }
      } catch (e) {
        console.error('Error fetching leaderboard:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
        <Loader2 className="animate-spin" size={20} />
        <span className="font-semibold">Loading leaderboard...</span>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0m';
    const m = Math.floor(seconds / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
  };

  return (
    <div className="space-y-8">
      {/* Header banner */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-700 rounded-[28px] p-7 border border-amber-800 flex items-center gap-5 shadow-lg">
        <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/20 flex items-center justify-center text-white shrink-0">
          <Trophy size={28} />
        </div>
        <div>
          <p className="text-3xl font-black text-white tabular-nums leading-none">
            Leaderboard
          </p>
          <p className="text-amber-100 text-sm font-medium mt-1">
            See how you stack up against other readers!
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
        <div className="overflow-x-auto rounded-2xl border border-zinc-100">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-400 font-extrabold">
                <th className="text-center px-5 py-3 w-16">Rank</th>
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-5 py-3">Reading Time</th>
                <th className="text-right px-5 py-3">Quiz Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-zinc-500 font-medium">No users found.</td>
                </tr>
              ) : leaderboard.map((user, idx) => {
                const rank = idx + 1;
                return (
                  <tr key={user.userId} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="px-5 py-4 text-center font-black">
                      {rank === 1 ? <Medal size={20} className="text-yellow-500 mx-auto" /> : 
                       rank === 2 ? <Medal size={20} className="text-zinc-400 mx-auto" /> :
                       rank === 3 ? <Medal size={20} className="text-amber-700 mx-auto" /> : 
                       <span className="text-zinc-400">#{rank}</span>}
                    </td>
                    <td className="px-5 py-4 font-bold text-zinc-900">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-black text-xs uppercase">
                          {user.email.substring(0, 2)}
                        </div>
                        <div>
                          <div className="truncate max-w-[200px]">{user.email}</div>
                          <div className="text-[10px] text-zinc-400 uppercase tracking-widest">{user.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-zinc-600 font-semibold tabular-nums">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-zinc-400" />
                        {formatDuration(user.readTimeSec)}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-sm font-black tabular-nums">
                        <Target size={14} />
                        {user.totalScore}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
