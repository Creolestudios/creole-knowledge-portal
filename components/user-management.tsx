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
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UserProfile {
  user_id: string;
  email: string;
  current_role: string;
  years_of_experience: number;
  current_tech_stack: string[];
  primary_tech_stack: string[];
  secondary_tech_stack: string[];
  future_interests: string;
  updated_at: string;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    current_role: '',
    years_of_experience: 0,
    primary_tech_stack: [] as string[],
    secondary_tech_stack: [] as string[],
    future_interests: ''
  });
  const [primaryTechInput, setPrimaryTechInput] = useState('');
  const [secondaryTechInput, setSecondaryTechInput] = useState('');

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
      current_role: user.current_role || '',
      years_of_experience: user.years_of_experience || 0,
      primary_tech_stack: user.primary_tech_stack || [],
      secondary_tech_stack: user.secondary_tech_stack || [],
      future_interests: user.future_interests || ''
    });
    setPrimaryTechInput('');
    setSecondaryTechInput('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSaving(true);
    
    try {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: selectedUser.user_id,
          email: selectedUser.email,
          current_role: formData.current_role,
          years_of_experience: formData.years_of_experience,
          primary_tech_stack: formData.primary_tech_stack,
          secondary_tech_stack: formData.secondary_tech_stack,
          future_interests: formData.future_interests,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      setToast({ message: 'Profile updated successfully!', type: 'success' });
      void fetchUsers();
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-100 pb-6">
              <div>
                <h2 className="text-2xl font-black text-zinc-900 tracking-tight">All Users</h2>
                <p className="text-zinc-500 text-sm">Click on a user to view and manage their profile details.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input 
                  type="text"
                  placeholder="Search by email or interests..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-sm transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-20 bg-zinc-50 rounded-3xl border border-dashed border-zinc-200">
                  <User className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                  <p className="text-zinc-500 font-medium tracking-tight">No users found</p>
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const complete = isProfileComplete(user);
                  return (
                    <button
                      key={user.user_id}
                      onClick={() => handleUserClick(user)}
                      className="flex items-center justify-between p-5 bg-white border border-zinc-100 rounded-2xl hover:border-[#34c4f2]/30 hover:shadow-card transition-all text-left group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                          complete ? 'bg-emerald-50 text-emerald-500' : 'bg-zinc-50 text-zinc-400'
                        }`}>
                          <User size={24} />
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 group-hover:text-[#34c4f2] transition-colors">{user.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                              complete 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                : 'bg-amber-50 text-amber-600 border-amber-100'
                            }`}>
                              {complete ? 'Profile Complete' : 'Profile Incomplete'}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest flex items-center gap-1">
                              <Clock size={10} />
                              {new Date(user.updated_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="text-zinc-300 group-hover:text-[#34c4f2] group-hover:translate-x-1 transition-all" size={20} />
                    </button>
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
              className="flex items-center gap-2 text-zinc-400 hover:text-zinc-600 font-bold text-xs uppercase tracking-widest transition-colors mb-4"
            >
              <ArrowLeft size={14} />
              Back to User List
            </button>

            <div className="bg-white p-8 rounded-3xl border border-zinc-100 shadow-card">
              <div className="mb-10 pb-6 border-b border-zinc-50 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-zinc-900 tracking-tight mb-1">Edit User Profile</h3>
                  <p className="text-zinc-500 flex items-center gap-2 font-medium">
                    <Mail size={14} />
                    {selectedUser.email}
                  </p>
                </div>
                <div className="w-14 h-14 bg-zinc-50 rounded-2xl flex items-center justify-center text-zinc-400 border border-zinc-100">
                  <User size={28} />
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-8">
                <div className="grid grid-cols-1 gap-8">
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
                        className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 transition-all"
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
                        onChange={(e) => setFormData({ ...formData, years_of_experience: parseInt(e.target.value) || 0 })}
                        className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 transition-all font-mono"
                      />
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
                        className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 transition-all"
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
                                className="hover:scale-120 transition-transform"
                              >
                                <X size={12} />
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                        {formData.primary_tech_stack.length === 0 && (
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-widest py-2">No tags added yet</span>
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
                        className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 transition-all"
                      />
                      <div className="flex flex-wrap gap-2">
                        <AnimatePresence>
                          {formData.secondary_tech_stack.map(tag => (
                            <motion.span
                              key={tag}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-200 text-zinc-700 text-xs font-bold rounded-lg shadow-sm"
                            >
                              {tag}
                              <button 
                                type="button" 
                                onClick={() => removeSecondaryTechTag(tag)}
                                className="hover:scale-120 transition-transform"
                              >
                                <X size={12} />
                              </button>
                            </motion.span>
                          ))}
                        </AnimatePresence>
                        {formData.secondary_tech_stack.length === 0 && (
                          <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-widest py-2">No tags added yet</span>
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
                      className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2]/20 focus:border-[#34c4f2] text-zinc-900 transition-all resize-none font-medium"
                    />
                  </div>
                </div>

                <div className="pt-8 border-t border-zinc-50 flex items-center justify-between gap-6">
                  <div className="flex-1">
                    <AnimatePresence>
                      {toast && (
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className={`flex items-center gap-2 font-bold text-sm ${
                            toast.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                          {toast.message}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="px-6 py-3.5 text-zinc-400 hover:text-zinc-600 font-bold text-sm uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center justify-center gap-2 px-10 py-3.5 bg-[#34c4f2] text-zinc-900 font-black rounded-2xl shadow-xl shadow-[#34c4f2]/30 hover:bg-[#2db0db] hover:scale-[1.02] active:scale-[0.98] transition-all text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
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
    </div>
  );
}
