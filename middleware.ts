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
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // We use getSession() or getUser() but wrap it in a timeout or catch to avoid hangs
  const { data: { user } } = await supabase.auth.getUser();

  // Protected route logic
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
  const isAdminDashboard = request.nextUrl.pathname.startsWith('/admin');
  const isLoginPage = request.nextUrl.pathname === '/';
  const isAdminEmail = user?.email === 'priya.dhanani@creolestudios.com';

  // 1. If not logged in and trying to access protected routes -> redirect to login
  if (!user && (isDashboard || isAdminDashboard)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // 2. If logged in as admin and trying to access root or standard dashboard -> redirect to admin dashboard
  if (user && isAdminEmail && (isLoginPage || isDashboard)) {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  // 3. If logged in as non-admin and trying to access root or admin dashboard -> redirect to standard dashboard
  if (user && !isAdminEmail) {
    if (isLoginPage || isAdminDashboard) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/admin/:path*'],
};
