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
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  if (variant === 'sidebar') {
    return (
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-4 py-3 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl w-full transition-colors font-medium border border-transparent hover:border-red-500/20"
      >
        <LogOut size={20} />
        <span>Logout</span>
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
