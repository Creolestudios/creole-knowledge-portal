import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieDefaults } from '@/lib/supabase/cookie-options';

export async function middleware(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const isViaCloudFront = !!request.headers.get('via')?.includes('cloudfront') ||
    !!request.headers.get('x-amz-cf-id') ||
    (request.headers.get('x-forwarded-host') || '').includes('cloudfront.net');

  // Automatically redirect direct browser traffic on the ALB to CloudFront HTTPS
  if (!isViaCloudFront && host.includes('.elb.amazonaws.com') && !userAgent.includes('ELB-HealthChecker')) {
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const basePath = isLocalhost ? '' : '/creole-knowledge-portal';
    const subPath = request.nextUrl.pathname === '/' ? '' : request.nextUrl.pathname;
    const cfUrl = `https://dxad42dnfuckt.cloudfront.net${basePath}${subPath}${request.nextUrl.search}`;
    return NextResponse.redirect(cfUrl);
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = rawUrl ? rawUrl.replace(/^["']|["']$/g, '').trim() : undefined;
  const key = rawKey ? rawKey.replace(/^["']|["']$/g, '').trim() : undefined;

  if (!url || !key) {
    return response;
  }

  const isHttps = isViaCloudFront || request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              sameSite: isHttps ? 'none' : 'lax',
              secure: isHttps,
              path: '/',
            } as any)
          );
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    console.error('[Middleware] getUser error:', err);
  }

  // Protected route logic
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
  const isAdminDashboard = request.nextUrl.pathname.startsWith('/admin');
  const isLoginPage = request.nextUrl.pathname === '/';
  const isApi = request.nextUrl.pathname.startsWith('/api');

  // API routes are matched purely so the Supabase session gets refreshed and the
  // rotated auth cookie is written back. They must never be redirected -- each
  // route handler returns its own JSON 401 -- and they don't need the role lookup.
  if (isApi) {
    return response;
  }

  let isAdmin = false;
  if (user) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      if (profile) {
        isAdmin = profile.role === 'admin';
      }
    } catch (err) {
      console.error('[Middleware] error fetching profile role:', err);
    }
  }

  console.log(`[Middleware] Path: ${request.nextUrl.pathname}, User: ${user?.email || 'none'}, Admin: ${isAdmin}`);

  // Function to create a redirect response that preserves cookies and basePath
  const redirect = (path: string) => {
    const isLocalhost = request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1';
    const basePath = isLocalhost ? '' : '/creole-knowledge-portal';
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    const effectiveProto = isLocalhost ? proto : 'https';
    const effectiveHost = (isViaCloudFront || host.includes('elb.amazonaws.com')) ? 'dxad42dnfuckt.cloudfront.net' : host;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const targetUrl = new URL(`${basePath}${cleanPath}`, `${effectiveProto}://${effectiveHost}`);
    const redirectResponse = NextResponse.redirect(targetUrl);
    const isHttps = effectiveProto === 'https';
    // Copy cookies from the modified 'response' to the redirect response
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, {
        ...cookie,
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
        path: '/',
      } as any);
    });
    return redirectResponse;
  };

  // 1. If not logged in and trying to access protected routes -> redirect to login
  if (!user && (isDashboard || isAdminDashboard)) {
    return redirect('/');
  }

  // 2. If logged in as admin and trying to access root -> redirect to admin dashboard (but allow access to standard dashboard)
  if (user && isAdmin && isLoginPage) {
    return redirect('/admin/dashboard');
  }

  // 3. If logged in as non-admin and trying to access root or admin dashboard -> redirect to standard dashboard
  if (user && !isAdmin) {
    if (isLoginPage || isAdminDashboard) {
      return redirect('/dashboard');
    }
  }

  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*', '/api/:path*'],
};
