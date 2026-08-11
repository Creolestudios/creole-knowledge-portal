'use client';

import { Eye } from 'lucide-react';
import DashboardShell from './DashboardShell';

/**
 * Auth-free, mock-data preview of the user dashboard for demos / sharing.
 * Renders the shared `DashboardShell` with a demo identity and a preview badge
 * in place of the logout button. Lives under `/preview` (outside the middleware
 * auth matcher). Demo only — shows mock fixtures, no PII.
 */
export default function PreviewDashboard() {
  return (
    <DashboardShell
      displayName="Demo User"
      displayDomain="creolestudios.com"
      footer={
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand/10 border border-brand/20 rounded-lg text-brand text-[10px] font-bold uppercase tracking-widest">
          <Eye size={12} /> Preview Mode
        </div>
      }
    />
  );
}
