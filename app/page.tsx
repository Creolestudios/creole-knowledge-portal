'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    // Check for error in URL - moved inside setTimeout to avoid synchronous cascading render warning
    // and ensuring it runs after the initial mount state is set
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get('error');
      const errorCode = params.get('error_code');

      if (errorParam) {
        let message = decodeURIComponent(errorParam);
        if (errorCode === 'otp_expired' || message.toLowerCase().includes('expired')) {
          message = 'Verification link expired or already used. Please request a new link.';
        }
        setError(message);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const supabase = createClient();

  const getAuthRedirectOrigin = () => {
    if (typeof window === 'undefined') return '';
    const isLocalhost = window.location.hostname === 'localhost';
    if (isLocalhost) return window.location.origin;

    const pathname = window.location.pathname;
    const basePath = pathname.includes('/creole-knowledge-portal') ? '/creole-knowledge-portal' : '';
    return `${window.location.origin}${basePath}`;
  };

  const handleOAuthLogin = async (provider: 'google' | 'apple') => {
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${getAuthRedirectOrigin()}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to initialize ${provider} login`);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${getAuthRedirectOrigin()}/auth/callback`,
        },
      });

      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) {
    return <div className="min-h-screen bg-black" />; // Static placeholder for initial render
  }

  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-white font-sans">
      {/* Left Column - Branding & Atmosphere */}
      <section className="relative w-full md:w-1/2 bg-[#0a0a0a] flex flex-col justify-center px-10 md:px-16 py-20 text-white overflow-hidden min-h-[400px]">
        {/* Decorative Geometric Background */}
        <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%]" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #34c4f2 0%, transparent 40%), radial-gradient(circle at 80% 70%, #34c4f2 0%, transparent 30%)', filter: 'blur(80px)' }} />
          <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(52, 196, 242, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(52, 196, 242, 0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10 max-w-lg"
        >
          <div className="flex items-center space-x-3 mb-8">
            <div className="w-12 h-12 rounded-lg bg-brand flex items-center justify-center shadow-brand">
              <BookOpen className="h-7 w-7 text-black" />
            </div>
            <h2 className="text-brand uppercase tracking-[0.2em] font-bold text-xs">Internal Utility</h2>
          </div>

          <h1 id="portal-title" className="text-white text-5xl md:text-6xl font-extrabold tracking-tight leading-tight mb-6">
            Creole <br />
            <span className="text-brand">Knowledge</span> <br />
            Portal
          </h1>

          <p className="text-zinc-400 text-lg max-w-sm leading-relaxed">
            Your personalized morning dose of industry insights and internal wisdom, delivered straight to your workstation.
          </p>
        </motion.div>

      </section>

      {/* Right Column - Authentication Card */}
      <section className="w-full md:w-1/2 flex flex-col justify-center items-center bg-[#f8f9fa] border-l border-zinc-200 p-6 md:p-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-md"
        >
          <div className="bg-white p-8 md:p-12 rounded-2xl shadow-card border border-zinc-100">
            <div className="mb-10">
              <h3 id="signin-heading" className="text-2xl font-bold text-zinc-900 mb-2">Welcome Back</h3>
              <p className="text-zinc-500 text-sm">Sign in to access your knowledge network.</p>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <button
                  id="google-login-button"
                  onClick={() => handleOAuthLogin('google')}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors shadow-sm text-zinc-700 font-semibold text-sm active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81.38z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </button>

                {/* <button
                  id="apple-login-button"
                  onClick={() => handleOAuthLogin('apple')}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black border border-black rounded-lg hover:bg-zinc-900 transition-colors shadow-sm text-white font-semibold text-sm active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.05 12.08c-.03-3.01 2.46-4.45 2.57-4.52-1.4-2.05-3.58-2.33-4.35-2.36-1.85-.19-3.61 1.09-4.55 1.09-.94 0-2.39-1.06-3.93-1.03-2.02.03-3.88 1.17-4.92 2.98-2.1 3.64-.54 9.03 1.51 11.98 1 1.44 2.19 3.06 3.76 3 1.51-.06 2.08-.97 3.9-.97s2.34.97 3.93.94c1.62-.03 2.65-1.47 3.64-2.92 1.15-1.68 1.62-3.31 1.65-3.39-.04-.02-3.17-1.22-3.21-4.8zM14.06 3.25c.83-1.01 1.39-2.41 1.24-3.8-1.2.05-2.65.8-3.51 1.81-.77.89-1.44 2.32-1.26 3.68 1.34.1 2.7-.68 3.53-1.69z" />
                  </svg>
                  Continue with Apple
                </button> */}
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-zinc-100"></span>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-4 text-zinc-400 font-bold tracking-widest">or</span>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 ml-1">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="name@creole.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all text-zinc-900 placeholder:text-zinc-300"
                    disabled={loading || success}
                  />
                </div>

                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p>{error}</p>
                    </motion.div>
                  )}

                  {success && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-4 text-sm text-emerald-600 bg-emerald-50 rounded-lg border border-emerald-100"
                    >
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                      <p className="font-medium">Check your inbox — a login link has been sent!</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  id="submit-button"
                  type="submit"
                  disabled={loading || success}
                  className="w-full bg-brand hover:bg-brand-hover text-black font-bold py-3.5 rounded-lg transition-all shadow-lg shadow-brand/20 flex items-center justify-center space-x-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : success ? (
                    'Link Sent'
                  ) : (
                    <>
                      <span>Send Magic Link</span>
                      <motion.svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        animate={{ x: [0, 3, 0] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </motion.svg>
                    </>
                  )}
                </button>
              </form>
            </div>

            <p className="mt-8 text-center text-[10px] text-zinc-400 leading-relaxed">
              By signing in, you agree to our Internal Data Handling Policies and Security Protocols.
            </p>
          </div>

        </motion.div>
      </section>
    </main>
  );
}
