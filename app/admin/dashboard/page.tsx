'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Trash2,
  Save,
  LogOut,
  Globe,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Home,
  ShieldAlert,
} from 'lucide-react';

import UserManagement from '@/components/user-management';
import SubmissionsModeration from '@/components/submissions-moderation';

const ADMIN_EMAIL = 'priya.dhanani@creolestudios.com';

type Tab = 'sources' | 'users' | 'submissions';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('sources');
  const [urls, setUrls] = useState<string[]>(['']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [user, setUser] = useState<any>(null);

  const supabase = createClient();
  const router = useRouter();

  const fetchSources = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('blog_sources')
        .select('url')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setUrls(data.map((item) => item.url));
      }
    } catch (err: any) {
      console.error('Error fetching sources:', err);
      // If table doesn't exist yet, we just start with empty
      if (err.code !== '42P01') {
        setError('Failed to load existing sources.');
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL) {
        router.push('/');
        return;
      }

      // Fetch user profile role dynamically
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (error || !profile || profile.role !== 'admin') {
        router.push('/');
        return;
      }

      setUser(user);
      fetchSources();
    };

    checkUser();
  }, [supabase, router, fetchSources]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const addUrlField = () => {
    if (urls.length < 10) {
      setUrls([...urls, '']);
    }
  };

  const removeUrlField = (index: number) => {
    const newUrls = urls.filter((_, i) => i !== index);
    setUrls(newUrls.length > 0 ? newUrls : ['']);
  };

  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const validateUrls = () => {
    const filtered = urls.filter((u) => u.trim() !== '');
    if (filtered.length === 0) {
      throw new Error('At least one blog source URL is required.');
    }

    for (const url of filtered) {
      try {
        new URL(url);
      } catch (e) {
        throw new Error(`Invalid URL format: ${url}`);
      }
    }
    return filtered;
  };

  const saveSources = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const validatedUrls = validateUrls();

      // Delete existing
      const { error: deleteError } = await supabase
        .from('blog_sources')
        .delete()
        .eq('added_by', user.id);

      if (deleteError) throw deleteError;

      // Insert new
      const { error: insertError } = await supabase.from('blog_sources').insert(
        validatedUrls.map((url) => ({
          url,
          added_by: user.id,
        }))
      );

      if (insertError) throw insertError;

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error saving sources:', err);
      setError(err.message || 'Failed to save sources. Ensure the database table exists.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-[#34c4f2] animate-spin" />
        <p className="text-zinc-500 font-medium animate-pulse">Initializing Portal Control...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#fafafa] flex">
      {/* Sidebar */}
      <aside className="w-72 bg-zinc-900 text-white min-h-screen flex flex-col border-r border-zinc-800 fixed left-0 top-0 bottom-0 z-10 hidden md:flex">
        {/* Logo area */}
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center space-x-4 mb-4">
            <div className="w-10 h-10 bg-[#34c4f2] rounded-lg flex items-center justify-center shrink-0">
              <ShieldCheck className="text-white w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold tracking-tight">Admin Console</h1>
              </div>
              <span className="inline-block mt-1 bg-[#34c4f2]/20 text-[#34c4f2] text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-[#34c4f2]/30">
                Secure Access
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-3 mt-2">
            Menu
          </div>
          <button
            onClick={() => setActiveTab('sources')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'sources'
                ? 'bg-[#34c4f2] text-zinc-900 shadow-lg shadow-[#34c4f2]/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Globe className="w-5 h-5" />
            <span>Blog Sources</span>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'users'
                ? 'bg-[#34c4f2] text-zinc-900 shadow-lg shadow-[#34c4f2]/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Users</span>
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'submissions'
                ? 'bg-[#34c4f2] text-zinc-900 shadow-lg shadow-[#34c4f2]/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <ShieldAlert className="w-5 h-5" />
            <span>Submissions</span>
          </button>

          <div className="h-px bg-zinc-800 my-4" />

          <button
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <Home className="w-5 h-5" />
            <span>User Dashboard</span>
          </button>
        </nav>

        {/* User / Sign Out */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50">
          <div className="px-3 mb-4">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
              Logged In As
            </p>
            <p className="text-sm font-medium text-zinc-300 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 py-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all text-sm font-bold group"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:ml-72 flex flex-col min-h-screen">
        {/* Mobile Header (visible only on small screens) */}
        <header className="md:hidden bg-zinc-900 text-white p-4 flex items-center justify-between shadow-md z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#34c4f2] rounded-md flex items-center justify-center">
              <ShieldCheck className="text-white w-4 h-4" />
            </div>
            <h1 className="font-bold text-sm">Admin Console</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('sources')}
              className={`p-2 rounded-md ${activeTab === 'sources' ? 'bg-[#34c4f2] text-zinc-900' : 'text-zinc-400'}`}
            >
              <Globe className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`p-2 rounded-md ${activeTab === 'users' ? 'bg-[#34c4f2] text-zinc-900' : 'text-zinc-400'}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
            <button
              onClick={() => setActiveTab('submissions')}
              className={`p-2 rounded-md ${activeTab === 'submissions' ? 'bg-[#34c4f2] text-zinc-900' : 'text-zinc-400'}`}
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
            <button
              onClick={handleSignOut}
              className="p-2 text-zinc-400 hover:text-white ml-2 border-l border-zinc-700 pl-4"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tab Content */}
        <div className="p-6 md:p-10 lg:p-12 w-full max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'sources' ? (
              <motion.div
                key="sources"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-2xl shadow-card border border-zinc-100 overflow-hidden"
              >
                {/* Section Header */}
                <div className="p-8 border-b border-zinc-50">
                  <div className="flex items-center space-x-3 mb-2">
                    <div className="p-2 bg-[#34c4f2]/10 rounded-lg">
                      <Globe className="text-[#34c4f2] w-5 h-5" />
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-900">Manage Blog Sources</h2>
                  </div>
                  <p className="text-zinc-500 text-sm leading-relaxed max-w-2xl">
                    Add up to 10 trending blog site URLs. These will be used to fetch and recommend
                    high-quality technical content to your users every morning.
                  </p>
                </div>

                {/* Section Body */}
                <div className="p-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                      Source URL List
                    </span>
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${
                        urls.length >= 10
                          ? 'bg-red-50 text-red-500 border-red-100'
                          : 'bg-zinc-50 text-zinc-500 border-zinc-100'
                      }`}
                    >
                      {urls.length} / 10 URLs Added
                    </span>
                  </div>

                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {urls.map((url, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="flex items-center space-x-3 group"
                        >
                          <div className="relative flex-grow">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-[#34c4f2] transition-colors">
                              <ExternalLink className="w-4 h-4" />
                            </div>
                            <input
                              type="url"
                              value={url}
                              onChange={(e) => updateUrl(index, e.target.value)}
                              placeholder="https://example.com/blog"
                              className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] focus:border-transparent transition-all text-zinc-900 font-medium placeholder:text-zinc-300 placeholder:font-normal"
                            />
                          </div>
                          <button
                            onClick={() => removeUrlField(index)}
                            className="p-3.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                            title="Remove source"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  <button
                    onClick={addUrlField}
                    disabled={urls.length >= 10}
                    className="w-full py-4 border-2 border-dashed border-zinc-100 rounded-2xl flex items-center justify-center space-x-2 text-zinc-400 hover:text-[#34c4f2] hover:border-[#34c4f2]/30 hover:bg-[#34c4f2]/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                    <span className="font-bold text-sm uppercase tracking-widest">
                      Add Another URL
                    </span>
                  </button>
                </div>

                {/* Section Footer */}
                <div className="p-8 bg-zinc-50/50 border-t border-zinc-100">
                  <div className="flex flex-col space-y-4">
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100"
                        >
                          <AlertCircle className="w-5 h-5 flex-shrink-0" />
                          <p className="font-medium">{error}</p>
                        </motion.div>
                      )}

                      {success && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center space-x-2 p-4 text-sm text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100"
                        >
                          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                          <p className="font-bold">Sources saved successfully! System updated.</p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button
                      onClick={saveSources}
                      disabled={saving}
                      className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-5 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
                    >
                      {saving ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <>
                          <Save className="w-5 h-5" />
                          <span>Save Sources</span>
                        </>
                      )}
                    </button>
                  </div>

                  <p className="mt-6 text-center text-[10px] text-zinc-400 font-mono uppercase tracking-[0.2em]">
                    Authorized Administrative Action Node
                  </p>
                </div>
              </motion.div>
            ) : activeTab === 'users' ? (
              <motion.div
                key="users"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                <UserManagement />
              </motion.div>
            ) : (
              <motion.div
                key="submissions"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                <SubmissionsModeration />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
