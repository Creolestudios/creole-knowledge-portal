'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

interface LogoutButtonProps {
  variant?: 'default' | 'sidebar';
}

export default function LogoutButton({ variant = 'default' }: LogoutButtonProps) {
  const supabase = createClient();
  const router = useRouter();

  const handleLogout = async () => {
    // Clear mock session and gamification cookies
    document.cookie = "mock-user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "mock_gamification_stats=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  if (variant === 'sidebar') {
    return (
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 py-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all text-sm font-bold group"
      >
        <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span>Sign Out</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-red-600 transition-colors"
    >
      <LogOut size={16} />
      <span>Sign Out</span>
    </button>
  );
}
