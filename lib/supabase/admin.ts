import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing env.SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Verifies the current request is from an authenticated admin user.
 * Returns the user's ID on success, or `null` if unauthorized.
 */
export async function requireAdminUser(): Promise<{ userId: string } | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('[requireAdminUser] Auth error:', authError.message);
      return null;
    }

    if (!user) return null;

    const { data: callingProfile, error: callError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (callError || callingProfile?.role !== 'admin') return null;

    return { userId: user.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[requireAdminUser] Unexpected error (possible Supabase connectivity issue):', msg);
    return null;
  }
}
