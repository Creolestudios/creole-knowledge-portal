import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function LoadingReportDetails() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] py-8 px-4 sm:px-6 lg:px-8" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation Breadcrumb Skeleton */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/reports"
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="h-5 w-32 bg-zinc-200 rounded-lg animate-pulse" />
        </div>

        {/* Candidate Profile Header Skeleton */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-zinc-200 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-200 animate-pulse flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[#34c4f2] animate-spin" />
            </div>
            <div className="space-y-2">
              <div className="h-7 w-48 bg-zinc-200 rounded-xl animate-pulse" />
              <div className="h-4 w-36 bg-zinc-100 rounded-lg animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-28 bg-zinc-100 rounded-xl animate-pulse" />
            <div className="h-10 w-36 bg-zinc-100 rounded-xl animate-pulse" />
          </div>
        </div>

        {/* Loading Indicator Banner */}
        <div className="bg-[#34c4f2]/10 border border-[#34c4f2]/30 rounded-2xl p-4 flex items-center justify-center gap-3 text-sm font-bold text-[#1689aa]">
          <Loader2 className="w-5 h-5 animate-spin text-[#1689aa]" />
          <span>Opening candidate evaluation details and proctoring metrics…</span>
        </div>

        {/* Scores & Metrics Grid Skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-card space-y-3">
              <div className="h-4 w-20 bg-zinc-100 rounded animate-pulse" />
              <div className="h-10 w-24 bg-zinc-200 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>

        {/* Questions & Transcript Section Skeleton */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-zinc-200 shadow-card space-y-4">
          <div className="h-6 w-40 bg-zinc-200 rounded-lg animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-2xl border border-zinc-100 bg-zinc-50/50 space-y-2">
                <div className="h-4 w-3/4 bg-zinc-200 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-zinc-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
