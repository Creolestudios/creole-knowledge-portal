import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
              sameSite: 'none',
              secure: true,
              path: '/',
            } as any)
          );
        },
      },
    }
  );

  // For local testing, allow bypassing auth if ?mockUser=true is present or cookie exists
  const isMock = request.nextUrl.searchParams.has('mockUser') || request.cookies.has('mock-user');
  let user = null;

  if (isMock) {
    user = {
      id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004', // priyadhanani125@gmail.com user_id
      email: 'priyadhanani125@gmail.com',
    } as any;
    if (request.nextUrl.searchParams.has('mockUser')) {
      response.cookies.set('mock-user', 'true', { path: '/' });
    }
  } else {
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (err) {
      console.error('[Middleware] getUser error:', err);
    }
  }

  // Protected route logic
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
  const isAdminDashboard = request.nextUrl.pathname.startsWith('/admin');
  const isLoginPage = request.nextUrl.pathname === '/';

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
        sameSite: 'none',
        secure: true,
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
  matcher: ['/', '/dashboard/:path*', '/admin/:path*'],
};
