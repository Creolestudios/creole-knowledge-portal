import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorCode = requestUrl.searchParams.get('error_code');
  const errorDescription = requestUrl.searchParams.get('error_description');

  // Dynamic origin detection supporting local, direct ALB HTTP, and HTTPS CloudFront domains
  const proto = request.headers.get('x-forwarded-proto') || requestUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || requestUrl.host;
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
  const basePath = isLocalhost ? '' : '/creole-knowledge-portal';
  const effectiveProto = isLocalhost ? proto : 'https';
  const effectiveHost = host.includes('elb.amazonaws.com') ? 'dxad42dnfuckt.cloudfront.net' : host;
  const origin = `${effectiveProto}://${effectiveHost}${basePath}`;

  const next = requestUrl.searchParams.get('next') ?? '/dashboard';

  console.log(`[Auth Callback] URL: ${request.url}`);
  const allCookies = request.headers.get('cookie') || '';
  const cookieNames = allCookies.split(';').map(c => c.split('=')[0].trim());
  const authCookies = cookieNames.filter(name => name.includes('auth-token'));
  console.log(`[Auth Callback] Auth Cookies: ${authCookies.join(', ') || 'NONE'}`);
  console.log(`[Auth Callback] Origin: ${origin}, Code present: ${!!code}`);

  if (error) {
    console.error(`[Auth Callback] Error param found: ${error} - ${errorDescription}`);
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (code) {
    try {
      // Default to /dashboard or /admin/dashboard
      const targetPath = next.startsWith('/') ? next : `/${next}`;
      const redirectUrl = `${origin}${targetPath}`;
      const response = NextResponse.redirect(redirectUrl);

      const supabase = await createClient(response);

      console.log('[Auth Callback] Exchanging code for session...');

      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        console.error('[Auth Callback] Exchange error:', exchangeError.message);
        const message = exchangeError.message === 'invalid flow state, no valid flow state found'
          ? 'Login session expired or context lost. Please try again from the direct URL.'
          : exchangeError.message;
        return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(message)}`);
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

        if (isAdmin && !next.startsWith('/admin')) {
          response.headers.set('Location', `${origin}/admin/dashboard`);
        }

        console.log(`[Auth Callback] Success! User: ${user.email}, Admin: ${isAdmin}, Set-Cookie headers attached`);
        return response;
      }

      console.error('[Auth Callback] No user data after exchange');
      return NextResponse.redirect(`${origin}/?error=No%20user%20found%20after%20login`);
    } catch (err: any) {
      console.error('[Auth Callback] Fatal internal error:', err);
      return NextResponse.redirect(`${origin}/?error=Internal%20auth%20error`);
    }
  }

  console.warn('[Auth Callback] No code or error found in URL');
  return NextResponse.redirect(`${origin}/?error=Authentication%20failed`);
}
