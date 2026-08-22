import { getPublicOriginFromUrl, withBasePath } from '@/lib/auth-urls';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorCode = requestUrl.searchParams.get('error_code');
  const errorDescription = requestUrl.searchParams.get('error_description');

  const origin = getPublicOriginFromUrl(requestUrl);
  const next = requestUrl.searchParams.get('next') ?? '/dashboard';

  const redirectTo = (path: string) =>
    NextResponse.redirect(`${origin}${withBasePath(path)}`);

  console.log(`[Auth Callback] URL: ${request.url}`);
  const allCookies = request.headers.get('cookie') || '';
  const cookieNames = allCookies.split(';').map(c => c.split('=')[0].trim());
  const authCookies = cookieNames.filter(name => name.includes('auth-token'));
  console.log(`[Auth Callback] Auth Cookies: ${authCookies.join(', ') || 'NONE'}`);
  console.log(`[Auth Callback] Origin: ${origin}, Code present: ${!!code}`);

  if (error) {
    console.error(`[Auth Callback] Error param found: ${error} - ${errorDescription}`);
    return redirectTo(`/?error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (code) {
    try {
      const supabase = await createClient();
      console.log('[Auth Callback] Exchanging code for session...');

      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        console.error('[Auth Callback] Exchange error:', exchangeError.message);
        // If it's an invalid flow state, it might be due to missing cookies
        const message = exchangeError.message === 'invalid flow state, no valid flow state found'
          ? 'Login session expired or context lost. Please try again from the direct URL.'
          : exchangeError.message;
        return redirectTo(`/?error=${encodeURIComponent(message)}`);
      }

      if (data.user) {
        const user = data.user;
        let isAdmin = false;
        try {
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('user_id', user.id)
            .single();
          
          if (profileError || !profile) {
            // Profile does not exist, let's create a default one using supabaseAdmin
            const userEmail = user.email || '';
            const isPriyaAdmin = userEmail.toLowerCase() === 'priya.dhanani@creolestudios.com';
            
            const { error: insertError } = await supabaseAdmin
              .from('user_profiles')
              .insert({
                user_id: user.id,
                email: userEmail,
                role: isPriyaAdmin ? 'admin' : 'user',
                current_role: isPriyaAdmin ? 'expert multilingual developer' : 'Developer',
                years_of_experience: 0,
                primary_tech_stack: [],
                secondary_tech_stack: [],
                future_interests: ''
              });

            if (insertError) {
              console.error('[Auth Callback] Error creating user profile:', insertError);
            } else {
              console.log('[Auth Callback] Default profile created for:', userEmail);
              isAdmin = isPriyaAdmin;
            }
          } else {
            isAdmin = profile.role === 'admin';
          }
        } catch (err) {
          console.error('[Auth Callback] error fetching profile role:', err);
        }

        const finalRedirect = isAdmin ? '/admin/dashboard' : next;

        console.log(`[Auth Callback] Success! User: ${user.email}, Admin: ${isAdmin}, Redirecting to: ${finalRedirect}`);

        return redirectTo(finalRedirect);
      }

      console.error('[Auth Callback] No user data after exchange');
      return redirectTo('/?error=No%20user%20found%20after%20login');
    } catch (err: any) {
      console.error('[Auth Callback] Fatal internal error:', err);
      return redirectTo('/?error=Internal%20auth%20error');
    }
  }

  console.warn('[Auth Callback] No code or error found in URL');
  return redirectTo('/?error=Authentication%20failed');
}
