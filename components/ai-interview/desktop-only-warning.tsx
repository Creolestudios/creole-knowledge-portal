'use client';

import { useState } from 'react';
import { Laptop, Monitor, Smartphone, Tablet, AlertTriangle, Copy, Check } from 'lucide-react';

export interface DesktopOnlyWarningProps {
  customMessage?: string;
}

export function DesktopOnlyWarning({ customMessage }: DesktopOnlyWarningProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }).catch(() => {
        // Fallback
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#121212] px-4 py-8 transition-colors">
      <div className="max-w-md w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-zinc-200 dark:border-[#4a4a4a] p-6 sm:p-8 text-center space-y-6">
        
        {/* Device Badges Illustration */}
        <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
          <div className="w-16 h-16 bg-amber-500/10 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-700/60 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Monitor className="w-8 h-8" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-700 rounded-full flex items-center justify-center text-red-600 dark:text-red-400">
            <Smartphone className="w-4 h-4" />
          </div>
        </div>

        {/* Title & Warning Header */}
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            Desktop Device Required
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
            Laptop or Desktop Required
          </h1>
          <p className="text-sm text-zinc-600 dark:text-[#9f9f9f] leading-relaxed">
            {customMessage || (
              <>
                You are trying to access this interview from a mobile phone or tablet. This interview requires a <strong>laptop or desktop computer</strong> to proceed.
              </>
            )}
          </p>
        </div>

        {/* Technical Reasons Box */}
        <div className="bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-xl p-4 text-xs text-left space-y-2.5">
          <div className="font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
            <Laptop className="w-4 h-4 text-[#34c4f2]" />
            <span>Why is a computer required?</span>
          </div>
          <ul className="space-y-1.5 text-zinc-600 dark:text-[#9f9f9f]">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>Full-screen sharing and live proctoring verification</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>Continuous dual audio and camera face tracking</span>
            </li>
            <li className="flex items-start gap-2 text-red-500 font-medium">
              <span className="font-bold">✗</span>
              <span>Mobile and tablet browsers do not support automated screen proctoring</span>
            </li>
          </ul>
        </div>

        {/* Copy Link Button */}
        <div className="space-y-2 pt-1">
          <p className="text-xs text-zinc-500 dark:text-[#9f9f9f]">
            Please copy this interview link and open it on your laptop or desktop browser (Google Chrome, Microsoft Edge, or Brave):
          </p>
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full py-3 px-4 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-zinc-900" />
                <span>Interview Link Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Interview Link</span>
              </>
            )}
          </button>
        </div>

      </div>
    </main>
  );
}
