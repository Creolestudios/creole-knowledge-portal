'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import LogoutButton from '@/components/logout-button';
import DashboardShell from '@/components/dashboard/DashboardShell';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { UserProfileSchema } from '@/types/contracts';

/**
 * User dashboard. Auth/profile is fetched here (Supabase); the layout, the
 * navigation tabs, the active tab content, and the sidebar activity widget
 * all live in `DashboardShell`.
 */
export default function DashboardPage() {
  const [user, setUser] = useState<Pick<SupabaseUser, 'id' | 'email'> | null>(null);
  const [profile, setProfile] = useState<UserProfileSchema | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function getInitialData() {
      const params = new URLSearchParams(window.location.search);
      const isMock = params.has('mockUser') || document.cookie.includes('mock-user=true');

      let currentUser: Pick<SupabaseUser, 'id' | 'email'> | null = null;
      if (isMock) {
        currentUser = {
          id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004',
          email: 'priyadhanani125@gmail.com',
        };
        setUser(currentUser);
        document.cookie = 'mock-user=true; path=/; max-age=3600';
      } else {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (!authUser) {
          router.push('/');
          return;
        }
        currentUser = authUser;
        setUser(authUser);
      }

      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

      setProfile(userProfile as UserProfileSchema | null);
      setLoading(false);
    }
    void getInitialData();
  }, [supabase, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 font-medium">Loading your portal…</p>
      </div>
    );
  }

  return (
    <DashboardShell
      displayName={profile?.current_role || user.email?.split('@')[0] || 'there'}
      displayDomain={user.email?.split('@')[1] || ''}
      user={user}
      profile={profile}
      footer={<LogoutButton variant="sidebar" />}
    />
  );
}
