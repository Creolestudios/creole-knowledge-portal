import { User } from 'lucide-react';
import type { ReactNode } from 'react';

interface DashboardHeaderBarProps {
  icon: ReactNode;
  title: string;
  user: { email?: string | null } | null;
}

/**
 * Sticky top header shared across dashboard sub-pages: page title/icon on
 * the left, current user's name/domain + avatar on the right.
 */
export default function DashboardHeaderBar({ icon, title, user }: DashboardHeaderBarProps) {
  return (
    <header className="h-20 bg-white border-b border-zinc-200 px-10 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-4 flex-1">
        <h1 className="text-xl font-extrabold text-zinc-950 flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </h1>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">
              {user?.email?.split('@')[0]}
            </p>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
              {user?.email?.split('@')[1]}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-600">
            <User size={20} />
          </div>
        </div>
      </div>
    </header>
  );
}
