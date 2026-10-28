'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  User, 
  Mail, 
  Search, 
  ChevronRight, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  X,
  Save,
  Loader2,
  Calendar,
  Code,
  Target,
  ArrowLeft,
  ShieldCheck,
  Trash2,
  Sparkles,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UserProfile {
  user_id: string;
  email: string;
  role: string;
  current_role: string;
  years_of_experience: number;
  current_tech_stack: string[];
  primary_tech_stack: string[];
  secondary_tech_stack: string[];
  future_interests: string;
  ai_subscriptions?: string[];
  updated_at: string;
}

const PRESET_AI_SUBSCRIPTIONS = [
  'GitHub Copilot',
  'ChatGPT Plus',
  'Cursor AI',
  'Claude Pro',
  'Gemini Advanced',
  'v0 by Vercel',
];

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    role: 'user',
    current_role: '',
    years_of_experience: 0,
    primary_tech_stack: [] as string[],
    secondary_tech_stack: [] as string[],
    future_interests: '',
    ai_subscriptions: [] as string[]
  });
  const [primaryTechInput, setPrimaryTechInput] = useState('');
  const [secondaryTechInput, setSecondaryTechInput] = useState('');
  const [aiSubscriptionInput, setAiSubscriptionInput] = useState('');

  const supabase = createClient();
  
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  const handleUserClick = (user: UserProfile) => {
    setSelectedUser(user);
    setFormData({
      role: user.role || 'user',
      current_role: user.current_role || '',
      years_of_experience: user.years_of_experience || 0,
      primary_tech_stack: user.primary_tech_stack || [],
      secondary_tech_stack: user.secondary_tech_stack || [],
      future_interests: user.future_interests || '',
      ai_subscriptions: user.ai_subscriptions || []
    });
    setPrimaryTechInput('');
    setSecondaryTechInput('');
    setAiSubscriptionInput('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSaving(true);
    
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          email: selectedUser.email,
          role: formData.role,
          current_role: formData.current_role,
          years_of_experience: formData.years_of_experience,
          primary_tech_stack: formData.primary_tech_stack,
          secondary_tech_stack: formData.secondary_tech_stack,
          future_interests: formData.future_interests,
          ai_subscriptions: formData.ai_subscriptions,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update profile');
      }

      setToast({ message: 'Profile updated successfully!', type: 'success' });
      void fetchUsers();
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users?userId=${deletingUser.user_id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }

      setToast({ message: 'User deleted successfully', type: 'success' });
      setUsers((prev) => prev.filter((u) => u.user_id !== deletingUser.user_id));
      if (selectedUser?.user_id === deletingUser.user_id) {
        setSelectedUser(null);
      }
      setDeletingUser(null);
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setDeleting(false);
    }
  };

  const addPrimaryTechTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = primaryTechInput.trim().replace(/,$/, '');
      if (tag && !formData.primary_tech_stack.includes(tag)) {
        setFormData({
          ...formData,
          primary_tech_stack: [...formData.primary_tech_stack, tag]
        });
      }
      setPrimaryTechInput('');
    }
  };

  const removePrimaryTechTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      primary_tech_stack: formData.primary_tech_stack.filter(tag => tag !== tagToRemove)
    });
  };

  const addSecondaryTechTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = secondaryTechInput.trim().replace(/,$/, '');
      if (tag && !formData.secondary_tech_stack.includes(tag)) {
        setFormData({
          ...formData,
          secondary_tech_stack: [...formData.secondary_tech_stack, tag]
        });
      }
      setSecondaryTechInput('');
    }
  };

  const removeSecondaryTechTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      secondary_tech_stack: formData.secondary_tech_stack.filter(tag => tag !== tagToRemove)
    });
  };

  const togglePresetAiSubscription = (name: string) => {
    if (formData.ai_subscriptions.includes(name)) {
      setFormData({
        ...formData,
        ai_subscriptions: formData.ai_subscriptions.filter(s => s !== name)
      });
    } else {
      setFormData({
        ...formData,
        ai_subscriptions: [...formData.ai_subscriptions, name]
      });
    }
  };

  const addAiSubscriptionTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = aiSubscriptionInput.trim().replace(/,$/, '');
      if (tag && !formData.ai_subscriptions.includes(tag)) {
        setFormData({
          ...formData,
          ai_subscriptions: [...formData.ai_subscriptions, tag]
        });
      }
      setAiSubscriptionInput('');
    }
  };

  const removeAiSubscriptionTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      ai_subscriptions: formData.ai_subscriptions.filter(tag => tag !== tagToRemove)
    });
  };

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.future_interests?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isProfileComplete = (user: UserProfile) => {
    return user.years_of_experience !== null && user.primary_tech_stack?.length > 0;
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 space-y-4">
        <Loader2 className="w-8 h-8 text-[#34c4f2] animate-spin" />
        <p className="text-zinc-500 font-medium">Scanning user network...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        {!selectedUser ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-150 dark:border-zinc-800 pb-6">
              <div>
                <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">All Users</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm">Click on a user to view and manage their profile details.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text"
                  placeholder="Search by email or interests..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-sm text-zinc-900 dark:text-white transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-20 bg-zinc-50 dark:bg-zinc-900/40 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <User className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium tracking-tight">No users found</p>
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const complete = isProfileComplete(user);
                  return (
                    <div
                      key={user.user_id}
                      onClick={() => handleUserClick(user)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleUserClick(user);
                      }}
                      tabIndex={0}
                      role="button"
                      className="flex items-center justify-between p-5 bg-white dark:bg-[#1e1e1e] border border-zinc-150 dark:border-zinc-800 rounded-2xl hover:border-[#34c4f2]/30 hover:shadow-card transition-all text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                          complete ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 dark:text-emerald-400' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-400'
                        }`}>
                          <User size={24} />
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors">{user.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                              complete 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40' 
                                : 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40'
                            }`}>
                              {complete ? 'Profile Complete' : 'Profile Incomplete'}
                            </span>
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                              user.role === 'admin'
                                ? 'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/40'
                                : 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/40'
                            }`}>
                              {user.role === 'admin' ? 'Admin' : 'User'}
                            </span>
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-1">
                              <Clock size={10} />
                              {new Date(user.updated_at).toLocaleDateString()}
                            </span>
                          </div>

                          {user.ai_subscriptions && user.ai_subscriptions.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                <Sparkles size={11} className="text-[#34c4f2]" />
                                AI:
                              </span>
                              {user.ai_subscriptions.map((sub) => (
                                <span
                                  key={sub}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#34c4f2]/10 text-[#1b7393] dark:text-[#34c4f2] border border-[#34c4f2]/20"
                                >
                                  {sub}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium mt-1.5">
                              <Bot size={11} />
                              <span>No AI subscription assigned</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingUser(user);
                          }}
                          title="Delete User"
                          aria-label={`Delete ${user.email}`}
                          className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-all cursor-pointer opacity-70 group-hover:opacity-100"
                        >
                          <Trash2 size={16} />
                        </button>
                        <ChevronRight className="text-zinc-300 dark:text-zinc-600 group-hover:text-[#34c4f2] group-hover:translate-x-1 transition-all" size={20} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-8"
          >
            <button 
              onClick={() => setSelectedUser(null)}
              className="flex items-center gap-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-bold text-xs uppercase tracking-widest transition-colors mb-4 cursor-pointer"
            >
              <ArrowLeft size={14} />
              Back to User List
            </button>

            <div className="bg-white dark:bg-[#1e1e1e] p-8 rounded-3xl border border-zinc-150 dark:border-zinc-800 shadow-card transition-colors">
              <div className="mb-10 pb-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-1">Edit User Profile</h3>
                  <p className="text-zinc-500 dark:text-zinc-400 flex items-center gap-2 font-medium">
                    <Mail size={14} />
                    {selectedUser.email}
                  </p>
                </div>
                <div className="w-14 h-14 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 border border-zinc-100 dark:border-zinc-700">
                  <User size={28} />
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-8">
                <div className="grid grid-cols-1 gap-8">
                  {/* System Access Role */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                      <ShieldCheck size={14} />
                      System Access Role
                    </label>
                    <div className="flex bg-zinc-100 dark:bg-zinc-800/80 p-1.5 rounded-2xl max-w-md border border-zinc-200/60 dark:border-zinc-700 relative">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, role: 'user' })}
                        className={`flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                          formData.role === 'user'
                            ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20 font-bold scale-[1.02]'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-semibold'
                        }`}
                      >
                        <User size={16} />
                        <span>User access</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, role: 'admin' })}
                        className={`flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                          formData.role === 'admin'
                            ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20 font-bold scale-[1.02]'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-semibold'
                        }`}
                      >
                        <ShieldCheck size={16} />
                        <span>Admin access</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Current Role */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                        <User size={14} />
                        Current Role
                      </label>
                      <input 
                        type="text"
                        value={formData.current_role}
                        onChange={(e) => setFormData({ ...formData, current_role: e.target.value })}
                        placeholder="e.g. Senior Frontend Developer"
                        className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all"
                      />
                    </div>

                    {/* Years of Experience */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                        <Calendar size={14} />
                        Years of Experience
                      </label>
                      <input 
                        type="number"
                        min="0"
                        value={formData.years_of_experience}
                        onChange={(e) => setFormData({ ...formData, years_of_experience: Number.parseInt(e.target.value) || 0 })}
                        className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all font-mono"
                      />
                    </div>
                  </div>

                  {/* Current AI Subscriptions */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                        <Sparkles size={14} className="text-[#34c4f2]" />
                        Current AI Subscriptions
                      </label>
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">Used for Zoho task evaluation</span>
                    </div>

                    {/* Quick Preset Buttons */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 ml-1">Quick Select Tools:</p>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_AI_SUBSCRIPTIONS.map((preset) => {
                          const isSelected = formData.ai_subscriptions.includes(preset);
                          return (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => togglePresetAiSubscription(preset)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                                isSelected
                                  ? 'bg-[#34c4f2] text-zinc-950 border-[#34c4f2] shadow-sm font-black'
                                  : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-[#34c4f2]/50'
                              }`}
                            >
                              <Sparkles size={12} className={isSelected ? 'text-zinc-950' : 'text-[#34c4f2]'} />
                              <span>{preset}</span>
                              {isSelected && <span className="text-[10px] font-black">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom Input & Tag List */}
                    <div className="space-y-3 pt-1">
                      <input 
                        type="text"
                        value={aiSubscriptionInput}
                        onChange={(e) => setAiSubscriptionInput(e.target.value)}
                        onKeyDown={addAiSubscriptionTag}
                        placeholder="Add custom AI subscription (e.g. Claude Max, Midjourney) and press Enter"
                        className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {formData.ai_subscriptions.map((sub) => (
                            <motion.span
                              key={sub}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#34c4f2]/15 text-[#1b7393] dark:text-[#52d3fb] border border-[#34c4f2]/30 text-xs font-bold rounded-lg shadow-xs"
                            >
                              <Sparkles size={12} className="text-[#34c4f2]" />
                              <span>{sub}</span>
                              <button 
                                type="button" 
                                onClick={() => removeAiSubscriptionTag(sub)}
                                className="hover:scale-120 transition-transform cursor-pointer ml-0.5 text-zinc-500 hover:text-red-500"
                                aria-label={`Remove ${sub}`}
                              >
                                <X size={12} />
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                        {formData.ai_subscriptions.length === 0 && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest py-1">
                            No AI subscriptions configured
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Primary Tech Stack */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                      <Code size={14} />
                      Primary Tech Stack
                    </label>
                    <div className="space-y-4">
                      <input 
                        type="text"
                        value={primaryTechInput}
                        onChange={(e) => setPrimaryTechInput(e.target.value)}
                        onKeyDown={addPrimaryTechTag}
                        placeholder="Type a core skill and press Enter or comma"
                        className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all"
                      />
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {formData.primary_tech_stack.map(tag => (
                            <motion.span
                              key={tag}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#34c4f2] text-zinc-900 text-xs font-bold rounded-lg shadow-sm"
                            >
                              {tag}
                              <button 
                                type="button" 
                                onClick={() => removePrimaryTechTag(tag)}
                                className="hover:scale-120 transition-transform cursor-pointer"
                              >
                                <X size={12} />
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                        {formData.primary_tech_stack.length === 0 && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest py-2">No tags added yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Secondary Tech Stack */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                      <Code size={14} />
                      Secondary Tech Stack
                    </label>
                    <div className="space-y-4">
                      <input 
                        type="text"
                        value={secondaryTechInput}
                        onChange={(e) => setSecondaryTechInput(e.target.value)}
                        onKeyDown={addSecondaryTechTag}
                        placeholder="Type an additional skill and press Enter or comma"
                        className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all"
                      />
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {formData.secondary_tech_stack.map(tag => (
                            <motion.span
                              key={tag}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-lg shadow-sm"
                            >
                              {tag}
                              <button 
                                type="button" 
                                onClick={() => removeSecondaryTechTag(tag)}
                                className="hover:scale-120 transition-transform cursor-pointer"
                              >
                                <X size={12} />
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                        {formData.secondary_tech_stack.length === 0 && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-widest py-2">No tags added yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Future Interests */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
                      <Target size={14} />
                      Future Interests
                    </label>
                    <textarea 
                      rows={4}
                      value={formData.future_interests}
                      onChange={(e) => setFormData({ ...formData, future_interests: e.target.value })}
                      placeholder="e.g. Wants to learn AI/ML and cloud architecture"
                      className="w-full px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 dark:text-white transition-all resize-none font-medium"
                    />
                  </div>
                </div>

                <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-6">
                  <div className="flex-1">
                    <AnimatePresence>
                      {toast && (
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className={`flex items-center gap-2 font-bold text-sm ${
                            toast.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                          {toast.message}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDeletingUser(selectedUser)}
                      className="flex items-center gap-2 px-5 py-3.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer"
                    >
                      <Trash2 size={16} />
                      <span>Delete User</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="px-6 py-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-bold text-sm uppercase tracking-widest transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center justify-center gap-2 px-10 py-3.5 bg-[#34c4f2] text-zinc-900 font-black rounded-2xl shadow-xl shadow-[#34c4f2]/30 hover:bg-[#2db0db] hover:scale-[1.02] active:scale-[0.98] transition-all text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {saving ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Save size={18} />
                      )}
                      Save Profile
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !deleting && setDeletingUser(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 cursor-default"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-white">Delete User Account</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Are you sure you want to permanently delete user <strong className="text-zinc-900 dark:text-white">{deletingUser.email}</strong>? Their profile, roles, and associated session records will be removed.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDeleteUser}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>{deleting ? 'Deleting...' : 'Delete User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
