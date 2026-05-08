'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, 
  Briefcase, 
  Calendar, 
  Code, 
  Globe, 
  Target, 
  Save, 
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';

const DOMAINS = [
  'Web Development',
  'Mobile Development',
  'DevOps / Cloud',
  'Data Science / AI',
  'UI / UX Design',
  'Backend / Systems',
  'Other'
];

interface ProfileData {
  name: string;
  email: string;
  role: string;
  years_of_experience: number;
  current_tech_stack: string[];
  primary_domain: string;
  future_learning_goals: string;
}

export default function ProfileForm() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [techInput, setTechInput] = useState('');
  
  const [formData, setFormData] = useState<ProfileData>({
    name: '',
    email: '',
    role: '',
    years_of_experience: 0,
    current_tech_stack: [],
    primary_domain: 'Web Development',
    future_learning_goals: ''
  });

  const [initialData, setInitialData] = useState<ProfileData | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        setFormData(prev => ({ ...prev, email: user.email || '' }));

        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          const profile = {
            name: data.name || '',
            email: user.email || '',
            role: data.role || '',
            years_of_experience: data.years_of_experience || 0,
            current_tech_stack: data.current_tech_stack || [],
            primary_domain: data.primary_domain || 'Web Development',
            future_learning_goals: data.future_learning_goals || ''
          };
          setFormData(profile);
          setInitialData(profile);
        }
      } catch (err: any) {
        console.error('Error fetching profile:', err);
        setError('Failed to load profile data.');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          name: formData.name,
          email: formData.email,
          role: formData.role,
          years_of_experience: formData.years_of_experience,
          current_tech_stack: formData.current_tech_stack,
          primary_domain: formData.primary_domain,
          future_learning_goals: formData.future_learning_goals,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      setSuccess(true);
      setInitialData(JSON.parse(JSON.stringify(formData)));
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error saving profile:', err);
      setError(err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (initialData) {
      setFormData(JSON.parse(JSON.stringify(initialData)));
    } else {
      setFormData(prev => ({
        ...prev,
        name: '',
        role: '',
        years_of_experience: 0,
        current_tech_stack: [],
        primary_domain: 'Web Development',
        future_learning_goals: ''
      }));
    }
  };

  const addTechTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = techInput.trim().replace(/,$/, '');
      if (tag && !formData.current_tech_stack.includes(tag)) {
        setFormData({
          ...formData,
          current_tech_stack: [...formData.current_tech_stack, tag]
        });
      }
      setTechInput('');
    }
  };

  const removeTechTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      current_tech_stack: formData.current_tech_stack.filter(tag => tag !== tagToRemove)
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-zinc-500 font-medium">Synchronizing profile data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h2 className="text-3xl font-black text-zinc-900 tracking-tight mb-2">Your Profile</h2>
        <p className="text-zinc-500">Help us personalize your morning blog recommendations. All fields are optional.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8 bg-white p-8 rounded-[32px] border border-zinc-100 shadow-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Name */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <User size={14} />
              Full Name
            </label>
            <input 
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all"
            />
          </div>

          {/* Email (Read Only) */}
          <div className="space-y-2 opacity-70">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <Globe size={14} />
              Email Address (Fixed)
            </label>
            <input 
              type="text"
              value={formData.email}
              readOnly
              className="w-full px-5 py-3.5 bg-zinc-100 border border-zinc-200 rounded-2xl cursor-not-allowed text-zinc-500 font-medium"
            />
          </div>

          {/* Role */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <Briefcase size={14} />
              Current Role
            </label>
            <input 
              type="text"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="Frontend Developer"
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all"
            />
          </div>

          {/* Experience */}
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
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all font-mono"
            />
          </div>

          {/* Tech Stack */}
          <div className="space-y-2 md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <Code size={14} />
              Current Tech Stack
            </label>
            <div className="space-y-4">
              <input 
                type="text"
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                onKeyDown={addTechTag}
                placeholder="Type a skill (e.g. React) and press Enter or comma"
                className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all"
              />
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {formData.current_tech_stack.map(tag => (
                    <motion.span
                      key={tag}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand text-black text-xs font-bold rounded-full shadow-sm"
                    >
                      {tag}
                      <button 
                        type="button" 
                        onClick={() => removeTechTag(tag)}
                        className="hover:scale-120 transition-transform"
                      >
                        <X size={12} />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
                {formData.current_tech_stack.length === 0 && (
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-widest py-2">No tags added yet</span>
                )}
              </div>
            </div>
          </div>

          {/* Primary Domain */}
          <div className="space-y-2 md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <Target size={14} />
              Primary Domain
            </label>
            <select
              value={formData.primary_domain}
              onChange={(e) => setFormData({ ...formData, primary_domain: e.target.value })}
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all appearance-none cursor-pointer"
            >
              {DOMAINS.map(domain => (
                <option key={domain} value={domain}>{domain}</option>
              ))}
            </select>
          </div>

          {/* Learning Goals */}
          <div className="space-y-2 md:col-span-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 ml-1">
              <Target size={14} />
              Future Learning Goals
            </label>
            <textarea 
              rows={4}
              value={formData.future_learning_goals}
              onChange={(e) => setFormData({ ...formData, future_learning_goals: e.target.value })}
              placeholder="e.g. Learn Rust and explore AI/ML integration in production systems"
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-zinc-900 transition-all resize-none"
            />
          </div>
        </div>

        <div className="pt-8 border-t border-zinc-50 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-emerald-600 font-bold text-sm"
                >
                  <CheckCircle2 size={18} />
                  Profile saved successfully!
                </motion.div>
              )}
              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-red-600 font-bold text-sm"
                >
                  <AlertCircle size={18} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3.5 text-zinc-400 hover:text-zinc-600 font-bold text-sm transition-all"
            >
              <RotateCcw size={16} />
              Clear
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-10 py-3.5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-[1.02] active:scale-[0.98] transition-all text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
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
  );
}
