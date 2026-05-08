import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorCode = requestUrl.searchParams.get('error_code');
  const errorDescription = requestUrl.searchParams.get('error_description');
  
  // Clean origin - remove internal ports like :3000 or :8080 for public access
  // Standard robust detection: use protocol and hostname from request
  const isLocalhost = requestUrl.hostname === 'localhost';
  const origin = isLocalhost 
    ? `${requestUrl.protocol}//${requestUrl.hostname}${requestUrl.port ? `:${requestUrl.port}` : ''}`
    : `https://${requestUrl.hostname}`;
  
  const next = requestUrl.searchParams.get('next') ?? '/dashboard';

  console.log(`[Auth Callback] URL: ${request.url}`);
  console.log(`[Auth Callback] Origin: ${origin}, Code present: ${!!code}`);

  if (error) {
    console.error(`[Auth Callback] Error param found: ${error}`);
    const errorParam = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(`${origin}/?error=${errorParam}`);
  }

  if (code) {
    try {
      const supabase = await createClient();
      console.log('[Auth Callback] Exchanging code for session...');
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      
      if (!exchangeError) {
        const { data: { user } } = await supabase.auth.getUser();
        const isAdmin = user?.email === 'priya.dhanani@creolestudios.com';
        const finalRedirect = isAdmin ? '/admin/dashboard' : next;
        
        console.log(`[Auth Callback] Success! User: ${user?.email}, Redirecting to: ${origin}${finalRedirect}`);
        return NextResponse.redirect(`${origin}${finalRedirect}`);
      }
      
      console.error('[Auth Callback] Exchange error:', exchangeError.message);
      return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(exchangeError.message)}`);
    } catch (err: any) {
      console.error('[Auth Callback] Fatal internal error during exchange:', err);
      return NextResponse.redirect(`${origin}/?error=Internal%20auth%20error`);
    }
  }

  console.warn('[Auth Callback] No code or error found in URL');
  return NextResponse.redirect(`${origin}/?error=Authentication%20failed`);
}
