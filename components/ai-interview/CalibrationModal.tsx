'use client';

import { useEffect } from 'react';
import { Target, CheckCircle2 } from 'lucide-react';

interface CalibrationModalProps {
  onComplete: () => void;
  calibrationProgress: number; // 0 to 15 samples
}

export function CalibrationModal({ calibrationProgress, onComplete }: CalibrationModalProps) {
  const progressPct = Math.min(100, Math.round((calibrationProgress / 15) * 100));
  const dotsCompleted = progressPct >= 100;

  // Auto-advance to interview stage once calibration is complete
  useEffect(() => {
    if (!dotsCompleted) return;
    const timer = setTimeout(onComplete, 800); // brief pause so user sees 100%
    return () => clearTimeout(timer);
  }, [dotsCompleted, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-md px-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-zinc-100 text-center space-y-6 animate-in fade-in zoom-in duration-200">
        <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-2xl flex items-center justify-center mx-auto text-[#34c4f2]">
          <Target className="w-6 h-6 animate-pulse" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-zinc-900">Webcam &amp; Eye Calibration</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Please sit comfortably and <strong className="text-zinc-800">look directly at the center dot</strong> for 3 seconds so we can calibrate your baseline position.
          </p>
        </div>

        {/* Center Target Dot Animation */}
        <div className="py-6 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-[#34c4f2]/20 animate-ping absolute" />
            <div className="w-8 h-8 rounded-full bg-[#34c4f2] shadow-lg shadow-[#34c4f2]/50 flex items-center justify-center text-white font-bold text-xs">
              •
            </div>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-zinc-500">
            <span>Calibrating baseline...</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#34c4f2] transition-all duration-200 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {dotsCompleted && (
          <div className="flex items-center justify-center space-x-2 text-emerald-600 text-sm font-semibold pt-2">
            <CheckCircle2 className="w-5 h-5" />
            <span>Calibration successful!</span>
          </div>
        )}
      </div>
    </div>
  );
}
