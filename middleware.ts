import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieDefaults } from '@/lib/supabase/cookie-options';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

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
              ...authCookieDefaults(),
            })
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
  const isAiInterviewExtractor = request.nextUrl.pathname.startsWith('/dashboard/ai-interview');
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

  // Function to create a redirect response that preserves cookies
  const redirect = (url: string) => {
    const redirectResponse = NextResponse.redirect(new URL(url, request.url));
    // Copy cookies from the modified 'response' to the redirect response
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, {
        ...cookie,
        ...authCookieDefaults(),
      });
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
    if (isLoginPage || isAdminDashboard || isAiInterviewExtractor) {
      return redirect('/dashboard');
    }
  }

  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*', '/api/:path*'],
};
