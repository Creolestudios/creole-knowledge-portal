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

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
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
  });

  // Use getUser() to verify the session
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

  const normalizedEmail = user?.email?.toLowerCase().trim();
  const isAdminEmail = normalizedEmail === 'priya.dhanani@creolestudios.com';

  console.log(
    `[Middleware] Path: ${request.nextUrl.pathname}, User: ${user?.email || 'none'}, Admin: ${isAdminEmail}`
  );

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

  // 2. If logged in as admin and trying to access root or standard dashboard -> redirect to admin dashboard
  if (user && isAdminEmail && (isLoginPage || isDashboard)) {
    return redirect('/admin/dashboard');
  }

  // 3. If logged in as non-admin and trying to access root or admin dashboard -> redirect to standard dashboard
  if (user && !isAdminEmail) {
    if (isLoginPage || isAdminDashboard) {
      return redirect('/dashboard');
    }
  }

  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*'],
};
